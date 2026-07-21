/**
 * Automated tests for priceSource label rendering in the inventory item detail page.
 *
 * Guards against:
 *  - The real invoice-scan apply flow failing to write priceSource = 'invoice_scan'
 *  - The real receipt complete flow failing to write priceSource = 'receipt'
 *  - The UI showing "-" or "Unknown" instead of the correct label
 *
 * Three test scenarios:
 *  1. FLOW: invoke the real POST /api/onboarding/invoice-scan/apply endpoint with
 *     action="update" → vendor row shows "Invoice Scan" label + Confirmed badge.
 *  2. FLOW: seed a draft receipt chain, then invoke the real PATCH /api/receipts/:id/complete
 *     → vendor row shows "Receipt" label + Confirmed badge.
 *  3. DISPLAY: seed a vendor_item with priceSource='legacy_unknown' directly
 *     → label cell shows amber warning icon (no Confirmed badge).
 *
 * Dev helpers used (dev-only, requireAuth):
 *   GET  /api/dev/test/vendor-price-anchors           — FK anchors for the test company
 *   POST /api/dev/test/vendor-price-state             — seed a vendor_items row (accepts priceSource)
 *   DEL  /api/dev/test/vendor-price-state/:id         — cleanup vendor_item only
 *   POST /api/dev/test/receipt-state                  — seed PO + receipt(draft) + vendor_item + line
 *   DEL  /api/dev/test/receipt-state/:id?vendorItemId&poId — cleanup receipt chain
 *
 * Prerequisites (dev database):
 *   Email: admin@brians.pizza  /  Password: test123
 */

import { test, expect } from 'playwright/test';
import type { APIRequestContext, Page } from 'playwright/test';

const BASE_URL      = 'http://localhost:5000';
const TEST_EMAIL    = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginViaApi(request: APIRequestContext): Promise<boolean> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  return res.status() === 200;
}

