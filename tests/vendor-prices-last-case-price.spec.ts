/**
 * Automated tests for GET /api/inventory-items/:id/vendor-prices
 *
 * These tests guard against a regression where the endpoint derived casePrice
 * from unitPrice × caseSize instead of reading the stored lastCasePrice column.
 * The fix reads lastCasePrice directly; these tests verify it stays that way.
 *
 * Suite 1 — Auth contract (no DB seeding required):
 *   • No session → 401
 *
 * Suite 2 — Integration (real DB, authenticated):
 *   • vendorItem with lastCasePrice ≠ unitPrice × caseSize → stored value returned
 *   • vendorItem with lastCasePrice = null → fallback (unitPrice × caseSize) returned
 *
 * Prerequisites (dev database):
 *   Email: admin@brians.pizza  /  Password: test123
 *
 * Dev helpers used (dev-only endpoints in routes.ts):
 *   GET  /api/dev/test/vendor-price-anchors  — returns { vendorId, purchaseUnitId, inventoryItemId }
 *   POST /api/dev/test/vendor-price-state    — seeds a vendorItem row
 *   DEL  /api/dev/test/vendor-price-state/:id — cleans up seeded row
 */

import { test, expect } from 'playwright/test';
import type { APIRequestContext } from 'playwright/test';

const BASE_URL      = 'http://localhost:5000';
const TEST_EMAIL    = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function login(request: APIRequestContext): Promise<boolean> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  return res.status() === 200;
}

/**
 * Fetches FK anchor IDs via the lightweight dev helper rather than the full
 * /api/inventory-items route, which triggers expensive enrichment queries that
 * can crash the server when called with an empty batch in some environments.
 */
async function getAnchors(
  request: APIRequestContext,
): Promise<{ vendorId: string; purchaseUnitId: string; inventoryItemId: string } | null> {
  const res = await request.get(`${BASE_URL}/api/dev/test/vendor-price-anchors`);
  if (res.status() !== 200) return null;
  return res.json() as Promise<{ vendorId: string; purchaseUnitId: string; inventoryItemId: string }>;
}

// ---------------------------------------------------------------------------
// Suite 1: Auth contract
// ---------------------------------------------------------------------------

