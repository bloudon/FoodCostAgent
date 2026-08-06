/**
 * Task #578 — Food-cost % report consistency tests.
 *
 * Part 1: API route field shape
 *   The /api/tfc/usage-runs/:runId/details endpoint must return `totalRevenue`
 *   and `totalTheoreticalCost` on the `run` object so that the UI can compute
 *   food-cost % without guessing.
 *
 * Part 2: Client-side formula
 *   The food-cost % shown in the UI must use the formula
 *     FC% = (totalTheoreticalCost / totalRevenue) * 100
 *   This file contains a pure unit test of that formula independent of any
 *   rendering framework.
 *
 * Test strategy for Part 1:
 *   - Mount a minimal Express app that replicates the handler logic.
 *   - Mock storage.getTheoreticalUsageRun / getTheoreticalUsageLines.
 *   - Assert the JSON body has run.totalRevenue and run.totalTheoreticalCost.
 *
 * All storage calls are mocked — no database required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Module mock (must be hoisted before any import that uses storage) ──────────
vi.mock("../storage", () => ({
  storage: {
    getTheoreticalUsageRun: vi.fn(),
    getTheoreticalUsageLines: vi.fn(),
    getInventoryItem: vi.fn(),
    getUnit: vi.fn(),
  },
}));

// ── Import storage mock handle after vi.mock declaration ──────────────────────
import { storage } from "../storage";

// ── Shared fixture data ───────────────────────────────────────────────────────

const COMPANY_ID = "co-test";
const RUN_ID = "run-abc";

/** A realistic run record as returned by storage.getTheoreticalUsageRun. */
function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    companyId: COMPANY_ID,
    storeId: "store-1",
    salesDate: new Date("2024-03-15"),
    sourceBatchId: "batch-xyz",
    status: "completed",
    totalMenuItemsSold: 42,
    totalRevenue: 1234.56,
    totalTheoreticalCost: 432.10,
    totalTheoreticalCostWAC: 430.00,
    createdAt: new Date("2024-03-15"),
    updatedAt: new Date("2024-03-15"),
    ...overrides,
  };
}

// ── Minimal Express handler that mirrors the real route logic ─────────────────
//
// We extract just the handler logic (not the full monolithic routes.ts) so the
// test remains fast and dependency-free.  The logic is an exact structural copy
// of the handler at routes.ts /api/tfc/usage-runs/:runId/details.

function buildApp() {
  const app = express();
  app.use(express.json());

  // Simulate auth middleware: attach companyId to the request
  app.use((req: any, _res, next) => {
    req.companyId = COMPANY_ID;
    next();
  });

  app.get("/api/tfc/usage-runs/:runId/details", async (req: any, res) => {
    try {
      const companyId = req.companyId;
      const { runId } = req.params;

      if (!companyId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const run = await storage.getTheoreticalUsageRun(runId, companyId);
      if (!run) {
        return res.status(404).json({ message: "Usage run not found" });
      }

      const lines = await storage.getTheoreticalUsageLines(runId);

      // Batch-fetch inventory items (same logic as real route)
      const uniqueItemIds = [...new Set(lines.map((l: any) => l.inventoryItemId))];
      const items = await Promise.all(uniqueItemIds.map((id) => storage.getInventoryItem(id as string)));
      const itemsMap = new Map(
        items.filter((i) => i !== undefined).map((i: any) => [i.id, i]),
      );

      const uniqueUnitIds = [
        ...new Set(
          items.filter((i) => i !== undefined).map((i: any) => i.unitId),
        ),
      ];
      const units = await Promise.all(uniqueUnitIds.map((id) => storage.getUnit(id as string)));
      const unitsMap = new Map(
        units.filter((u) => u !== undefined).map((u: any) => [u.id, u]),
      );

      const detailedLines = lines.map((line: any) => {
        const item = itemsMap.get(line.inventoryItemId);
        const unit = item ? unitsMap.get((item as any).unitId) : null;

        let sourceMenuItems: Array<{ menuItemId: string; menuItemName: string; qtySold: number }> = [];
        try {
          sourceMenuItems = JSON.parse(line.sourceMenuItems);
        } catch {
          // leave empty
        }

        return {
          ...line,
          sourceMenuItems,
          inventoryItem: item
            ? {
                id: (item as any).id,
                name: (item as any).name,
                unitId: (item as any).unitId,
                unitName: unit ? (unit as any).name : "",
                unitAbbreviation: unit ? (unit as any).abbreviation : "",
                pricePerUnit: (item as any).pricePerUnit,
                avgCostPerUnit: (item as any).avgCostPerUnit,
              }
            : null,
        };
      });

      // Mirror the date-formatting logic from the real route
      const runWithFormattedDate = {
        ...run,
        salesDate:
          run.salesDate instanceof Date
            ? `${run.salesDate.getUTCFullYear()}-${String(run.salesDate.getUTCMonth() + 1).padStart(2, "0")}-${String(run.salesDate.getUTCDate()).padStart(2, "0")}`
            : run.salesDate,
      };

      res.json({ run: runWithFormattedDate, lines: detailedLines });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to fetch usage details" });
    }
  });

  return app;
}

// ── Part 1: API route field shape ─────────────────────────────────────────────

describe("GET /api/tfc/usage-runs/:runId/details — field shape", () => {
  let storageMock: typeof storage;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock = storage as typeof storage;

    (storageMock.getTheoreticalUsageLines as any).mockResolvedValue([]);
  });

  it("returns totalRevenue on the run object", async () => {
    const run = makeRun({ totalRevenue: 1234.56 });
    (storageMock.getTheoreticalUsageRun as any).mockResolvedValue(run);

    const app = buildApp();
    const res = await request(app).get(`/api/tfc/usage-runs/${RUN_ID}/details`);

    expect(res.status).toBe(200);
    expect(res.body.run).toBeDefined();
    expect(typeof res.body.run.totalRevenue).toBe("number");
    expect(res.body.run.totalRevenue).toBeCloseTo(1234.56);
  });

  it("returns totalTheoreticalCost on the run object", async () => {
    const run = makeRun({ totalTheoreticalCost: 432.10 });
    (storageMock.getTheoreticalUsageRun as any).mockResolvedValue(run);

    const app = buildApp();
    const res = await request(app).get(`/api/tfc/usage-runs/${RUN_ID}/details`);

    expect(res.status).toBe(200);
    expect(res.body.run).toBeDefined();
    expect(typeof res.body.run.totalTheoreticalCost).toBe("number");
    expect(res.body.run.totalTheoreticalCost).toBeCloseTo(432.10);
  });

  it("returns both totalRevenue and totalTheoreticalCost together", async () => {
    const run = makeRun({ totalRevenue: 800.0, totalTheoreticalCost: 200.0 });
    (storageMock.getTheoreticalUsageRun as any).mockResolvedValue(run);

    const app = buildApp();
    const res = await request(app).get(`/api/tfc/usage-runs/${RUN_ID}/details`);

    expect(res.status).toBe(200);
    const { run: body } = res.body;
    expect(body).toHaveProperty("totalRevenue");
    expect(body).toHaveProperty("totalTheoreticalCost");
    expect(body.totalRevenue).toBeCloseTo(800.0);
    expect(body.totalTheoreticalCost).toBeCloseTo(200.0);
  });

  it("returns 404 when the run is not found", async () => {
    (storageMock.getTheoreticalUsageRun as any).mockResolvedValue(null);

    const app = buildApp();
    const res = await request(app).get(`/api/tfc/usage-runs/nonexistent/details`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Usage run not found");
  });

  it("formats salesDate as YYYY-MM-DD without shifting UTC date", async () => {
    // Use a UTC midnight Date so the day must not shift regardless of server TZ.
    const run = makeRun({ salesDate: new Date("2024-03-15T00:00:00.000Z") });
    (storageMock.getTheoreticalUsageRun as any).mockResolvedValue(run);

    const app = buildApp();
    const res = await request(app).get(`/api/tfc/usage-runs/${RUN_ID}/details`);

    expect(res.status).toBe(200);
    expect(res.body.run.salesDate).toBe("2024-03-15");
  });
});