async function loginViaPage(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/?app`);
  await page.waitForTimeout(500);
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(TEST_EMAIL);
  await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log in")').first().click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 10000 });
}

interface Anchors {
  vendorId: string;
  purchaseUnitId: string;
  inventoryItemId: string;
}

async function getAnchors(request: APIRequestContext): Promise<Anchors | null> {
  const res = await request.get(`${BASE_URL}/api/dev/test/vendor-price-anchors`);
  if (res.status() !== 200) return null;
  return res.json() as Promise<Anchors>;
}

async function seedVendorItem(
  request: APIRequestContext,
  anchors: Anchors,
  priceSource: string | null,
  vendorSku: string,
): Promise<string | null> {
  const res = await request.post(`${BASE_URL}/api/dev/test/vendor-price-state`, {
    data: {
      vendorId: anchors.vendorId,
      purchaseUnitId: anchors.purchaseUnitId,
      inventoryItemId: anchors.inventoryItemId,
      vendorSku,
      caseSize: 6,
      lastPrice: 3.5,
      lastCasePrice: 21.0,
      priceSource,
    },
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status() !== 200) return null;
  const body = await res.json() as { vendorItemId: string };
  return body.vendorItemId;
}

async function cleanupVendorItem(request: APIRequestContext, vendorItemId: string): Promise<void> {
  await request.delete(`${BASE_URL}/api/dev/test/vendor-price-state/${vendorItemId}`);
}

// ---------------------------------------------------------------------------
// Suite: Auth contract (no DB required)
// ---------------------------------------------------------------------------

test.describe('price-source labels — auth contract', () => {
  test('GET /api/dev/test/vendor-price-anchors returns 401 without session', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/dev/test/vendor-price-anchors`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite: Flow — invoice_scan apply
// ---------------------------------------------------------------------------

test.describe('price-source labels — invoice scan apply flow', () => {
  /**
   * This test exercises the REAL POST /api/onboarding/invoice-scan/apply endpoint.
   * It seeds a fresh vendor_item for the inventory item, then calls apply with
   * action="update" and a casePrice. The endpoint's recordVendorPrice call is
   * what should write priceSource='invoice_scan' to the vendor_items row.
   * We then verify the UI shows "Invoice Scan" and the Confirmed badge.
   */
  test('apply flow writes invoice_scan priceSource and UI shows "Invoice Scan" label', async ({ page, request }) => {
    const loggedIn = await loginViaApi(request);
    if (!loggedIn) {
      test.skip(true, 'Could not log in via API — skipping integration test');
      return;
    }

    const anchors = await getAnchors(request);
    if (!anchors) {
      test.skip(true, 'Dev anchor helper not available or no data in dev DB — skipping');
      return;
    }

    // Seed a vendor item with no priceSource yet
    const sku = `ps-flow-invoice-${Date.now()}`;
    const vendorItemId = await seedVendorItem(request, anchors, null, sku);
    if (!vendorItemId) {
      test.skip(true, 'Seed helper failed — skipping');
      return;
    }

    try {
      // Call the REAL invoice-scan apply endpoint (authenticated via cookie from loginViaApi)
      // The endpoint looks up all vendor_items linked to inventoryItemId and calls
      // recordVendorPrice(source='invoice_scan') on each — including our seeded row.
      const applyRes = await request.post(`${BASE_URL}/api/onboarding/invoice-scan/apply`, {
        data: {
          items: [
            {
              name: 'Test Invoice Scan Item',
              action: 'update',
              inventoryItemId: anchors.inventoryItemId,
              casePrice: 21.0,
              unitPrice: 3.5,
              unit: 'lb',
            },
          ],
        },
        headers: { 'Content-Type': 'application/json' },
      });

      expect(
        applyRes.status(),
        `invoice-scan/apply must succeed; got ${applyRes.status()}: ${await applyRes.text()}`,
      ).toBe(200);

      // Navigate to the inventory item detail and check the label
      await loginViaPage(page);
      await page.goto(`${BASE_URL}/inventory-items/${anchors.inventoryItemId}`);
      await page.waitForTimeout(2500);

      const priceSourceCell = page.getByTestId(`text-price-source-${vendorItemId}`);
      await expect(priceSourceCell).toBeVisible({ timeout: 8000 });
      await expect(priceSourceCell).toContainText('Invoice Scan');

      const confirmedBadge = page.getByTestId(`badge-confirmed-${vendorItemId}`);
      await expect(confirmedBadge).toBeVisible();
    } finally {
      await cleanupVendorItem(request, vendorItemId);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: Flow — receipt complete
// ---------------------------------------------------------------------------

test.describe('price-source labels — receipt complete flow', () => {
  /**
   * This test exercises the REAL PATCH /api/receipts/:id/complete endpoint.
   * It seeds the full chain: vendor_item + PO + draft receipt + receipt_line.
   * Then it calls complete, which should call recordVendorPrice(source='receipt').
   * We then verify the UI shows "Receipt" and the Confirmed badge.
   */
  test('receipt complete flow writes receipt priceSource and UI shows "Receipt" label', async ({ page, request }) => {
    const loggedIn = await loginViaApi(request);
    if (!loggedIn) {
      test.skip(true, 'Could not log in via API — skipping integration test');
      return;
    }

    const anchors = await getAnchors(request);
    if (!anchors) {
      test.skip(true, 'Dev anchor helper not available or no data in dev DB — skipping');
      return;
    }

    // Seed the full receipt chain (vendor_item + PO + draft receipt + receipt_line)
    const seedRes = await request.post(`${BASE_URL}/api/dev/test/receipt-state`, {
      data: {
        inventoryItemId: anchors.inventoryItemId,
        vendorId: anchors.vendorId,
        purchaseUnitId: anchors.purchaseUnitId,
      },
      headers: { 'Content-Type': 'application/json' },
    });

    if (seedRes.status() === 404 || seedRes.status() === 401) {
      test.skip(true, 'Dev receipt-state helper not available — skipping');
      return;
    }

    expect(
      seedRes.status(),
      `receipt-state seed must succeed; got ${seedRes.status()}: ${await seedRes.text()}`,
    ).toBe(200);

    const { receiptId, vendorItemId, poId } = await seedRes.json() as {
      receiptId: string;
      vendorItemId: string;
      poId: string;
    };

    try {
      // Call the REAL receipt complete endpoint (no body required)
      const completeRes = await request.patch(`${BASE_URL}/api/receipts/${receiptId}/complete`, {
        headers: { 'Content-Type': 'application/json' },
      });

      expect(
        completeRes.status(),
        `receipts/:id/complete must succeed; got ${completeRes.status()}: ${await completeRes.text()}`,
      ).toBe(200);

      // Navigate to the inventory item detail and check the label
      await loginViaPage(page);
      await page.goto(`${BASE_URL}/inventory-items/${anchors.inventoryItemId}`);
      await page.waitForTimeout(2500);

      const priceSourceCell = page.getByTestId(`text-price-source-${vendorItemId}`);
      await expect(priceSourceCell).toBeVisible({ timeout: 8000 });
      await expect(priceSourceCell).toContainText('Receipt');

      const confirmedBadge = page.getByTestId(`badge-confirmed-${vendorItemId}`);
      await expect(confirmedBadge).toBeVisible();
    } finally {
      await request.delete(
        `${BASE_URL}/api/dev/test/receipt-state/${receiptId}?vendorItemId=${vendorItemId}&poId=${poId}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: Flow — receipt complete with multiple lines from different vendor items
// ---------------------------------------------------------------------------

test.describe('price-source labels — receipt complete multi-line flow', () => {
  /**
   * Guards against loop bugs in PATCH /api/receipts/:id/complete where only
   * the first receipt line is processed (early bail-out, wrong vendorItemId, etc.).
   *
   * Seeds a single PO + receipt with THREE receipt_lines, each linked to a
   * distinct vendor_item (same inventoryItemId, different SKUs). After calling
   * complete, every vendor_item row must have priceSource = 'receipt' and the
   * inventory item detail page must show "Receipt" + "Confirmed" for all three.
   */
  test('receipt complete updates priceSource for all lines, not just the first', async ({ page, request }) => {
    const loggedIn = await loginViaApi(request);
    if (!loggedIn) {
      test.skip(true, 'Could not log in via API — skipping integration test');
      return;
    }

    const anchors = await getAnchors(request);
    if (!anchors) {
      test.skip(true, 'Dev anchor helper not available or no data in dev DB — skipping');
      return;
    }

    // Seed one PO + draft receipt with 3 distinct vendor_items + receipt_lines
    const seedRes = await request.post(`${BASE_URL}/api/dev/test/receipt-state`, {
      data: {
        lines: [
          { inventoryItemId: anchors.inventoryItemId, vendorId: anchors.vendorId, purchaseUnitId: anchors.purchaseUnitId },
          { inventoryItemId: anchors.inventoryItemId, vendorId: anchors.vendorId, purchaseUnitId: anchors.purchaseUnitId },
          { inventoryItemId: anchors.inventoryItemId, vendorId: anchors.vendorId, purchaseUnitId: anchors.purchaseUnitId },
        ],
      },
      headers: { 'Content-Type': 'application/json' },
    });

    if (seedRes.status() === 404 || seedRes.status() === 401) {
      test.skip(true, 'Dev receipt-state helper not available — skipping');
      return;
    }

    expect(
      seedRes.status(),
      `receipt-state multi-line seed must succeed; got ${seedRes.status()}: ${await seedRes.text()}`,
    ).toBe(200);

    const { receiptId, poId, lines } = await seedRes.json() as {
      receiptId: string;
      poId: string;
      vendorItemId: string;
      lines: Array<{ vendorItemId: string; inventoryItemId: string }>;
    };

    const vendorItemIds = lines.map((l) => l.vendorItemId);

    try {
      // Complete the receipt — the loop must process all 3 lines
      const completeRes = await request.patch(`${BASE_URL}/api/receipts/${receiptId}/complete`, {
        headers: { 'Content-Type': 'application/json' },
      });

      expect(
        completeRes.status(),
        `receipts/:id/complete must succeed; got ${completeRes.status()}: ${await completeRes.text()}`,
      ).toBe(200);

      // Navigate to inventory item detail and verify all 3 vendor_item rows
      await loginViaPage(page);
      await page.goto(`${BASE_URL}/inventory-items/${anchors.inventoryItemId}`);
      await page.waitForTimeout(2500);

      for (const vendorItemId of vendorItemIds) {
        const priceSourceCell = page.getByTestId(`text-price-source-${vendorItemId}`);
        await expect(priceSourceCell, `vendor item ${vendorItemId} must be visible`).toBeVisible({ timeout: 8000 });
        await expect(priceSourceCell, `vendor item ${vendorItemId} must show "Receipt"`).toContainText('Receipt');

        const confirmedBadge = page.getByTestId(`badge-confirmed-${vendorItemId}`);
        await expect(confirmedBadge, `vendor item ${vendorItemId} must show Confirmed badge`).toBeVisible();
      }
    } finally {
      await request.delete(
        `${BASE_URL}/api/dev/test/receipt-state/${receiptId}?vendorItemIds=${vendorItemIds.join(',')}&poId=${poId}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: Flow — receipt complete via UI (manager approves in browser)
// ---------------------------------------------------------------------------

test.describe('price-source labels — receipt complete via UI approval', () => {
  /**
   * End-to-end UI path: seeds the full receipt chain, then has Playwright
   * navigate to the /receiving/:poId page and click "Complete Receiving" —
   * the same action a manager takes in the browser.
   *
   * Guards specifically against a regression where the PATCH
   * /api/receipts/:id/complete endpoint is wired incorrectly so that
   * priceSource is never written to vendor_items, causing the label to
   * stay "Unknown" after UI-driven approval.
   *
   * The seeded PO has no purchase_order_lines, so allLinesSaved is
   * immediately true (0 === 0) and the button is enabled as soon as the
   * draft receipt is resolved.
   */
  test('approving a receipt via the UI writes receipt priceSource and shows "Receipt" label', async ({ page, request }) => {
    const loggedIn = await loginViaApi(request);
    if (!loggedIn) {
      test.skip(true, 'Could not log in via API — skipping integration test');
      return;
    }

    const anchors = await getAnchors(request);
    if (!anchors) {
      test.skip(true, 'Dev anchor helper not available or no data in dev DB — skipping');
      return;
    }

    // Seed the full receipt chain (vendor_item + PO + draft receipt + receipt_line)
    const seedRes = await request.post(`${BASE_URL}/api/dev/test/receipt-state`, {
      data: {
        inventoryItemId: anchors.inventoryItemId,
        vendorId: anchors.vendorId,
        purchaseUnitId: anchors.purchaseUnitId,
      },
      headers: { 'Content-Type': 'application/json' },
    });

    if (seedRes.status() === 404 || seedRes.status() === 401) {
      test.skip(true, 'Dev receipt-state helper not available — skipping');
      return;
    }

    expect(
      seedRes.status(),
      `receipt-state seed must succeed; got ${seedRes.status()}: ${await seedRes.text()}`,
    ).toBe(200);

    const { receiptId, vendorItemId, poId } = await seedRes.json() as {
      receiptId: string;
      vendorItemId: string;
      poId: string;
    };

    try {
      // Step 1: Log in via the browser UI
      await loginViaPage(page);

      // Step 2: Navigate to the receiving detail page for this PO
      await page.goto(`${BASE_URL}/receiving/${poId}`);

      // Step 3: Wait for the "Complete Receiving" button to be visible and enabled.
      // The seeded PO has no purchase_order_lines so allLinesSaved is immediately
      // true; draftReceiptId is set once /api/receipts/draft/:poId resolves.
      const completeBtn = page.getByTestId('button-complete-receiving');
      await expect(completeBtn).toBeVisible({ timeout: 10000 });
      await expect(completeBtn).toBeEnabled({ timeout: 10000 });

      // Step 4: Click to approve — this calls PATCH /api/receipts/:id/complete
      // which must write priceSource = 'receipt' on the vendor_items row.
      await completeBtn.click();

      // Step 5: The mutation's onSuccess navigates to /orders — wait for it
      await page.waitForURL((url: URL) => url.pathname === '/orders', { timeout: 15000 });

      // Step 6: Navigate to the inventory item detail page
      await page.goto(`${BASE_URL}/inventory-items/${anchors.inventoryItemId}`);
      await page.waitForTimeout(2500);

      // Step 7: The vendor row for our seeded vendor_item must show "Receipt"
      // and a "Confirmed" badge — confirming priceSource was written correctly.
      const priceSourceCell = page.getByTestId(`text-price-source-${vendorItemId}`);
      await expect(priceSourceCell).toBeVisible({ timeout: 8000 });
      await expect(priceSourceCell).toContainText('Receipt');

      const confirmedBadge = page.getByTestId(`badge-confirmed-${vendorItemId}`);
      await expect(confirmedBadge).toBeVisible();
    } finally {
      // Clean up seeded rows regardless of test outcome
      await request.delete(
        `${BASE_URL}/api/dev/test/receipt-state/${receiptId}?vendorItemId=${vendorItemId}&poId=${poId}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: Display — legacy_unknown warning icon
// ---------------------------------------------------------------------------

test.describe('price-source labels — legacy_unknown display', () => {
  /**
   * Seeds a vendor_item with priceSource='legacy_unknown' directly (no natural flow
   * produces this in automated tests — it only exists for migrated legacy data).
   * Verifies the label cell renders the amber AlertTriangle warning icon.
   */
  test('legacy_unknown priceSource shows amber warning icon in the label cell', async ({ page, request }) => {
    const loggedIn = await loginViaApi(request);
    if (!loggedIn) {
      test.skip(true, 'Could not log in via API — skipping integration test');
      return;
    }

    const anchors = await getAnchors(request);
    if (!anchors) {
      test.skip(true, 'Dev anchor helper not available or no data in dev DB — skipping');
      return;
    }

    const sku = `ps-legacy-${Date.now()}`;
    const vendorItemId = await seedVendorItem(request, anchors, 'legacy_unknown', sku);
    if (!vendorItemId) {
      test.skip(true, 'Seed helper failed — skipping');
      return;
    }

    try {
      await loginViaPage(page);
      await page.goto(`${BASE_URL}/inventory-items/${anchors.inventoryItemId}`);
      await page.waitForTimeout(2500);

      const priceSourceCell = page.getByTestId(`text-price-source-${vendorItemId}`);
      await expect(priceSourceCell).toBeVisible({ timeout: 8000 });

      // The label cell should contain an amber-colored span with an SVG AlertTriangle icon
      const amberLabel = priceSourceCell.locator('span.text-amber-600, span.text-amber-400');
      await expect(amberLabel).toBeVisible();

      const warningIcon = priceSourceCell.locator('svg');
      await expect(warningIcon).toBeVisible();

      // "Confirmed" badge must NOT appear for legacy rows
      const confirmedBadge = page.getByTestId(`badge-confirmed-${vendorItemId}`);
      await expect(confirmedBadge).not.toBeVisible();
    } finally {
      await cleanupVendorItem(request, vendorItemId);
    }
  });
});
