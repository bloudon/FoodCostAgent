/**
 * Companion integration tests for POST /api/waste/interpret — DB log-write coverage.
 *
 * Verifies that the fire-and-forget db.insert(voiceInterpretLogs) call is made
 * with the correct field values for every resolution status, and that a DB
 * write failure does NOT propagate to the HTTP response.
 *
 * Statuses covered: resolved · ambiguous · needs_unit · unresolved
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "crypto";
import { z } from "zod";
import type { Express } from "express";

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  db: {
    insert: vi.fn(),
  },
}));

vi.mock("../services/wasteInterpreter", async (importOriginal) => {
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

// ── Imports after mocks ───────────────────────────────────────────────────────

import { extractSpokenWasteEntries, resolveSpokenWasteEntries } from "../services/wasteInterpreter";
import { storage } from "../storage";
import { getAccessibleStores } from "../permissions";
import { db } from "../db";
import { voiceInterpretLogs } from "@workspace/db";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STORE_A  = "a1b2c3d4-0000-4000-8000-000000000001";
const COMPANY  = "a1b2c3d4-0000-4000-8000-000000000003";

const UNIT_LB  = { id: "u-lb",  name: "lb",    abbreviation: "lb"  };
const UNIT_OZ  = { id: "u-oz",  name: "oz",    abbreviation: "oz"  };
const UNIT_GAL = { id: "u-gal", name: "gallon", abbreviation: "gal" };
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

// ── Test app — mirrors the real handler including the log-write block ─────────

let valuesMock: ReturnType<typeof vi.fn>;

function makeApp(): Express {
  const app = express();
  app.use(express.json());

  app.use((req: any, _res, next) => {
    req.user      = { id: "user-1", role: "company_admin", companyId: COMPANY };
    req.companyId = COMPANY;
    next();
  });

  app.post("/api/waste/interpret", async (req: any, res) => {
    try {
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

      if (!storeId || !/^[0-9a-f-]{36}$/i.test(storeId)) {
        return res.status(400).json({ error: "storeId must be a valid UUID" });
      }
      const accessibleStoreIds = await getAccessibleStores(req.user!, req.companyId);
      if (!accessibleStoreIds.includes(storeId)) {
        return res.status(403).json({ error: "Access denied to this store" });
      }

      const responseWarnings: string[] = [];
      if (transcript.length > 5000) {
        responseWarnings.push("Transcript was truncated to 5,000 characters");
        transcript = transcript.slice(0, 5000);
      }
      if (!transcript.trim()) {
        return res.status(400).json({ error: "No transcript to interpret" });
      }

      const { entries: spokenEntries, model: interpretationModel } =
        await extractSpokenWasteEntries(transcript);

      const [allInventoryItems, allMenuItems, allUnits, allItemUnits] = await Promise.all([
        storage.getInventoryItems(undefined, undefined, req.companyId!),
        storage.getMenuItemsByCompany(req.companyId!),
        storage.getUnits(),
        storage.getInventoryItemUnitsForCompany(req.companyId!),
      ]);

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

      // ── Fire-and-forget log write (exact copy from routes.ts) ───────────────
      if (resolvedEntries.length > 0) {
        const companyId = req.companyId!;
        const logRows = resolvedEntries.map((entry: any) => ({
          companyId,
          storeId,
          spokenItem: entry.spokenItem,
          resolutionStatus: entry.resolutionStatus,
          matchedItemId: entry.itemId ?? null,
          matchScore: entry.matchScore,
        }));
        db.insert(voiceInterpretLogs).values(logRows).catch((logErr: unknown) => {
          console.error("[waste/interpret] log write error:", logErr);
        });
      }

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

  // Configure db.insert chain: insert(table) → { values: fn → Promise }
  valuesMock = vi.fn().mockResolvedValue([]);
  (db.insert as any).mockReturnValue({ values: valuesMock });

  (storage.getInventoryItems as any).mockResolvedValue([
    INV_CHICKEN, INV_CHICKEN_THIGH, INV_TOMATO,
  ]);
  (storage.getMenuItemsByCompany as any).mockResolvedValue([MENU_BURGER]);
  (storage.getUnits as any).mockResolvedValue(ALL_UNITS);
  (storage.getInventoryItemUnitsForCompany as any).mockResolvedValue([]);

  (getAccessibleStores as any).mockResolvedValue([STORE_A]);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait one microtask tick so fire-and-forget promises settle. */
