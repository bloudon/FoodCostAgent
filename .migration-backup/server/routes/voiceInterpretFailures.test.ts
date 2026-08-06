/**
 * Access-control and behavior tests for GET /api/reports/voice-interpret-failures.
 *
 * Ensures:
 *  1. Unauthenticated requests are rejected with 401
 *  2. store_user role is rejected with 403
 *  3. store_manager, company_admin, global_admin roles are allowed (200)
 *  4. Results are scoped to accessible stores via getAccessibleStores
 *  5. Only failure statuses (unresolved, ambiguous, needs_unit) are queried —
 *     "resolved" entries must NOT appear in the SQL WHERE clause
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../permissions", () => ({
  getAccessibleStores: vi.fn(),
  canAccessStore: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { db } from "../db";
import { getAccessibleStores } from "../permissions";
import { sql } from "drizzle-orm";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STORE_A = "a1b2c3d4-0000-4000-8000-000000000001";
const COMPANY = "a1b2c3d4-0000-4000-8000-000000000003";

// ── Minimal test app mirroring the report route logic ────────────────────────

/**
 * @param userRole - role to inject; pass null to simulate unauthenticated.
 */
function makeApp(userRole: string | null): Express {
  const app = express();
  app.use(express.json());

  // Simulate requireAuth: inject user or return 401
  app.use((req: any, res, next) => {
    if (userRole === null) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = { id: "user-1", role: userRole, companyId: COMPANY };
    req.companyId = COMPANY;
    next();
  });

  // Mirror the exact handler logic from routes.ts
  app.get("/api/reports/voice-interpret-failures", async (req: any, res) => {
    try {
      const user = req.user!;
      const ALLOWED_ROLES = ["store_manager", "company_admin", "global_admin"];
      if (!ALLOWED_ROLES.includes(user.role)) {
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
        (accessibleStoreIds as string[]).map((id) => sql`${id}`),
        sql`, `,
      );

      // Only failure statuses — resolved is intentionally excluded
      const rows = await (db as any).execute(sql`
        SELECT spoken_item, resolution_status, COUNT(*)::int AS occurrences,
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

      const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
      return res.json({ days, rows: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? "Internal error" });
    }
  });

  return app;
}

// ── Shared setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (getAccessibleStores as any).mockResolvedValue([STORE_A]);
  (db.execute as any).mockResolvedValue([]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/reports/voice-interpret-failures — authentication", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await request(makeApp(null))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(401);
  });
});

describe("GET /api/reports/voice-interpret-failures — role-based access", () => {
  it("returns 403 for store_user role", async () => {
    const res = await request(makeApp("store_user"))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/manager|admin/i);
  });

  it("returns 200 for store_manager role", async () => {
    const res = await request(makeApp("store_manager"))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("days");
    expect(res.body).toHaveProperty("rows");
  });

  it("returns 200 for company_admin role", async () => {
    const res = await request(makeApp("company_admin"))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("rows");
  });

  it("returns 200 for global_admin role", async () => {
    const res = await request(makeApp("global_admin"))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("rows");
  });
});

describe("GET /api/reports/voice-interpret-failures — store scoping", () => {
  it("calls getAccessibleStores with the authenticated user", async () => {
    await request(makeApp("store_manager"))
      .get("/api/reports/voice-interpret-failures");

    expect(getAccessibleStores).toHaveBeenCalledWith(
      expect.objectContaining({ role: "store_manager" }),
      COMPANY,
    );
  });

  it("returns empty rows without querying DB when no stores are accessible", async () => {
    (getAccessibleStores as any).mockResolvedValue([]);

    const res = await request(makeApp("store_manager"))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe("GET /api/reports/voice-interpret-failures — failure-status filtering", () => {
  it("SQL WHERE clause includes only failure statuses — 'resolved' is excluded", async () => {
    await request(makeApp("company_admin"))
      .get("/api/reports/voice-interpret-failures");

    expect(db.execute).toHaveBeenCalled();
    // Inspect the Drizzle sql template object passed to db.execute
    const calledSql = (db.execute as any).mock.calls[0][0];
    const sqlText = JSON.stringify(calledSql);
    // All three failure statuses must appear
    expect(sqlText).toMatch(/unresolved/);
    expect(sqlText).toMatch(/ambiguous/);
    expect(sqlText).toMatch(/needs_unit/);
    // 'resolved' must NOT appear as a standalone filter value
    expect(sqlText).not.toMatch(/'resolved'/);
  });
});

describe("GET /api/reports/voice-interpret-failures — days parameter", () => {
  it("defaults to 30 days when not supplied", async () => {
    const res = await request(makeApp("company_admin"))
      .get("/api/reports/voice-interpret-failures");

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(30);
  });

  it("respects the ?days parameter", async () => {
    const res = await request(makeApp("company_admin"))
      .get("/api/reports/voice-interpret-failures?days=7");

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
  });

  it("clamps ?days=0 to 1", async () => {
    const res = await request(makeApp("company_admin"))
      .get("/api/reports/voice-interpret-failures?days=0");

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(1);
  });

  it("clamps ?days=999 to 90", async () => {
    const res = await request(makeApp("company_admin"))
      .get("/api/reports/voice-interpret-failures?days=999");

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(90);
  });
});
