/**
 * Endpoint-level integration tests for POST /api/waste/interpret (JSON-transcript path).
 *
 * Strategy: build a minimal Express app that wires up the same handler logic
 * as routes.ts, mocking only OpenAI (extractSpokenWasteEntries) and the DB
 * (storage + permissions).  resolveSpokenWasteEntries runs for real so the
 * full interpretation pipeline is exercised.
 *
 * Scenarios covered:
 *  1. Happy path — transcript resolves to a known inventory item
 *  2. Ambiguous match — two similar items, narrow score margin
 *  3. needs_unit — spoken unit incompatible with item's configured units
 *  4. Unresolved — GPT returns an item name with no catalog match
 *  5. Empty transcript (after trim) → 400
 *  6. Blank transcript body field → 400
 *  7. Missing storeId → 400
 *  8. Unauthorized store → 403
 *  9. Transcript > 5 000 chars → 200 + truncation warning + entries still returned
 * 10. GPT extraction returning zero entries → 200 with empty entries array
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "crypto";
import { z } from "zod";
import type { Express } from "express";

// ── Module-level mocks (hoisted so they intercept imports used by the handler) ──

vi.mock("../services/wasteInterpreter", async (importOriginal) => {
  // Keep resolveSpokenWasteEntries real; mock only the OpenAI-backed functions
  const real = await importOriginal<typeof import("../services/wasteInterpreter")>();
  return {
    ...real,
    extractSpokenWasteEntries: vi.fn(),
    transcribeAudio: vi.fn(),
  };
});

vi.mock("../storage", () => ({
  storage: {
    getInventoryItems: vi.fn(),
    getMenuItemsByCompany: vi.fn(),
    getUnits: vi.fn(),
    getInventoryItemUnitsForCompany: vi.fn(),
  },
}));

vi.mock("../permissions", () => ({
  getAccessibleStores: vi.fn(),
  canAccessStore: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { extractSpokenWasteEntries, resolveSpokenWasteEntries } from "../services/wasteInterpreter";
import { storage } from "../storage";
import { getAccessibleStores } from "../permissions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Use RFC 4122-compliant UUIDs (Zod v4 enforces version digit [1-8] and variant [89ab])
const STORE_A = "a1b2c3d4-0000-4000-8000-000000000001";
const STORE_B = "a1b2c3d4-0000-4000-8000-000000000002";
const COMPANY = "a1b2c3d4-0000-4000-8000-000000000003";

const UNIT_LB  = { id: "u-lb",  name: "lb",     abbreviation: "lb"  };
const UNIT_OZ  = { id: "u-oz",  name: "oz",      abbreviation: "oz"  };
const UNIT_GAL = { id: "u-gal", name: "gallon",  abbreviation: "gal" };
const ALL_UNITS = [UNIT_LB, UNIT_OZ, UNIT_GAL];

const INV_CHICKEN = {
  id: "inv-chicken",
  name: "Chicken Breast",
  categoryId: "cat-1",
  unitId: UNIT_LB.id,
  active: 1,
};
const INV_CHICKEN_THIGH = {
  id: "inv-chicken-thigh",
  name: "Chicken Thigh",
  categoryId: "cat-1",
  unitId: UNIT_LB.id,
  active: 1,
};
const INV_TOMATO = {
  id: "inv-tomato",
  name: "Tomato",
  categoryId: "cat-2",
  unitId: UNIT_LB.id,
  active: 1,
};
const MENU_BURGER = {
  id: "menu-burger",
  name: "Classic Burger",
  department: "Entrées",
  active: 1,
};

// ── Minimal express app that reproduces the routes.ts handler ────────────────

/**
 * Build a test app that exercises the exact same business logic as the
 * POST /api/waste/interpret handler in routes.ts, using the mocked
 * dependencies injected above.
 */
