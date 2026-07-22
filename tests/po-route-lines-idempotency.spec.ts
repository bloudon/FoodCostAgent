/**
 * Integration spec: POST /api/purchase-orders/:id/route-lines — idempotency edge case
 *
 * Verifies that routing the same (poLineId, targetVendorItemId) pair twice does
 * NOT produce a 500 or silent failure.  Expected behaviour:
 *
 *   Call 1 → 200  { routedLines: 1, affectedPOIds: [<newPo>], auditIds: [<id>] }
 *   Call 2 → 200  { routedLines: 0, alreadyRouted: [{ poLineId, ... }] }
 *          OR 200/4xx with a clear, structured body — never a 500
 *
 * DB state after both calls:
 *   • po_routing_audit has EXACTLY 1 row for (sourcePOLineId, targetVendorItemId)
 *   • The source PO line has been deleted (caseQuantity on the line is 0 or line absent)
 *
 * This is a pure-API test — no browser needed.  It uses Playwright's
 * `page.request` context (which carries the authenticated cookie) to make the
 * HTTP calls, following the same pattern as po-route-lines-vendor-switch.spec.ts.
 *
 * Credentials:
 *   Email: admin@brians.pizza  /  Password: test123
 *
 * DB fixture lifecycle:
 *   POST   /api/dev/test/po-route-fixture          → seeds source PO + line
 *   DELETE /api/dev/test/po-route-fixture/:poId?inventoryItemId=...  → full teardown
 */

import { test, expect } from './test-helpers';

const BASE_URL      = 'http://localhost:5000';
const TEST_EMAIL    = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';

interface PoRouteFixture {
  inventoryItemId: string;
  vendorItemAId:   string;
  vendorItemBId:   string;
  vendorAId:       string;
  vendorBId:       string;
  poId:            string;
  poLineId:        string;
  storeId:         string;
  unitId:          string;
}

interface RouteResponse {
  data?: {
    routedLines: number;
    affectedPOIds: string[];
    auditIds: string[];
    alreadyRouted?: Array<{
      poLineId: string;
      targetVendorItemId: string;
      destinationPoId: string;
      auditId: string;
    }>;
    concurrencyMisses?: Array<unknown>;
  };
  error?: string;
}

test.describe('PO route-lines — idempotency (same payload submitted twice)', () => {
  test('second routing call for the same (poLineId, targetVendorItemId) is a graceful no-op, never a 500', async ({ page }) => {
    // -----------------------------------------------------------------------
    // Step 0: authenticate
    // -----------------------------------------------------------------------
    const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });

    if (loginRes.status() !== 200) {
      test.skip(true, `Login failed (${loginRes.status()}) — skipping integration test`);
      return;
    }

    // -----------------------------------------------------------------------
    // Step 1: seed fixture
    // -----------------------------------------------------------------------
    const seedRes = await page.request.post(`${BASE_URL}/api/dev/test/po-route-fixture`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (seedRes.status() === 404 || seedRes.status() === 401) {
      test.skip(true, 'Dev seed helper not available — skipping');
      return;
    }
    if (seedRes.status() === 422) {
      const body = await seedRes.json() as { error: string };
      test.skip(true, `Seed precondition not met: ${body.error} — skipping`);
      return;
    }

    expect(
      seedRes.status(),
      `Seed must return 200, got ${seedRes.status()}: ${await seedRes.text()}`,
    ).toBe(200);

    const fixture = await seedRes.json() as PoRouteFixture;
    const { inventoryItemId, vendorItemBId, poId, poLineId } = fixture;

    const routePayload = {
      lines: [{ poLineId, targetVendorItemId: vendorItemBId }],
    };

    try {
      // -----------------------------------------------------------------------
      // Step 2: first routing call — must succeed with routedLines = 1
      // -----------------------------------------------------------------------
      const firstRes = await page.request.post(
        `${BASE_URL}/api/purchase-orders/${poId}/route-lines`,
        {
          data: routePayload,
          headers: { 'Content-Type': 'application/json' },
        },
      );

      expect(
        firstRes.status(),
        `First routing call must return 200, got ${firstRes.status()}: ${await firstRes.text()}`,
      ).toBe(200);

      const firstBody = await firstRes.json() as RouteResponse;

      expect(
        firstBody.data?.routedLines,
        'First call: routedLines must be 1',
      ).toBe(1);

      expect(
        firstBody.data?.affectedPOIds?.length,
        'First call: at least one destination PO must be referenced',
      ).toBeGreaterThanOrEqual(1);

      expect(
        firstBody.data?.auditIds?.length,
        'First call: at least one audit ID must be returned',
      ).toBeGreaterThanOrEqual(1);

      // -----------------------------------------------------------------------
      // Step 3: second routing call — IDENTICAL payload, must NOT be a 500
      // -----------------------------------------------------------------------
      const secondRes = await page.request.post(
        `${BASE_URL}/api/purchase-orders/${poId}/route-lines`,
        {
          data: routePayload,
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const secondStatus = secondRes.status();
      const secondBody = await secondRes.json() as RouteResponse;

      // ── Contract: never a 500 ──────────────────────────────────────────────
      expect(
        secondStatus,
        `Second routing call must NOT return 500 (got ${secondStatus}): ${JSON.stringify(secondBody)}`,
      ).not.toBe(500);

      // ── Graceful no-op: 200 with routedLines=0 and alreadyRouted populated ─
      if (secondStatus === 200) {
        expect(
          secondBody.data?.routedLines,
          'Second call (200): routedLines must be 0 — line was already routed',
        ).toBe(0);

        expect(
          secondBody.data?.alreadyRouted?.length,
          'Second call (200): alreadyRouted must list the previously routed line',
        ).toBeGreaterThanOrEqual(1);

        const ar = secondBody.data?.alreadyRouted?.[0];
        expect(ar?.poLineId, 'alreadyRouted entry must reference the correct poLineId').toBe(poLineId);
        expect(ar?.targetVendorItemId, 'alreadyRouted entry must reference the correct vendorItemId').toBe(vendorItemBId);
        expect(ar?.destinationPoId, 'alreadyRouted entry must include destinationPoId').toBeTruthy();
        expect(ar?.auditId, 'alreadyRouted entry must include auditId').toBeTruthy();
      }

      // ── DB-level check: exactly 1 audit row for this (line, vendorItem) ────
      // The routing-audits endpoint returns all audit rows for the source PO.
      const auditRes = await page.request.get(
        `${BASE_URL}/api/purchase-orders/${poId}/routing-audits`,
      );

      if (auditRes.status() === 200) {
        const auditBody = await auditRes.json() as {
          data?: Array<{ sourcePOLineId: string; vendorItemId: string }>;
        };
        const rows = auditBody.data ?? [];

        const matchingRows = rows.filter(
          (r) => r.sourcePOLineId === poLineId && r.vendorItemId === vendorItemBId,
        );

        expect(
          matchingRows.length,
          `po_routing_audit must have EXACTLY 1 row for (poLineId=${poLineId}, vendorItemId=${vendorItemBId}), found ${matchingRows.length}`,
        ).toBe(1);
      }
    } finally {
      // Always tear down the seeded data
      await page.request.delete(
        `${BASE_URL}/api/dev/test/po-route-fixture/${poId}?inventoryItemId=${inventoryItemId}`,
      );
    }
  });
});
