/**
 * Dependency-injected Express request handler for POST /api/objects/finalize.
 *
 * Extracted from routes.ts so the security-critical behaviors can be
 * integration-tested with fake storage/ACL deps and a real HTTP server:
 *
 *  1. HEIC bytes are converted to JPEG before the object is claimed.
 *  2. Finalize is one-shot — any object that already has an ACL policy is
 *     rejected with 409, regardless of which user owns it.  This prevents a
 *     user from re-homing an object into a different tenant by re-finalizing.
 *  3. Unreadable/malformed HEIC returns 415, not 500.
 *  4. A metageneration precondition on the ACL write prevents two concurrent
 *     finalize requests from both succeeding on the same unclaimed object.
 *
 * The production wiring in routes.ts calls createFinalizeHandler() with the
 * real Replit object-storage and ACL adapters.
 */

import type { RequestHandler } from "express";
import { z } from "zod";
import { normalizeImageForStorage, UnsupportedImageError } from "./imageNormalization";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ObjectAclPolicy {
  owner: string;
  companyId: string;
  visibility: "public" | "private";
}

/**
 * An opaque handle to a stored object.  The handler passes it between deps
 * without caring about the underlying implementation (GCS File, local path…).
 */
export interface ObjectHandle {
  name: string;
}

export interface FinalizeHandlerDeps {
  /**
   * Convert a client-supplied signed upload URL (or bare path) into the
   * canonical internal object path, e.g. "/objects/abc123".
   */
  normalizeObjectPath(uploadUrl: string): string;

  /** Retrieve a handle for the object at the given canonical path. */
  getObjectFile(objectPath: string): Promise<ObjectHandle>;

  /**
   * Read object metadata: the raw ACL policy JSON string (or null if unclaimed),
   * the declared content-type, and the current metageneration number used for
   * precondition writes.
   */
  readMetadata(file: ObjectHandle): Promise<{
    aclPolicyJson: string | null;
    contentType: string;
    metageneration: string | number;
  }>;

  /** Read raw bytes from the object. */
  readBytes(file: ObjectHandle): Promise<Buffer>;

  /**
   * Overwrite the object's bytes and content-type.
   * Returns the new metageneration so the subsequent ACL write can use it
   * as a precondition.
   */
  writeFile(
    file: ObjectHandle,
    bytes: Buffer,
    contentType: string,
  ): Promise<{ metageneration: string | number }>;

  /**
   * Stamp the ACL policy onto the object.
   * When `options.ifMetagenerationMatch` is provided the underlying store
   * must enforce it, throwing a precondition error (caught by
   * `isPreconditionFailedError`) if another writer already changed the object.
   */
  setAclPolicy(
    file: ObjectHandle,
    policy: ObjectAclPolicy,
    options?: { ifMetagenerationMatch?: string | number },
  ): Promise<void>;

  /** Returns true when the error indicates the object does not exist. */
  isObjectNotFoundError(err: unknown): boolean;

  /** Returns true when the error is a precondition / metageneration mismatch (HTTP 412). */
  isPreconditionFailedError(err: unknown): boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  uploadUrl: z.string().min(1),
  visibility: z.enum(["public", "private"]).optional(),
});

/**
 * Returns a fully wired Express RequestHandler for POST /api/objects/finalize.
 * Attach it after requireAuth in routes.ts.
 */
export function createFinalizeHandler(deps: FinalizeHandlerDeps): RequestHandler {
  return async (req, res) => {
    try {
      // --- Input validation ---------------------------------------------------
      const parseResult = bodySchema.safeParse(req.body);
      if (!parseResult.success) {
        return res
          .status(400)
          .json({ error: "uploadUrl is required and must be a non-empty string" });
      }
      const { uploadUrl, visibility: visibilityRaw } = parseResult.data;
      const visibility: "public" | "private" =
        visibilityRaw === "public" ? "public" : "private";

      const user = (req as any).user as { id: string };
      const companyId: string | undefined = (req as any).companyId;
      if (!companyId) {
        return res
          .status(400)
          .json({ error: "Company context required to finalize upload" });
      }

      // --- Path validation ----------------------------------------------------
      const objectPath = deps.normalizeObjectPath(uploadUrl);
      if (!objectPath.startsWith("/objects/")) {
        return res.status(400).json({ error: "Invalid upload URL" });
      }

      // --- Object retrieval ---------------------------------------------------
      const objectFile = await deps.getObjectFile(objectPath);

      // --- One-shot claim check -----------------------------------------------
      // Read metadata once: check for an existing ACL and capture the baseline
      // metageneration for the precondition write below.
      // Finalize is one-shot: any existing policy means the object has already
      // been claimed. Allowing re-finalization would let a user stamp a new
      // companyId onto the object and re-home it in a different tenant.
      const { aclPolicyJson, contentType: declaredMimeType, metageneration: initialMetageneration } =
        await deps.readMetadata(objectFile);

      if (aclPolicyJson) {
        return res.status(409).json({ error: "Object has already been finalized" });
      }

      // --- Read bytes + normalize (HEIC → JPEG) --------------------------------
      const originalBytes = await deps.readBytes(objectFile);
      const normalized = await normalizeImageForStorage(originalBytes, declaredMimeType);

      let currentMetageneration = initialMetageneration;
      if (normalized.buffer !== originalBytes || normalized.mimeType !== declaredMimeType) {
        // save() changes the metageneration; capture the new value so the
        // precondition on the ACL write stays valid.
        const saved = await deps.writeFile(objectFile, normalized.buffer, normalized.mimeType);
        currentMetageneration = saved.metageneration;
      }

      // --- Atomic claim -------------------------------------------------------
      try {
        await deps.setAclPolicy(
          objectFile,
          { owner: user.id, companyId, visibility },
          { ifMetagenerationMatch: currentMetageneration },
        );
      } catch (preconditionErr: unknown) {
        if (deps.isPreconditionFailedError(preconditionErr)) {
          // A concurrent finalize already wrote the ACL while we were working.
          return res.status(409).json({ error: "Object has already been finalized" });
        }
        throw preconditionErr;
      }

      return res.json({ objectPath, contentType: normalized.mimeType });
    } catch (err: any) {
      if (err instanceof UnsupportedImageError) {
        return res.status(415).json({ error: err.message });
      }
      if (deps.isObjectNotFoundError(err)) {
        return res.status(404).json({ error: "Uploaded object not found" });
      }
      console.error("Error finalizing upload:", err);
      return res
        .status(500)
        .json({ error: "Failed to finalize upload", details: err.message });
    }
  };
}