function makeApp(): Express {
  const app = express();
  app.use(express.json());

  // Inject authenticated user (mirrors requireAuth in real routes)
  app.use((req: any, _res, next) => {
    req.user      = { id: "user-1", role: "company_admin", companyId: COMPANY };
    req.companyId = COMPANY;
    next();
  });

  app.post("/api/waste/interpret", async (req: any, res) => {
    try {
      // ── Parse body (JSON path only — no audio in these tests) ──────────────
      const schema = z.object({
        storeId:    z.string().uuid("storeId must be a valid UUID"),
        transcript: z.string().min(1).max(5100),
        requestId:  z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      let { storeId, requestId } = parsed.data;
      let transcript = parsed.data.transcript;
      requestId = requestId ?? (crypto.randomUUID() as string);

      // ── Auth / store access ────────────────────────────────────────────────
      if (!storeId || !/^[0-9a-f-]{36}$/i.test(storeId)) {
        return res.status(400).json({ error: "storeId must be a valid UUID" });
      }
      const accessibleStoreIds = await getAccessibleStores(req.user!, req.companyId);
      if (!accessibleStoreIds.includes(storeId)) {
        return res.status(403).json({ error: "Access denied to this store" });
      }

      // ── Enforce transcript limits ──────────────────────────────────────────
      const responseWarnings: string[] = [];
      if (transcript.length > 5000) {
        responseWarnings.push("Transcript was truncated to 5,000 characters");
        transcript = transcript.slice(0, 5000);
      }
      if (!transcript.trim()) {
        return res.status(400).json({ error: "No transcript to interpret" });
      }

      // ── Extract spoken entries via GPT ─────────────────────────────────────
      const { entries: spokenEntries, model: interpretationModel } =
        await extractSpokenWasteEntries(transcript);

      // ── Fetch catalog ──────────────────────────────────────────────────────
      const [allInventoryItems, allMenuItems, allUnits, allItemUnits] = await Promise.all([
        storage.getInventoryItems(undefined, undefined, req.companyId!),
        storage.getMenuItemsByCompany(req.companyId!),
        storage.getUnits(),
        storage.getInventoryItemUnitsForCompany(req.companyId!),
      ]);

      // ── Resolve entries ────────────────────────────────────────────────────
      const resolvedEntries = resolveSpokenWasteEntries({
        inventoryItems: allInventoryItems as any[],
        menuItems: allMenuItems as any[],
        units: allUnits,
        itemUnits: (allItemUnits as any[]).map((iu: any) => ({
          inventoryItemId: iu.inventoryItemId,
          unitId: iu.unitId,
        })),
        entries: spokenEntries,
      });

      return res.json({
        requestId,
        transcript,
        transcriptionModel: null,
        interpretationModel,
        entries: resolvedEntries,
        warnings: responseWarnings,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? "Failed to interpret waste entry" });
    }
  });

  return app;
}

// ── Shared setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default catalog returned by storage mocks
  (storage.getInventoryItems as any).mockResolvedValue([
    INV_CHICKEN, INV_CHICKEN_THIGH, INV_TOMATO,
  ]);
  (storage.getMenuItemsByCompany as any).mockResolvedValue([MENU_BURGER]);
  (storage.getUnits as any).mockResolvedValue(ALL_UNITS);
  (storage.getInventoryItemUnitsForCompany as any).mockResolvedValue([]);

  // Default: user has access to STORE_A only
  (getAccessibleStores as any).mockResolvedValue([STORE_A]);
});

// ── Test suites ───────────────────────────────────────────────────────────────

describe("POST /api/waste/interpret — happy path", () => {
  it("returns 200 with resolved entry for an exact-match item", async () => {
    (extractSpokenWasteEntries as any).mockResolvedValue({
      entries: [
        {
          sourceText: "2 pounds chicken breast",
          wasteType: "inventory",
          spokenItem: "Chicken Breast",
          qty: 2,
          spokenUnit: "pounds",
          reasonCode: "SPOILED",
          notes: null,
        },
      ],
      model: "gpt-4o",
    });

    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "2 pounds chicken breast" });

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    const entry = res.body.entries[0];
    expect(entry.resolutionStatus).toBe("resolved");
    expect(entry.itemId).toBe(INV_CHICKEN.id);
    expect(entry.itemName).toBe("Chicken Breast");
    expect(entry.unitId).toBe(UNIT_LB.id);
    expect(res.body.warnings).toHaveLength(0);
  });
});

describe("POST /api/waste/interpret — ambiguous match", () => {
  it("returns 200 with ambiguous resolutionStatus when two items score similarly", async () => {
    (extractSpokenWasteEntries as any).mockResolvedValue({
      entries: [
        {
          sourceText: "chicken",
          wasteType: "inventory",
          spokenItem: "chicken",
          qty: 2,
          spokenUnit: "lb",
          reasonCode: null,
          notes: null,
        },
      ],
      model: "gpt-4o",
    });

    // Catalog has both Chicken Breast and Chicken Thigh → ambiguous
    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "two pounds of chicken" });

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].resolutionStatus).toBe("ambiguous");
    // Both candidates should be present
    const ids = res.body.entries[0].candidates.map((c: any) => c.itemId);
    expect(ids).toContain(INV_CHICKEN.id);
    expect(ids).toContain(INV_CHICKEN_THIGH.id);
  });
});

describe("POST /api/waste/interpret — needs_unit", () => {
  it("returns 200 with needs_unit when spoken unit is incompatible with item config", async () => {
    (extractSpokenWasteEntries as any).mockResolvedValue({
      entries: [
        {
          sourceText: "5 gallons of chicken breast",
          wasteType: "inventory",
          spokenItem: "Chicken Breast",
          qty: 5,
          spokenUnit: "gallons",
          reasonCode: null,
          notes: null,
        },
      ],
      model: "gpt-4o",
    });

    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "5 gallons of chicken breast" });

    expect(res.status).toBe(200);
    const entry = res.body.entries[0];
    expect(entry.resolutionStatus).toBe("needs_unit");
    expect(entry.unitId).toBeNull();
    expect(entry.canonicalUnitId).toBe(UNIT_LB.id);
    expect(entry.warnings.length).toBeGreaterThan(0);
  });
});

