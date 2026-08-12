/**
 * Integration tests for POST /api/objects/finalize.
 *
 * Uses the real createFinalizeHandler() factory from finalizeHandler.ts with
 * injected fake storage/ACL deps and a real HTTP server (supertest).  The tests
 * exercise the actual production handler code — Zod validation, path check,
 * one-shot claim guard, HEIC→JPEG conversion, metageneration precondition, and
 * error mapping — not a separately maintained copy.
 *
 * Three security- and correctness-critical behaviors are locked down:
 *
 *  1. HEIC bytes uploaded through the signed PUT are rewritten as JPEG before
 *     the object is claimed.
 *  2. Finalize is one-shot: any object that already has an ACL policy is
 *     rejected with 409 regardless of caller identity, preventing a user from
 *     re-homing an object into a different tenant.
 *  3. Unreadable/malformed HEIC returns 415 Unsupported Media Type, not 500.
 */

import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import {
  createFinalizeHandler,
  type FinalizeHandlerDeps,
  type ObjectAclPolicy,
  type ObjectHandle,
} from "./finalizeHandler";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Real, fully decodable HEIC image (same fixture used in imageNormalization.test.ts).
 * heic-convert turns this into valid JPEG bytes inside normalizeImageForStorage.
 */
const HEIC_FIXTURE = Buffer.from(
  "AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAWhtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAGMAAEAAAAAAAAANQAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGh2YzEAAAAA6GlwcnAAAADJaXBjbwAAAHVodmNDAQQIAAAAAAAAAAAAHvAA/P38/AAADwMgAAEAF0ABDAH//wQIAAADAJm4AAADAAAeugJAIQABACpCAQEECAAAAwCZuAAAAwAAHqAggQRSluqumubgIaDAgAAAAwCAAAADAIQiAAEABkQBwXPAiQAAABRpc3BlAAAAAAAAAEAAAABAAAAAKGNsYXAAAAAYAAAAAQAAABAAAAAB////2AAAAAL////QAAAAAgAAABBwaXhpAAAAAAMMDAwAAAAXaXBtYQAAAAAAAAABAAEEgQIEgwAAAD1tZGF0AAAAMSgBrxOA9SRSx9ube8ibxyKCC3J57c3jaStGhlc6Fs3/DrZcmdvCtQNWw6QpBCgAGBA=",
  "base64",
);

/** Bytes that carry no valid image header — heic-convert will reject them. */
const MALFORMED_HEIC = Buffer.from("not a real heic file");

// ---------------------------------------------------------------------------
// In-memory fake object store
// ---------------------------------------------------------------------------

interface StoredObject {
  bytes: Buffer;
  contentType: string;
  /** Raw ACL JSON string, or null if unclaimed. */
  aclPolicyJson: string | null;
  metageneration: number;
}

/**
 * Builds FinalizeHandlerDeps backed by an in-memory StoredObject.
 * normalizeObjectPath wraps the uploadUrl into "/objects/<path>".
 * writeFile bumps metageneration (simulating GCS behaviour).
 */
function makeDeps(stored: StoredObject): FinalizeHandlerDeps {
  const handle: ObjectHandle = { name: "test-object" };

  return {
    normalizeObjectPath: (uploadUrl) => `/objects/${uploadUrl.replace(/^\/+/, "")}`,
    getObjectFile: async (_path) => handle,
    readMetadata: async (_file) => ({
      aclPolicyJson: stored.aclPolicyJson,
      contentType: stored.contentType,
      metageneration: stored.metageneration,
    }),
    readBytes: async (_file) => stored.bytes,
    writeFile: async (_file, bytes, contentType) => {
      stored.bytes = bytes;
      stored.contentType = contentType;
      stored.metageneration += 1;
      return { metageneration: stored.metageneration };
    },
    setAclPolicy: async (_file, policy, _opts) => {
      stored.aclPolicyJson = JSON.stringify(policy);
    },
    isObjectNotFoundError: (_err) => false,
    isPreconditionFailedError: (_err) => false,
  };
}

