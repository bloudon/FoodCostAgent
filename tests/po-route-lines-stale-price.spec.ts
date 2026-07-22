/**
 * Integration spec: POST /api/purchase-orders/:id/route-lines — stale target price guard
 *
 * Verifies that the server re-checks pricedAt at submission time (not at dialog-open
 * time) and rejects routing when the target vendor item's price is older than 14 days.
 *
 * Scenario:
 *   - Seed a fixture where vendorItemB has pricedAt = 15 days ago (stale)
 *   - Attempt to route a source PO line to vendorItemB
 *   - Expect 422 with an ineligibleLines entry whose reason mentions "stale"
 *
 * This test guards against a regression where the handler might use the dialog's
 * cached snapshot of pricedAt instead of re-fetching from the DB at request time.
 *
 * DB fixture lifecycle:
 *   POST   /api/dev/test/po-route-fixture  { staleDaysForTarget: 15 }
 *         → seeds source PO + fresh vendorItemA + stale vendorItemB (pricedAt = 15 days ago)
 *   DELETE /api/dev/test/po-route-fixture/:poId?inventoryItemId=...
 *         → full teardown
 *
 * Credentials:
 *   Email: admin@brians.pizza  /  Password: test123
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
  error?: string;
  ineligibleLines?: Array<{
    poLineId:            string;
    targetVendorItemId:  string;
    reason:              string;
  }>;
  data?: {
    routedLines:   number;
    affectedPOIds: string[];
    auditIds:      string[];
  };
}

test.describe('PO route-lines — stale target price rejected at submission time', () => {
  test(
    'returns 422 with a stale-price reason when target vendor item pricedAt is 15 days old',
    async ({ page }) => {
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
      // Step 1: seed fixture with a stale target vendor item (15 days old)
      // -----------------------------------------------------------------------
      const seedRes = await page.request.post(`${BASE_URL}/api/dev/test/po-route-fixture`, {
        data: { staleDaysForTarget: 15 },
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

      try {
        // -----------------------------------------------------------------------
        // Step 2: attempt to route the source line to the stale target vendor item
        // -----------------------------------------------------------------------
        const routeRes = await page.request.post(
          `${BASE_URL}/api/purchase-orders/${poId}/route-lines`,
          {
            data: {
              lines: [{ poLineId, targetVendorItemId: vendorItemBId }],
            },
            headers: { 'Content-Type': 'application/json' },
          },
        );

        // -----------------------------------------------------------------------
        // Step 3: assert the endpoint rejects with 422 (ineligible lines)
        // -----------------------------------------------------------------------
        expect(
          routeRes.status(),
          `route-lines must return 422 for a stale target price, got ${routeRes.status()}: ${await routeRes.text()}`,
        ).toBe(422);

        const routeBody = await routeRes.json() as RouteResponse;

        // Structured ineligibleLines array must be present
        expect(
          Array.isArray(routeBody.ineligibleLines),
          'Response must include an ineligibleLines array',
        ).toBe(true);

        expect(
          (routeBody.ineligibleLines ?? []).length,
          'ineligibleLines must have exactly one entry',
        ).toBe(1);

        const ineligEntry = routeBody.ineligibleLines![0];

        expect(
          ineligEntry.poLineId,
          'ineligibleLines[0].poLineId must match the requested line',
        ).toBe(poLineId);

        expect(
          ineligEntry.targetVendorItemId,
          'ineligibleLines[0].targetVendorItemId must match vendorItemB',
        ).toBe(vendorItemBId);

        expect(
          ineligEntry.reason.toLowerCase(),
          'rejection reason must mention "stale"',
        ).toMatch(/stale/);

        // Routing must NOT have been executed — no data payload
        expect(
          routeBody.data,
          'No routing data must be present on a 422 rejection',
        ).toBeUndefined();

      } finally {
        // -----------------------------------------------------------------------
        // Cleanup: tear down all seeded rows
        // -----------------------------------------------------------------------
        await page.request.delete(
          `${BASE_URL}/api/dev/test/po-route-fixture/${poId}?inventoryItemId=${inventoryItemId}`,
        );
      }
    },
  );
});
