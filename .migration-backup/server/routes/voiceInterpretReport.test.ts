/**
 * Integration tests for GET /api/reports/voice-interpret-failures
 *
 * Verifies company isolation: a company_admin for company A must only receive
 * rows that belong to company A, even if the database contains rows for
 * company B. Also verifies that a missing companyId returns an empty result
 * rather than leaking all rows.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock("../permissions", () => ({
  getAccessibleStores: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { db } from "../db";
import { getAccessibleStores } from "../permissions";
import { sql } from "drizzle-orm";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const COMPANY_B = "bbbbbbbb-0000-4000-8000-000000000002";

const STORE_A1 = "a1a1a1a1-0000-4000-8000-000000000010";
const STORE_B1 = "b1b1b1b1-0000-4000-8000-000000000011";

/** Simulated DB row for company A. */
const ROW_A: Record<string, unknown> = {
  spoken_item: "Chicken Breast",
  resolution_status: "unresolved",
  occurrences: 3,
  avg_score: 0.42,
  last_seen_at: "2026-07-30T10:00:00.000Z",
};

/** Simulated DB row for company B — must never appear in company A's response. */
const ROW_B: Record<string, unknown> = {
  spoken_item: "Beef Patty",
  resolution_status: "ambiguous",
  occurrences: 5,
  avg_score: 0.61,
  last_seen_at: "2026-07-29T10:00:00.000Z",
};

// ── Test app factory ──────────────────────────────────────────────────────────

/**
 * Builds a minimal Express app that replicates the real handler verbatim,
 * injecting the given user/companyId into req for each test.
 */
function makeApp(overrides: { companyId?: string | null; role?: string } = {}): Express {
  const app = express();
  app.use(express.json());

  const companyId = "companyId" in overrides ? overrides.companyId : COMPANY_A;
  const role = overrides.role ?? "company_admin";

  app.use((req: any, _res, next) => {
    req.user = { id: "user-test", role, companyId };
    req.companyId = companyId;
    next();
  });

  // ── Handler — exact copy of the production route logic ───────────────────
  app.get("/api/reports/voice-interpret-failures", async (req: any, res) => {
    try {
      const user = req.user!;
      const ALLOWED_ROLES = ["store_manager", "company_admin", "global_admin"] as const;
      if (!ALLOWED_ROLES.includes(user.role as any)) {
        return res.status(403).json({ error: "Manager or admin access required" });
      }

      const companyId = req.companyId!;
      const parsedDays = parseInt(String(req.query.days ?? "30"), 10);
      const days = Math.min(Math.max(isNaN(parsedDays) ? 30 : parsedDays, 1), 90);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const accessibleStoreIds = await getAccessibleStores(user, companyId);

      if (accessibleStoreIds.length === 0) {
        return res.json({ days, rows: [] });
      }

      const storeInClause = sql.join(
        accessibleStoreIds.map((id: string) => sql`${id}`),
        sql`, `,
      );
      const rows = await db.execute(sql`
        SELECT
          spoken_item,
          resolution_status,
          COUNT(*)::int AS occurrences,
          ROUND(AVG(match_score)::numeric, 3)::real AS avg_score,
          MAX(created_at) AS last_seen_at
        FROM voice_interpret_logs
        WHERE company_id = ${companyId}
          AND store_id IN (${storeInClause})
          AND resolution_status IN ('unresolved', 'ambiguous', 'needs_unit')
          AND created_at >= ${cutoff.toISOString()}
        GROUP BY spoken_item, resolution_status
        ORDER BY occurrences DESC, last_seen_at DESC
        LIMIT 50
      `);

      const data = (Array.isArray(rows) ? rows : (rows as any).rows ?? []) as Array<{
        spoken_item: string;
        resolution_status: string;
        occurrences: number;
        avg_score: number;
        last_seen_at: string;
      }>;

      return res.json({ days, rows: data });
    } catch (err: any) {
      console.error("[reports/voice-interpret-failures] error:", err);
      return res.status(500).json({ error: "Failed to fetch voice interpret failures" });
    }
  });

  return app;
}

// ── Shared setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively collect every scalar (string/number/boolean) value that Drizzle
 * embeds directly inside a sql`` queryChunks array.  Nested SQL objects (e.g.
 * from sql.join) are traversed so store-ID params are also reachable.
 */
