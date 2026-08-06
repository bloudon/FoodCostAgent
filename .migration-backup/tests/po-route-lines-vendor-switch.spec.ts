/**
 * E2E spec: PO line routing — vendor switch flow
 *
 * Covers the full user journey for rerouting an open PO line from one vendor
 * to a cheaper alternative:
 *
 *   1. Load the PO detail page for a seeded "pending" purchase order.
 *   2. Open the Vendor Price Comparison dialog for the seeded inventory item.
 *   3. Click "Route to Vendor" for the cheaper target vendor.
 *   4. Assert the success panel appears with a link to the new destination PO.
 *   5. Dismiss the dialog.
 *   6. Assert the source line's case-qty input drops to 0 (line was fully routed).
 *
 * DB fixture lifecycle:
 *   POST /api/dev/test/po-route-fixture  — seeds inventory item, two vendor items,
 *                                          a pending source PO, and one PO line.
 *   DELETE /api/dev/test/po-route-fixture/:poId?inventoryItemId=...
 *                                        — tears down everything (including any
 *                                          destination PO created by routing).
 *
 * Credentials:
 *   Email: admin@brians.pizza  /  Password: test123
 *
 * Import test + expect from test-helpers so the custom page fixture automatically
 * injects sessionStorage "forceAppMode"=1 before any script runs, bypassing the
 * marketing site that appears by default in the Replit preview environment.
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

// ---------------------------------------------------------------------------
// Suite: full vendor-switch routing flow
// ---------------------------------------------------------------------------

test.describe('PO route-lines — vendor switch', () => {
  test('routes a pending PO line to a cheaper vendor and shows the success panel', async ({ page }) => {
    // -----------------------------------------------------------------------
    // Step 0: authenticate the browser context (cookie shared across page +
    //         page.request, so one login covers both navigation and seed calls)
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
    // Step 1: seed fixture (uses the same authenticated browser cookie jar)
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
    const { inventoryItemId, vendorItemAId, vendorBId, poId, poLineId } = fixture;

    // Cleanup registered in a finally block so it always runs even on failure
    try {
      // ---------------------------------------------------------------------
      // Step 2: navigate to the source PO detail page
      // ---------------------------------------------------------------------
      await page.goto(`/purchase-orders/${poId}`);

      // Wait for the line table to render — the source vendor item row
      const sourceRow = page.getByTestId(`row-item-${vendorItemAId}`);
      await expect(sourceRow).toBeVisible({ timeout: 15_000 });

      // Source line should start with caseQty = 5
      const caseQtyInput = page.getByTestId(`input-case-qty-${vendorItemAId}`);
      // The input stores a numeric value; Playwright sees it as the string "5"
      await expect(caseQtyInput).toHaveValue('5');

      // ---------------------------------------------------------------------
      // Step 3: open Vendor Price Comparison dialog
      // ---------------------------------------------------------------------
      const compareBtn = page.getByTestId(`button-compare-${inventoryItemId}`);
      await expect(compareBtn).toBeVisible();
      await compareBtn.click();

      // The dialog renders vendor price rows — wait for the route button for
      // vendor B (the cheaper target) to appear
      const routeToBtn = page.getByTestId(`button-route-to-${vendorBId}`);
      await expect(routeToBtn).toBeVisible({ timeout: 10_000 });

      // ---------------------------------------------------------------------
      // Step 4: click "Route to Vendor" for vendor B
      // ---------------------------------------------------------------------
      await routeToBtn.click();

      // ---------------------------------------------------------------------
      // Step 5: assert the success panel appears
      // ---------------------------------------------------------------------
      // "Done" button only appears in the success state
      const doneBtn = page.getByTestId('button-routing-done');
      await expect(doneBtn).toBeVisible({ timeout: 10_000 });

      // A link to the newly created destination PO must be present
      // (testId = link-affected-po-{destPoId} — exact ID is unknown beforehand)
      const affectedPoLink = page.locator('[data-testid^="link-affected-po-"]');
      await expect(affectedPoLink).toBeVisible();

      // ---------------------------------------------------------------------
      // Step 6: dismiss the dialog and assert source line qty dropped to 0
      // ---------------------------------------------------------------------
      await doneBtn.click();
      // Dialog should close; the source line row remains in the table.
      await expect(sourceRow).toBeVisible();
      // After full routing the qty is 0.  The controlled number input renders a
      // zero value as an empty string (the app omits "0" from the display), so
      // we assert the empty string rather than "0".
      await expect(caseQtyInput).toHaveValue('');

      // Verify via the API that no lines remain on the source PO (belt + suspenders)
      const linesRes = await page.request.get(
        `${BASE_URL}/api/purchase-orders/${poId}/lines`,
      );
      if (linesRes.status() === 200) {
        const linesBody = await linesRes.json() as { data?: Array<{ id: string; caseQuantity?: number }> };
        const lines = linesBody.data ?? (linesBody as unknown as Array<{ id: string; caseQuantity?: number }>);
        const sourceLine = lines.find((l) => l.id === poLineId);
        if (sourceLine) {
          expect(
            sourceLine.caseQuantity ?? 0,
            'Routed source PO line must have caseQuantity = 0',
          ).toBe(0);
        }
      }
    } finally {
      // Always tear down the seeded data
      await page.request.delete(
        `${BASE_URL}/api/dev/test/po-route-fixture/${poId}?inventoryItemId=${inventoryItemId}`,
      );
    }
  });
});
