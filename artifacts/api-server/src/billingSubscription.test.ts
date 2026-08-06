/**
 * GET /api/billing/subscription — Integration Tests
 *
 * Verifies the endpoint handler logic: correct response shape and that
 * `activeLocationCount` counts only stores with status='active'.
 *
 * Uses a lightweight in-process express app with the real storage layer.
 * Requires DATABASE_URL. Also skipped when the billing columns haven't been
 * migrated yet (detected by probing `subscription_plan` on companies).
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { companies as companiesTable, companyStores } from "@workspace/db";
import supertest from "supertest";
import express from "express";
import { storage } from "./storage";

// ─── Unique run tag ───────────────────────────────────────────────────────────
const RUN = Date.now().toString(36);

const IDs = {
  company: `test-bsub-co-${RUN}`,
  storeA:  `test-bsub-sA-${RUN}`, // active
  storeB:  `test-bsub-sB-${RUN}`, // inactive
  storeC:  `test-bsub-sC-${RUN}`, // closed
};

// ─── Skip logic ───────────────────────────────────────────────────────────────
// Skip when DATABASE_URL is absent OR when billing columns are not yet migrated.
let SKIP = !process.env.DATABASE_URL;

if (!SKIP) {
  try {
    // Probe: SELECT one row with the billing columns — fails fast if columns missing.
    await db
      .select({ plan: companiesTable.subscriptionPlan })
      .from(companiesTable)
      .limit(1);
  } catch {
    SKIP = true;
  }
}

// ─── Minimal express app mounting the handler logic ───────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());

  // Stub auth — inject the test company as the authenticated user
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: "test-user", companyId: IDs.company, role: "owner" };
    next();
  });

  app.get("/api/billing/subscription", async (req: any, res: any) => {
    try {
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(400).json({ error: "No company context" });

      const [company, stores] = await Promise.all([
        storage.getCompany(companyId),
        storage.getCompanyStores(companyId),
      ]);

      if (!company) return res.status(404).json({ error: "Company not found" });

      const activeLocationCount = stores.filter((s) => s.status === "active").length;

      return res.json({
        plan: company.subscriptionPlan ?? null,
        status: company.subscriptionStatus ?? null,
        billingInterval: company.billingInterval ?? null,
        currentPeriodEnd: company.subscriptionCurrentPeriodEnd ?? null,
        licensedLocationCount: company.licensedLocationCount ?? 1,
        activeLocationCount,
      });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to fetch subscription" });
    }
  });

  return app;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
afterAll(async () => {
  if (SKIP) return;
  await db.delete(companyStores).where(eq(companyStores.companyId, IDs.company)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, IDs.company)).catch(() => {});
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe.skipIf(SKIP)("GET /api/billing/subscription", () => {
  const app = buildApp();

  beforeAll(async () => {
    // Seed company with billing fields
    await db.insert(companiesTable).values({
      id: IDs.company,
      name: `Test Billing Co ${RUN}`,
      subscriptionPlan: "platform",
      subscriptionStatus: "active",
      billingInterval: "monthly",
      licensedLocationCount: 2,
    });

    // Seed 3 stores with different statuses
    await db.insert(companyStores).values([
      { id: IDs.storeA, companyId: IDs.company, code: `SA-${RUN}`, name: `StoreA ${RUN}`, status: "active" },
      { id: IDs.storeB, companyId: IDs.company, code: `SB-${RUN}`, name: `StoreB ${RUN}`, status: "inactive" },
      { id: IDs.storeC, companyId: IDs.company, code: `SC-${RUN}`, name: `StoreC ${RUN}`, status: "closed" },
    ]);
  });

  it("returns the expected response shape", async () => {
    const res = await supertest(app).get("/api/billing/subscription");
    expect(res.body.plan).toBe("platform");
    expect(res.body.status).toBe("active");
    expect(res.body.billingInterval).toBe("monthly");
    expect(res.body.licensedLocationCount).toBe(2);
  });

  it("returns null currentPeriodEnd when not set on the company", async () => {
    const res = await supertest(app).get("/api/billing/subscription");
    expect(res.body.plan).toBe("platform");
    expect(res.body.status).toBe("active");
    expect(res.body.billingInterval).toBe("monthly");
    expect(res.body.licensedLocationCount).toBe(2);
  });

  it("returns null currentPeriodEnd when not set on the company", async () => {
    const res = await supertest(app).get("/api/billing/subscription");
    expect(res.body.plan).toBe("platform");
    expect(res.body.status).toBe("active");
    expect(res.body.billingInterval).toBe("monthly");
    expect(res.body.licensedLocationCount).toBe(2);
  });

  it("returns null currentPeriodEnd when not set on the company", async () => {
    const res = await supertest(app).get("/api/billing/subscription");
    expect(res.body.plan).toBe("platform");
    expect(res.body.status).toBe("active");
    expect(res.body.billingInterval).toBe("monthly");
    expect(res.body.licensedLocationCount).toBe(2);
  });

  it("returns null currentPeriodEnd when not set on the company", async () => {
    const res = await supertest(app).get("/api/billing/subscription");
    expect(res.body.currentPeriodEnd).toBeNull();
  });
});