describe("POST /api/waste/interpret — unresolved", () => {
  it("returns 200 with unresolved entry when spoken item has no catalog match", async () => {
    (extractSpokenWasteEntries as any).mockResolvedValue({
      entries: [
        {
          sourceText: "some mystery ingredient",
          wasteType: "inventory",
          spokenItem: "xyzzy fribble ingredient",
          qty: 1,
          spokenUnit: "lb",
          reasonCode: null,
          notes: null,
        },
      ],
      model: "gpt-4o",
    });

    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "some mystery ingredient" });

    expect(res.status).toBe(200);
    const entry = res.body.entries[0];
    expect(entry.resolutionStatus).toBe("unresolved");
    expect(entry.itemId).toBeNull();
  });
});

describe("POST /api/waste/interpret — empty / blank transcript", () => {
  it("returns 400 when transcript is an empty string", async () => {
    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when transcript contains only whitespace", async () => {
    // The transcript field passes the min(1) validator (spaces count as chars)
    // but the endpoint's trim check must catch it and return 400.
    (extractSpokenWasteEntries as any).mockResolvedValue({ entries: [], model: "gpt-4o" });

    // Manually bypass the zod min(1) by sending a single space — the trim
    // check inside the handler should still reject it.
    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/transcript/i);
  });
});

describe("POST /api/waste/interpret — missing / invalid storeId", () => {
  it("returns 400 when storeId is missing", async () => {
    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ transcript: "two pounds chicken breast" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when storeId is not a UUID", async () => {
    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: "not-a-uuid", transcript: "two pounds chicken breast" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/waste/interpret — unauthorized store", () => {
  it("returns 403 when the user does not have access to the requested store", async () => {
    // getAccessibleStores returns only STORE_A; STORE_B is unauthorized
    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_B, transcript: "two pounds chicken breast" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access denied/i);
  });
});

describe("POST /api/waste/interpret — long transcript truncation", () => {
  it("returns 200 with a truncation warning when transcript exceeds 5 000 chars", async () => {
    const longTranscript = "a".repeat(5100);

    (extractSpokenWasteEntries as any).mockResolvedValue({
      entries: [
        {
          sourceText: "chicken breast",
          wasteType: "inventory",
          spokenItem: "Chicken Breast",
          qty: 1,
          spokenUnit: "lb",
          reasonCode: null,
          notes: null,
        },
      ],
      model: "gpt-4o",
    });

    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: longTranscript });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toContainEqual(
      expect.stringMatching(/truncated/i),
    );
    // Verify extractSpokenWasteEntries received the truncated string
    const calledWith: string = (extractSpokenWasteEntries as any).mock.calls[0][0];
    expect(calledWith.length).toBeLessThanOrEqual(5000);
  });

  it("still includes resolved entries after truncation", async () => {
    const longTranscript = "two pounds chicken breast " + "x".repeat(5000);

    (extractSpokenWasteEntries as any).mockResolvedValue({
      entries: [
        {
          sourceText: "two pounds chicken breast",
          wasteType: "inventory",
          spokenItem: "Chicken Breast",
          qty: 2,
          spokenUnit: "pounds",
          reasonCode: "SPOILED",
          notes: null,
        },
      ],
      model: "gpt-4o",
    });

    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: longTranscript });

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].resolutionStatus).toBe("resolved");
  });
});

describe("POST /api/waste/interpret — GPT returns zero entries", () => {
  it("returns 200 with an empty entries array (silent-zero is visible to caller)", async () => {
    // This scenario is the core motivation for these tests: a bad transcription
    // or a GPT parse failure silently returns [] — callers must check length.
    (extractSpokenWasteEntries as any).mockResolvedValue({
      entries: [],
      model: "gpt-4o",
    });

    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "some kitchen noise that yields nothing" });

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
    // requestId and transcript must still be present so the client can log the miss
    expect(res.body.requestId).toBeTruthy();
    expect(res.body.transcript).toBeTruthy();
  });
});

describe("POST /api/waste/interpret — requestId passthrough", () => {
  it("echoes a caller-supplied requestId in the response", async () => {
    (extractSpokenWasteEntries as any).mockResolvedValue({ entries: [], model: "gpt-4o" });

    const myId = "req-" + crypto.randomUUID();
    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "test transcript", requestId: myId });

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(myId);
  });

  it("generates a requestId when not supplied by caller", async () => {
    (extractSpokenWasteEntries as any).mockResolvedValue({ entries: [], model: "gpt-4o" });

    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "test transcript" });

    expect(res.status).toBe(200);
    expect(res.body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