/** Builds a real Express app that mounts fake-auth + createFinalizeHandler. */
function buildApp(
  stored: StoredObject,
  callerId: string,
  companyId = "company-001",
) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: callerId };
    req.companyId = companyId;
    next();
  });
  app.post("/api/objects/finalize", createFinalizeHandler(makeDeps(stored)));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/objects/finalize — createFinalizeHandler", () => {
  // -------------------------------------------------------------------------
  // 1. HEIC → JPEG conversion
  // -------------------------------------------------------------------------
  describe("HEIC → JPEG conversion", () => {
    let stored: StoredObject;

    beforeEach(() => {
      stored = {
        bytes: HEIC_FIXTURE,
        contentType: "image/heic",
        aclPolicyJson: null,
        metageneration: 1,
      };
    });

    it("responds 200 and reports image/jpeg as the content-type", async () => {
      const res = await request(buildApp(stored, "user-alice"))
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/photo.heic", visibility: "private" });

      expect(res.status).toBe(200);
      expect(res.body.contentType).toBe("image/jpeg");
    });

    it("overwrites the stored bytes with JPEG magic bytes (FF D8 FF)", async () => {
      await request(buildApp(stored, "user-alice"))
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/photo.heic" });

      expect(stored.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    });

    it("updates the stored content-type to image/jpeg", async () => {
      await request(buildApp(stored, "user-alice"))
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/photo.heic" });

      expect(stored.contentType).toBe("image/jpeg");
    });

    it("stamps the ACL policy with the calling user and company", async () => {
      await request(buildApp(stored, "user-alice", "company-xyz"))
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/photo.heic", visibility: "public" });

      const policy: ObjectAclPolicy = JSON.parse(stored.aclPolicyJson!);
      expect(policy.owner).toBe("user-alice");
      expect(policy.companyId).toBe("company-xyz");
      expect(policy.visibility).toBe("public");
    });

    it("defaults visibility to private when not supplied", async () => {
      await request(buildApp(stored, "user-alice"))
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/photo.heic" });

      const policy: ObjectAclPolicy = JSON.parse(stored.aclPolicyJson!);
      expect(policy.visibility).toBe("private");
    });
  });

  // -------------------------------------------------------------------------
  // 2. One-shot claim guard — already-finalized objects return 409
  // -------------------------------------------------------------------------
  describe("one-shot claim guard", () => {
    it("returns 409 when the object already has an ACL policy", async () => {
      const stored: StoredObject = {
        bytes: Buffer.from([0xff, 0xd8, 0xff]),
        contentType: "image/jpeg",
        aclPolicyJson: JSON.stringify({ owner: "user-alice", companyId: "company-001", visibility: "private" }),
        metageneration: 2,
      };

      // user-bob attempts to claim user-alice's already-finalized object
      const res = await request(buildApp(stored, "user-bob"))
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/photo.jpg" });

      expect(res.status).toBe(409);
    });

    it("also returns 409 when the same user tries to re-finalize their own object", async () => {
      const stored: StoredObject = {
        bytes: Buffer.from([0xff, 0xd8, 0xff]),
        contentType: "image/jpeg",
        aclPolicyJson: JSON.stringify({ owner: "user-alice", companyId: "company-001", visibility: "private" }),
        metageneration: 2,
      };

      const res = await request(buildApp(stored, "user-alice"))
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/mine.jpg" });

      expect(res.status).toBe(409);
    });

    it("does not overwrite the existing policy on a 409", async () => {
      const originalPolicy = JSON.stringify({
        owner: "user-alice",
        companyId: "company-001",
        visibility: "private",
      });
      const stored: StoredObject = {
        bytes: Buffer.from([0xff, 0xd8, 0xff]),
        contentType: "image/jpeg",
        aclPolicyJson: originalPolicy,
        metageneration: 2,
      };

      await request(buildApp(stored, "user-bob"))
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/photo.jpg" });

      expect(stored.aclPolicyJson).toBe(originalPolicy);
    });

    it("returns 409 when a concurrent write triggers the metageneration precondition", async () => {
      const stored: StoredObject = {
        bytes: HEIC_FIXTURE,
        contentType: "image/heic",
        aclPolicyJson: null,
        metageneration: 1,
      };
      const handle: ObjectHandle = { name: "race-object" };

      // Deps where setAclPolicy throws a 412-style error
      const deps: FinalizeHandlerDeps = {
        normalizeObjectPath: (u) => `/objects/${u}`,
        getObjectFile: async () => handle,
        readMetadata: async () => ({
          aclPolicyJson: null,
          contentType: "image/heic",
          metageneration: 1,
        }),
        readBytes: async () => HEIC_FIXTURE,
        writeFile: async (_f, bytes, contentType) => {
          stored.bytes = bytes;
          stored.contentType = contentType;
          return { metageneration: 2 };
        },
        setAclPolicy: async () => {
          const err: any = new Error("Precondition failed");
          err.code = 412;
          throw err;
        },
        isObjectNotFoundError: () => false,
        isPreconditionFailedError: (err: any) => err?.code === 412,
      };

      const app = express();
      app.use(express.json());
      app.use((req: any, _res, next) => {
        req.user = { id: "user-alice" };
        req.companyId = "company-001";
        next();
      });
      app.post("/api/objects/finalize", createFinalizeHandler(deps));

      const res = await request(app)
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/race.heic" });

      expect(res.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Malformed / unreadable HEIC → 415, not 500
  // -------------------------------------------------------------------------
  describe("malformed HEIC handling", () => {
    it("returns 415 for bytes declared as image/heic that cannot be parsed", async () => {
      const stored: StoredObject = {
        bytes: MALFORMED_HEIC,
        contentType: "image/heic",
        aclPolicyJson: null,
        metageneration: 1,
      };

      const res = await request(buildApp(stored, "user-alice"))
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/corrupt.heic" });

      expect(res.status).toBe(415);
    });

    it("returns an actionable error message, not an internal stack trace", async () => {
      const stored: StoredObject = {
        bytes: MALFORMED_HEIC,
        contentType: "image/heic",
        aclPolicyJson: null,
        metageneration: 1,
      };

      const res = await request(buildApp(stored, "user-carol"))
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/corrupt.heic" });

      expect(res.body.error).toBeTruthy();
      expect(res.body.details).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Input validation
  // -------------------------------------------------------------------------
  describe("input validation", () => {
    const emptyStored = (): StoredObject => ({
      bytes: Buffer.alloc(0),
      contentType: "application/octet-stream",
      aclPolicyJson: null,
      metageneration: 1,
    });

    it("returns 400 when uploadUrl is missing", async () => {
      const res = await request(buildApp(emptyStored(), "user-alice"))
        .post("/api/objects/finalize")
        .send({ visibility: "private" });

      expect(res.status).toBe(400);
    });

    it("returns 400 when companyId is absent from the request context", async () => {
      const app = express();
      app.use(express.json());
      app.use((req: any, _res, next) => {
        req.user = { id: "user-alice" };
        // companyId deliberately omitted
        next();
      });
      app.post("/api/objects/finalize", createFinalizeHandler(makeDeps(emptyStored())));

      const res = await request(app)
        .post("/api/objects/finalize")
        .send({ uploadUrl: "uploads/photo.jpg" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for an uploadUrl that resolves outside /objects/", async () => {
      const deps = makeDeps(emptyStored());
      deps.normalizeObjectPath = (_url) => "/admin/secrets";

      const app = express();
      app.use(express.json());
      app.use((req: any, _res, next) => {
        req.user = { id: "user-alice" };
        req.companyId = "company-001";
        next();
      });
      app.post("/api/objects/finalize", createFinalizeHandler(deps));

      const res = await request(app)
        .post("/api/objects/finalize")
        .send({ uploadUrl: "https://evil.example.com/../../admin/secrets" });

      expect(res.status).toBe(400);
    });
  });
});