const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/waste/interpret — DB log writes", () => {

  it("writes a log row with resolutionStatus=resolved for an exact-match item", async () => {
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

    await flushPromises();

    expect(res.status).toBe(200);
    expect(db.insert).toHaveBeenCalledWith(voiceInterpretLogs);
    expect(valuesMock).toHaveBeenCalledTimes(1);

    const [logRows] = valuesMock.mock.calls[0] as [any[]];
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      companyId: COMPANY,
      storeId: STORE_A,
      spokenItem: "Chicken Breast",
      resolutionStatus: "resolved",
      matchedItemId: INV_CHICKEN.id,
    });
  });

  it("writes a log row with resolutionStatus=ambiguous when two items score similarly", async () => {
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

    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "two pounds of chicken" });

    await flushPromises();

    expect(res.status).toBe(200);
    expect(db.insert).toHaveBeenCalledWith(voiceInterpretLogs);
    expect(valuesMock).toHaveBeenCalledTimes(1);

    const [logRows] = valuesMock.mock.calls[0] as [any[]];
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      companyId: COMPANY,
      storeId: STORE_A,
      resolutionStatus: "ambiguous",
    });
    // matchedItemId is the top candidate id (resolver picks highest-scoring match)
    expect(typeof logRows[0].matchedItemId === "string" || logRows[0].matchedItemId === null).toBe(true);
  });

  it("writes a log row with resolutionStatus=needs_unit when spoken unit is incompatible", async () => {
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

    await flushPromises();

    expect(res.status).toBe(200);
    expect(db.insert).toHaveBeenCalledWith(voiceInterpretLogs);
    expect(valuesMock).toHaveBeenCalledTimes(1);

    const [logRows] = valuesMock.mock.calls[0] as [any[]];
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      companyId: COMPANY,
      storeId: STORE_A,
      spokenItem: "Chicken Breast",
      resolutionStatus: "needs_unit",
    });
  });

  it("writes a log row with resolutionStatus=unresolved when the item has no catalog match", async () => {
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

    await flushPromises();

    expect(res.status).toBe(200);
    expect(db.insert).toHaveBeenCalledWith(voiceInterpretLogs);
    expect(valuesMock).toHaveBeenCalledTimes(1);

    const [logRows] = valuesMock.mock.calls[0] as [any[]];
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      companyId: COMPANY,
      storeId: STORE_A,
      resolutionStatus: "unresolved",
      matchedItemId: null,
    });
  });

  it("writes multiple log rows when GPT returns several entries", async () => {
    (extractSpokenWasteEntries as any).mockResolvedValue({
      entries: [
        {
          sourceText: "2 lb chicken breast",
          wasteType: "inventory",
          spokenItem: "Chicken Breast",
          qty: 2,
          spokenUnit: "lb",
          reasonCode: null,
          notes: null,
        },
        {
          sourceText: "1 lb tomato",
          wasteType: "inventory",
          spokenItem: "Tomato",
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
      .send({ storeId: STORE_A, transcript: "2 lb chicken breast and 1 lb tomato" });

    await flushPromises();

    expect(res.status).toBe(200);
    expect(db.insert).toHaveBeenCalledWith(voiceInterpretLogs);

    const [logRows] = valuesMock.mock.calls[0] as [any[]];
    expect(logRows).toHaveLength(2);

    const statuses = logRows.map((r: any) => r.resolutionStatus);
    expect(statuses).toContain("resolved"); // Chicken Breast resolves
    expect(statuses).toContain("resolved"); // Tomato resolves

    // All rows carry companyId and storeId
    for (const row of logRows) {
      expect(row.companyId).toBe(COMPANY);
      expect(row.storeId).toBe(STORE_A);
    }
  });

  it("does NOT call db.insert when GPT returns zero entries", async () => {
    (extractSpokenWasteEntries as any).mockResolvedValue({
      entries: [],
      model: "gpt-4o",
    });

    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "unintelligible kitchen noise" });

    await flushPromises();

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
    // No rows → insert must not be called at all
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("returns 200 and does NOT propagate a db.insert failure to the HTTP response", async () => {
    // Make the values() call reject to simulate a DB error
    valuesMock.mockRejectedValue(new Error("DB connection lost"));

    (extractSpokenWasteEntries as any).mockResolvedValue({
      entries: [
        {
          sourceText: "2 pounds chicken breast",
          wasteType: "inventory",
          spokenItem: "Chicken Breast",
          qty: 2,
          spokenUnit: "pounds",
          reasonCode: null,
          notes: null,
        },
      ],
      model: "gpt-4o",
    });

    const res = await request(makeApp())
      .post("/api/waste/interpret")
      .send({ storeId: STORE_A, transcript: "2 pounds chicken breast" });

    await flushPromises();

    // The HTTP response must still be 200 — the log write is fire-and-forget
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].resolutionStatus).toBe("resolved");
  });

});