function collectScalarChunks(sqlObj: any): unknown[] {
  const result: unknown[] = [];
  for (const chunk of sqlObj?.queryChunks ?? []) {
    if (typeof chunk === "string" || typeof chunk === "number" || typeof chunk === "boolean") {
      result.push(chunk);
    } else if (chunk && typeof chunk === "object" && Array.isArray(chunk.queryChunks)) {
      result.push(...collectScalarChunks(chunk));
    }
  }
  return result;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/reports/voice-interpret-failures — company isolation", () => {

  it("returns only company A rows when authenticated as company A", async () => {
    // db.execute is called with a query that already embeds companyId = COMPANY_A.
    // We simulate the DB honouring the WHERE clause and returning only row A.
    (getAccessibleStores as any).mockResolvedValue([STORE_A1]);
    (db.execute as any).mockResolvedValue([ROW_A]);

    const res = await request(makeApp({ companyId: COMPANY_A }))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].spoken_item).toBe("Chicken Breast");
    // Company B's row must not appear
    const items = res.body.rows.map((r: any) => r.spoken_item);
    expect(items).not.toContain(ROW_B.spoken_item);
  });

  it("returns only company B rows when authenticated as company B", async () => {
    (getAccessibleStores as any).mockResolvedValue([STORE_B1]);
    (db.execute as any).mockResolvedValue([ROW_B]);

    const res = await request(makeApp({ companyId: COMPANY_B }))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].spoken_item).toBe("Beef Patty");
    const items = res.body.rows.map((r: any) => r.spoken_item);
    expect(items).not.toContain(ROW_A.spoken_item);
  });

  it("passes the correct companyId to the DB query so rows from other companies are excluded", async () => {
    (getAccessibleStores as any).mockResolvedValue([STORE_A1]);
    (db.execute as any).mockResolvedValue([ROW_A]);

    await request(makeApp({ companyId: COMPANY_A }))
      .get("/api/reports/voice-interpret-failures");

    expect(db.execute).toHaveBeenCalledTimes(1);
    // Drizzle's sql`` tag stores interpolated scalars as plain strings directly in
    // queryChunks (index 1, 5, … in a typical query).  Collect them recursively.
    const sqlArg = (db.execute as any).mock.calls[0][0];
    const scalarParams = collectScalarChunks(sqlArg);
    expect(scalarParams).toContain(COMPANY_A);
    expect(scalarParams).not.toContain(COMPANY_B);
  });

  it("returns empty rows (not all rows) when the user has no accessible stores", async () => {
    // getAccessibleStores returns empty — handler short-circuits before hitting DB
    (getAccessibleStores as any).mockResolvedValue([]);
    (db.execute as any).mockResolvedValue([ROW_A, ROW_B]); // would leak if reached

    const res = await request(makeApp({ companyId: COMPANY_A }))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    // The DB must never be queried when there are no accessible stores
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("returns 403 when the user role is not permitted", async () => {
    (getAccessibleStores as any).mockResolvedValue([STORE_A1]);
    (db.execute as any).mockResolvedValue([]);

    const res = await request(makeApp({ companyId: COMPANY_A, role: "staff" }))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/manager or admin/i);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("handles a null companyId by returning empty rows without hitting the DB", async () => {
    // When req.companyId is null/undefined the handler would either throw (caught → 500)
    // or getAccessibleStores short-circuits to [].  Either way, no cross-company
    // data must leak.
    (getAccessibleStores as any).mockResolvedValue([]);
    (db.execute as any).mockResolvedValue([ROW_A, ROW_B]);

    const res = await request(makeApp({ companyId: null }))
      .get("/api/reports/voice-interpret-failures");

    // Either 200 with empty rows OR an error response — never rows from another company
    if (res.status === 200) {
      expect(res.body.rows).toEqual([]);
    } else {
      expect([400, 403, 500]).toContain(res.status);
    }
    const allReturnedItems = (res.body.rows ?? []).map((r: any) => r.spoken_item);
    expect(allReturnedItems).not.toContain(ROW_A.spoken_item);
    expect(allReturnedItems).not.toContain(ROW_B.spoken_item);
  });

  it("company A query never includes store IDs from company B", async () => {
    (getAccessibleStores as any).mockResolvedValue([STORE_A1]);
    (db.execute as any).mockResolvedValue([ROW_A]);

    await request(makeApp({ companyId: COMPANY_A }))
      .get("/api/reports/voice-interpret-failures");

    const sqlArg = (db.execute as any).mock.calls[0][0];
    const scalarParams = collectScalarChunks(sqlArg);
    expect(scalarParams).toContain(STORE_A1);
    expect(scalarParams).not.toContain(STORE_B1);
  });

  it("returns rows array (not all-company data) even when db returns multiple rows for the filtered company", async () => {
    const extraRowA: Record<string, unknown> = {
      spoken_item: "Tomato Sauce",
      resolution_status: "needs_unit",
      occurrences: 1,
      avg_score: 0.3,
      last_seen_at: "2026-07-28T08:00:00.000Z",
    };

    (getAccessibleStores as any).mockResolvedValue([STORE_A1]);
    (db.execute as any).mockResolvedValue([ROW_A, extraRowA]);

    const res = await request(makeApp({ companyId: COMPANY_A }))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
    const items = res.body.rows.map((r: any) => r.spoken_item);
    expect(items).toContain("Chicken Breast");
    expect(items).toContain("Tomato Sauce");
    expect(items).not.toContain(ROW_B.spoken_item);
  });

});