test.describe('GET /api/inventory-items/:id/vendor-prices — auth contract', () => {
  test('returns 401 when called without a session', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/inventory-items/nonexistent-id/vendor-prices`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Integration — lastCasePrice vs. derived fallback
// ---------------------------------------------------------------------------

test.describe('GET /api/inventory-items/:id/vendor-prices — lastCasePrice behaviour', () => {
  test('returns the stored lastCasePrice when it differs from unitPrice × caseSize', async ({ request }) => {
    const loggedIn = await login(request);
    if (!loggedIn) {
      test.skip(true, 'Could not log in as test user — skipping integration test');
      return;
    }

    const anchors = await getAnchors(request);
    if (!anchors) {
      test.skip(true, 'Dev anchor helper not available or no data in dev DB — skipping integration test');
      return;
    }

    const { vendorId, purchaseUnitId, inventoryItemId } = anchors;

    // lastCasePrice (50.00) intentionally differs from unitPrice × caseSize (2.00 × 10 = 20.00)
    const caseSize      = 10;
    const lastPrice     = 2.0;
    const lastCasePrice = 50.0;
    const vendorSku     = `ci-vendor-price-stored-${Date.now()}`;

    const seedRes = await request.post(`${BASE_URL}/api/dev/test/vendor-price-state`, {
      data: { vendorId, purchaseUnitId, inventoryItemId, vendorSku, caseSize, lastPrice, lastCasePrice },
      headers: { 'Content-Type': 'application/json' },
    });

    if (seedRes.status() === 404 || seedRes.status() === 401) {
      test.skip(true, 'Dev seed helper not available — skipping');
      return;
    }

    expect(seedRes.status(), `Seed must succeed, got ${seedRes.status()}: ${await seedRes.text()}`).toBe(200);
    const { vendorItemId } = await seedRes.json() as { vendorItemId: string };

    try {
      const res = await request.get(`${BASE_URL}/api/inventory-items/${inventoryItemId}/vendor-prices`);
      expect(res.status(), 'Endpoint must return 200').toBe(200);

      const body = await res.json() as {
        vendorPrices: Array<{ vendorId: string; casePrice: number; unitPrice: number; caseSize: number }>;
      };

      expect(Array.isArray(body.vendorPrices), 'vendorPrices must be an array').toBe(true);

      // Identify the seeded row by vendorId + unit price + caseSize
      const seeded = body.vendorPrices.find(
        (vp) => vp.vendorId === vendorId && Math.abs(vp.unitPrice - lastPrice) < 0.0001 && vp.caseSize === caseSize,
      );

      expect(seeded, 'Seeded vendor price entry must appear in the response').toBeDefined();
      expect(
        Math.abs(seeded!.casePrice - lastCasePrice),
        `casePrice must equal the stored lastCasePrice (${lastCasePrice}), not the derived value (${lastPrice * caseSize})`,
      ).toBeLessThan(0.001);
    } finally {
      await request.delete(`${BASE_URL}/api/dev/test/vendor-price-state/${vendorItemId}`);
    }
  });

  test('falls back to unitPrice × caseSize when lastCasePrice is 0 (unset)', async ({ request }) => {
    const loggedIn = await login(request);
    if (!loggedIn) {
      test.skip(true, 'Could not log in as test user — skipping integration test');
      return;
    }

    const anchors = await getAnchors(request);
    if (!anchors) {
      test.skip(true, 'Dev anchor helper not available or no data in dev DB — skipping integration test');
      return;
    }

    const { vendorId, purchaseUnitId, inventoryItemId } = anchors;

    const caseSize        = 8;
    const lastPrice       = 3.5;
    const expectedDerived = lastPrice * caseSize; // 28.00
    const vendorSku       = `ci-vendor-price-zero-${Date.now()}`;

    // lastCasePrice = 0 triggers the fallback branch (vi.lastCasePrice > 0 is false)
    const seedRes = await request.post(`${BASE_URL}/api/dev/test/vendor-price-state`, {
      data: { vendorId, purchaseUnitId, inventoryItemId, vendorSku, caseSize, lastPrice, lastCasePrice: 0 },
      headers: { 'Content-Type': 'application/json' },
    });

    if (seedRes.status() === 404 || seedRes.status() === 401) {
      test.skip(true, 'Dev seed helper not available — skipping');
      return;
    }

    expect(seedRes.status(), `Seed must succeed, got ${seedRes.status()}: ${await seedRes.text()}`).toBe(200);
    const { vendorItemId } = await seedRes.json() as { vendorItemId: string };

    try {
      const res = await request.get(`${BASE_URL}/api/inventory-items/${inventoryItemId}/vendor-prices`);
      expect(res.status(), 'Endpoint must return 200').toBe(200);

      const body = await res.json() as {
        vendorPrices: Array<{ vendorId: string; casePrice: number; unitPrice: number; caseSize: number }>;
      };

      expect(Array.isArray(body.vendorPrices), 'vendorPrices must be an array').toBe(true);

      const seeded = body.vendorPrices.find(
        (vp) => vp.vendorId === vendorId && Math.abs(vp.unitPrice - lastPrice) < 0.0001 && vp.caseSize === caseSize,
      );

      expect(seeded, 'Seeded vendor price entry must appear in the response').toBeDefined();
      expect(
        Math.abs(seeded!.casePrice - expectedDerived),
        `casePrice must fall back to unitPrice × caseSize (${expectedDerived}) when lastCasePrice is null`,
      ).toBeLessThan(0.001);
    } finally {
      await request.delete(`${BASE_URL}/api/dev/test/vendor-price-state/${vendorItemId}`);
    }
  });
});
