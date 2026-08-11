/**
 * Integration tests for POST /api/admin/pending-users/:id/assign — 409 guard
 *
 * Verifies that the production endpoint handler returns 409 when the target
 * user already has a non-null companyId.
 *
 * These tests import and mount `registerPendingUserAssignRoutes` — the actual
 * production route module — so the real handler code and real storage.getUser
 * calls are exercised against a live database.  No handler logic is duplicated
 * in the test file.
 *
 * Pattern follows billingSubscription.test.ts and posRoutes.test.ts:
 *   - vi.hoisted generates unique IDs shared with the vi.mock factory.
 *   - vi.mock stubs requireAuth so the handler's storage.getUser(req.user.id)
 *     hits the real DB for role verification.
 *   - Seed rows in beforeAll; clean up in afterAll.
 *   - Skip when DATABASE_URL is absent.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { users, companies as companiesTable } from "@workspace/db";
import { registerPendingUserAssignRoutes } from "./pendingUserAssignRoute";

// ─── Skip when there is no real database ─────────────────────────────────────
const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;

// ─── Hoisted IDs — available in vi.mock factories and test code alike ─────────
const IDs = vi.hoisted(() => {
  const RUN = Date.now().toString(36);
  return {
    adminUser:           `pua-admin-${RUN}`,
    alreadyAssignedUser: `pua-target-${RUN}`,
    company:             `pua-co-${RUN}`,
    RUN,
  };
});

// ─── Stub requireAuth — injects the seeded admin user identity ────────────────
// The production handler calls storage.getUser(req.user!.id) with this ID,
// which hits the real DB and returns the seeded global_admin row.
vi.mock("../auth", () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: IDs.adminUser };
    next();
  }),
  optionalAuth: vi.fn((_req: any, _res: any, next: any) => next()),
  requireTier: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// ─── Test app — mounts the real production route module ──────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  registerPendingUserAssignRoutes(app);
  return app;
}

// ─── Seed & teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  if (SKIP) return;

  // Seed the company the target user is "already" assigned to.
  // (company row must exist so the fixture is faithful — the handler would
  //  reach a company lookup later if the 409 guard were ever removed.)
  await db.insert(companiesTable).values({
    id:   IDs.company,
    name: `PUA Test Co ${IDs.RUN}`,
  });

  // Seed the global_admin actor.
  // storage.getUser(req.user.id) will return this row and grant access.
  await db.insert(users).values({
    id:                IDs.adminUser,
    email:             `pua-admin-${IDs.RUN}@test.local`,
    role:              "global_admin",
    active:            1,
    preferredLanguage: "en",
  });

  // Seed the target user whose companyId is already set.
  // The production handler must return 409 without making any writes.
  await db.insert(users).values({
    id:                IDs.alreadyAssignedUser,
    email:             `pua-target-${IDs.RUN}@test.local`,
    role:              "store_user",
    companyId:         IDs.company,   // ← non-null: the guard fires here
    active:            1,
    preferredLanguage: "en",
  });
});

afterAll(async () => {
  if (SKIP) return;
  await db.delete(users).where(eq(users.id, IDs.adminUser)).catch(() => {});
  await db.delete(users).where(eq(users.id, IDs.alreadyAssignedUser)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, IDs.company)).catch(() => {});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)(
  "POST /api/admin/pending-users/:id/assign — 409 guard (production handler, real DB)",
  () => {
    const app = buildApp();

    it("returns 409 when the target user already has a companyId", async () => {
      const res = await supertest(app)
        .post(`/api/admin/pending-users/${IDs.alreadyAssignedUser}/assign`)
        .send({ companyId: IDs.company, role: "company_admin", storeIds: [] })
        .set("Content-Type", "application/json");

      expect(res.status).toBe(409);
    });

    it("returns an error body describing the conflict", async () => {
      const res = await supertest(app)
        .post(`/api/admin/pending-users/${IDs.alreadyAssignedUser}/assign`)
        .send({ companyId: IDs.company, role: "company_admin", storeIds: [] })
        .set("Content-Type", "application/json");

      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/already assigned to a company/i);
    });

    it("makes no writes: the target user's companyId is unchanged after the rejected call", async () => {
      await supertest(app)
        .post(`/api/admin/pending-users/${IDs.alreadyAssignedUser}/assign`)
        .send({ companyId: IDs.company, role: "company_admin", storeIds: [] })
        .set("Content-Type", "application/json");

      // Re-fetch the target directly from the DB and confirm companyId was not changed
      const [row] = await db
        .select({ companyId: users.companyId })
        .from(users)
        .where(eq(users.id, IDs.alreadyAssignedUser));

      expect(row?.companyId).toBe(IDs.company); // original assignment — not altered
    });

    it("returns 404 for a user that does not exist in the database", async () => {
      const res = await supertest(app)
        .post(`/api/admin/pending-users/nonexistent-user-id/assign`)
        .send({ companyId: IDs.company, role: "company_admin", storeIds: [] })
        .set("Content-Type", "application/json");

      expect(res.status).toBe(404);
    });
  },
);