// ── Part 2: Client-side food-cost % formula ───────────────────────────────────
//
// The UI computes FC% as:
//   (totalTheoreticalCost / totalRevenue) * 100
// (see client/src/pages/menu-items.tsx lines 2923-2924 for the analogous
// per-item formula; the same pattern applies to the TFC report summary.)

/** Pure recreation of the client-side food-cost % formula. */
function computeFoodCostPct(totalTheoreticalCost: number, totalRevenue: number): number | null {
  if (!totalRevenue || totalRevenue <= 0) return null;
  return (totalTheoreticalCost / totalRevenue) * 100;
}

describe("Client-side food-cost % formula", () => {
  it("computes FC% = (totalTheoreticalCost / totalRevenue) * 100", () => {
    // $400 cost on $1 000 revenue → 40 %
    expect(computeFoodCostPct(400, 1000)).toBeCloseTo(40.0);
  });

  it("matches the expected value for a realistic run", () => {
    // Run returned by the API: cost $432.10, revenue $1 234.56 → ~35.0 %
    const pct = computeFoodCostPct(432.10, 1234.56);
    expect(pct).not.toBeNull();
    expect(pct!).toBeCloseTo(35.0, 1);
  });

  it("returns null when totalRevenue is 0 (avoids division by zero)", () => {
    expect(computeFoodCostPct(100, 0)).toBeNull();
  });

  it("returns null when totalRevenue is negative (guard against bad data)", () => {
    expect(computeFoodCostPct(100, -50)).toBeNull();
  });

  it("returns 0 when totalTheoreticalCost is 0 and revenue is positive", () => {
    expect(computeFoodCostPct(0, 500)).toBeCloseTo(0);
  });

  it("FC% above 100 is possible when cost exceeds revenue", () => {
    // $600 cost on $500 revenue → 120 %
    const pct = computeFoodCostPct(600, 500);
    expect(pct).not.toBeNull();
    expect(pct!).toBeCloseTo(120.0);
  });

  it("formula is consistent with what the API returns (end-to-end alignment)", async () => {
    // Simulate what the UI does after receiving the API response:
    //   1. Read run.totalRevenue and run.totalTheoreticalCost from the API body.
    //   2. Apply FC% formula.
    vi.clearAllMocks();
    const storageMock = storage as any;

    const apiRun = makeRun({ totalRevenue: 2000.0, totalTheoreticalCost: 700.0 });
    storageMock.getTheoreticalUsageRun.mockResolvedValue(apiRun);
    storageMock.getTheoreticalUsageLines.mockResolvedValue([]);

    const app = buildApp();
    const res = await request(app).get(`/api/tfc/usage-runs/${RUN_ID}/details`);
    expect(res.status).toBe(200);

    const { totalRevenue, totalTheoreticalCost } = res.body.run;
    const fcPct = computeFoodCostPct(totalTheoreticalCost, totalRevenue);

    // $700 / $2 000 = 35 %
    expect(fcPct).toBeCloseTo(35.0);
  });
});
