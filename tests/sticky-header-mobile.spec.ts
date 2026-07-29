/**
 * Mobile viewport sticky-header smoke tests (375 × 812 – iPhone SE / 14).
 *
 * Covered routes (at 375 × 812 viewport):
 *   /inventory-items   – sticky thead + pagination controls below table
 *   /orders            – sticky thead  (/purchase-orders redirects here)
 *   /transfer-orders   – sticky thead
 *
 * NOTE: /purchase-orders redirects to /orders (see App.tsx).
 *       /receiving has no standalone list page (only /receiving/:poId detail).
 *       Both are covered by the /orders and /inventory-items tests respectively.
 *
 * Strategy
 * ─────────
 * 1. Mock all API routes so no live database is required.
 * 2. Inject 25 data rows so the inner table scroll-container overflows on mobile.
 * 3. Programmatically scroll the table's overflow-auto wrapper to its bottom.
 * 4. Measure the distance between the <thead> top and the wrapper top; a sticky
 *    header pins that distance to ≈ 0 regardless of scroll position.
 *
 * Prerequisites: the app must be running at http://localhost:5000 (npm run dev).
 */

import { test, expect, Page } from './test-helpers';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL   = 'http://localhost:5000';
const COMPANY_ID = 'test-company-id-673';
const STORE_ID   = 'store-673';

/** iPhone SE-ish: narrow enough to wrap the filter-bar onto two rows. */
const MOBILE_VIEWPORT = { width: 375, height: 812 };

/** 30 rows ensures the table's calc(100vh-Xpx) max-h overflows at 375×812
 *  and that selecting 25-per-page yields 2 pages (activating prev/next). */
const ROW_COUNT = 30;

// ─── Common mock helpers ──────────────────────────────────────────────────────

async function mockAuth(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-673',
        email: 'admin@test673.test',
        companyId: COMPANY_ID,
        companyName: 'Test Co 673',
        role: 'company_admin',
        firstName: 'Test',
        lastName: 'Admin',
        active: 1,
        subscriptionTier: 'pro',
      }),
    }),
  );
}

async function mockStores(page: Page) {
  const stores = [
    { id: STORE_ID, name: 'Main Store', companyId: COMPANY_ID, status: 'active', code: 'MS' },
  ];
  await page.route('**/api/stores/accessible', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stores) }),
  );
  await page.route('**/api/stores', (route) => {
    // Don't intercept /api/stores/:id sub-routes
    if (route.request().url().match(/\/api\/stores\/[^/]/)) return route.continue();
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stores) });
  });
}

async function mockCompany(page: Page) {
  await page.route(`**/api/companies/${COMPANY_ID}`, (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: COMPANY_ID,
        name: 'Test Co 673',
        posProvider: 'none',
        costingMethod: 'last_cost',
        subscriptionTier: 'pro',
      }),
    });
  });
}

async function mockVendors(page: Page) {
  await page.route('**/api/vendors**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'vendor-673', name: 'Test Vendor', accountNumber: null }]),
    }),
  );
}

// ─── Data factories ───────────────────────────────────────────────────────────

function makeInventoryItems() {
  return Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: `inv-673-${i}`,
    name: `Test Item ${String(i + 1).padStart(2, '0')}`,
    manufacturer: null,
    categoryId: null,
    category: null,
    pluSku: `SKU-${i + 1}`,
    pricePerUnit: 5.0,
    avgCostPerUnit: 4.5,
    effectiveUnitCost: 5.0,
    unitId: 'unit-1',
    caseSize: 12,
    imageUrl: null,
    parLevel: 10,
    reorderLevel: 5,
    storageLocationId: 'loc-1',
    onHandQty: 8,
    active: 1,
    isPowerItem: 0,
    vendorSkus: [],
    latestCasePrice: null,
    latestCasePriceVendor: null,
    locations: [],
    unit: { id: 'unit-1', name: 'Each', abbreviation: 'ea' },
  }));
}

function makeUnifiedOrders() {
  return Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: `uo-673-${String(i).padStart(8, '0')}`,
    type: 'purchase' as const,
    status: 'pending',
    createdAt: new Date(2026, 0, i + 1).toISOString(),
    completedAt: null,
    vendorName: 'Test Vendor',
    storeId: STORE_ID,
    storeName: 'Main Store',
    lineCount: 2,
    totalAmount: 75.0,
  }));
}

function makeTransferOrders() {
  return Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: `to-673-${String(i).padStart(8, '0')}`,
    fromStoreId: STORE_ID,
    fromStoreName: 'Main Store',
    toStoreId: 'store-674',
    toStoreName: 'Branch Store',
    status: 'pending',
    createdAt: new Date(2026, 0, i + 1).toISOString(),
    completedAt: null,
    lineCount: 4,
    totalAmount: 200.0,
  }));
}

// ─── Core scroll + sticky measurement ────────────────────────────────────────

/**
 * Scrolls the first `div.overflow-auto` wrapping a `<table>` to its bottom,
 * then measures the gap between the `<thead>` top and the wrapper top.
 *
 * Returns null when no scrollable table wrapper can be found.
 *
 * A sticky header pins the gap to ≈ 0 px regardless of scroll position;
 * a non-sticky one would drift downward with the tbody.
 */
async function scrollTableAndMeasureStickyOffset(page: Page): Promise<{
  stickyOffset: number;
  scrolled: number;
  scrollHeight: number;
} | null> {
  return page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return null;

    // Walk up the DOM to the overflow-auto div the Table component renders.
    let wrapper: Element | null = table.parentElement;
    while (wrapper && !wrapper.classList.contains('overflow-auto')) {
      wrapper = wrapper.parentElement;
    }
    if (!(wrapper instanceof HTMLElement)) return null;

    const thead = table.querySelector('thead');
    if (!thead) return null;

    // Scroll the internal table container all the way down.
    wrapper.scrollTop = wrapper.scrollHeight;

    const theadRect   = thead.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();

    return {
      // 0 px = perfectly pinned. Grows if the header scrolls away.
      stickyOffset: Math.abs(theadRect.top - wrapperRect.top),
      scrolled:     wrapper.scrollTop,
      scrollHeight: wrapper.scrollHeight,
    };
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// /inventory-items
// ---------------------------------------------------------------------------
test('inventory-items: thead stays pinned at 375px and pagination controls are reachable', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);

  await mockAuth(page);
  await mockStores(page);
  await mockCompany(page);

  await page.route('**/api/onboarding/milestones', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ milestones: [], completedCount: 0, totalCount: 0, dismissed: true }),
    }),
  );

  await page.route('**/api/inventory-items/estimated-on-hand**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  await page.route('**/api/inventory-items**', (route) => {
    if (route.request().url().match(/\/api\/inventory-items\/[^/]/)) return route.continue();
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeInventoryItems()),
    });
  });

  await page.route('**/api/storage-locations**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  await page.route('**/api/categories**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // Navigate and wait for data rows.
  await page.goto(`${BASE_URL}/inventory-items`);
  await expect(page.locator('[data-testid^="row-inventory-"]').first()).toBeVisible({ timeout: 10_000 });

  // ── 1. Sticky thead assertion ────────────────────────────────────────────
  const result = await scrollTableAndMeasureStickyOffset(page);
  expect(result, 'No scrollable table wrapper found on /inventory-items').not.toBeNull();
  // The 25-row list must overflow the calc(100vh-320px) container at 375×812.
  expect(
    result!.scrolled,
    'Table container did not scroll – rows may not exceed max-h at this viewport',
  ).toBeGreaterThan(0);
  // Sticky header stays within 2 px of the wrapper top after scrolling.
  expect(result!.stickyOffset).toBeLessThan(2);

  // ── 2. Pagination controls are reachable below the table ─────────────────
  // Switch to 25 per page so prev / next controls activate.
  const perPageSelect = page.locator('[data-testid="select-items-per-page"]');
  await perPageSelect.scrollIntoViewIfNeeded();
  await expect(perPageSelect).toBeVisible();

  await perPageSelect.click();
  // The Radix SelectItem renders as role="option" inside a listbox.
  await page.getByRole('option', { name: '25 per page' }).click();

  const nextBtn = page.locator('[data-testid="button-next-page"]');
  await nextBtn.scrollIntoViewIfNeeded();
  await expect(nextBtn).toBeVisible();
  // 25 items × 25 per page = exactly 1 page, so next should be disabled.
  // The important assertion is that the button is visible (not clipped off-screen).
  await expect(page.locator('[data-testid="button-prev-page"]')).toBeVisible();
});

// ---------------------------------------------------------------------------
// /orders  (note: /purchase-orders is a redirect alias for this page)
// ---------------------------------------------------------------------------
test('orders: thead stays pinned at 375px', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);

  await mockAuth(page);
  await mockStores(page);
  await mockCompany(page);
  await mockVendors(page);

  await page.route('**/api/orders/unified**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeUnifiedOrders()),
    }),
  );

  await page.route('**/api/quickbooks/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  await page.goto(`${BASE_URL}/orders`);
  // Wait for at least one status badge.
  await expect(page.locator('[data-testid^="badge-status-"]').first()).toBeVisible({ timeout: 10_000 });

  const result = await scrollTableAndMeasureStickyOffset(page);
  expect(result, 'No scrollable table wrapper found on /orders').not.toBeNull();
  expect(result!.scrolled).toBeGreaterThan(0);
  expect(result!.stickyOffset).toBeLessThan(2);
});

// ---------------------------------------------------------------------------
// /purchase-orders  – redirects to /orders; verify redirect + sticky still works
// ---------------------------------------------------------------------------
test('purchase-orders: redirect to /orders and thead stays pinned at 375px', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);

  await mockAuth(page);
  await mockStores(page);
  await mockCompany(page);
  await mockVendors(page);

  await page.route('**/api/orders/unified**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeUnifiedOrders()),
    }),
  );

  await page.route('**/api/quickbooks/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  // Navigate to /purchase-orders – it should redirect to /orders.
  await page.goto(`${BASE_URL}/purchase-orders`);
  await expect(page).toHaveURL(/\/orders/, { timeout: 5_000 });

  await expect(page.locator('[data-testid^="badge-status-"]').first()).toBeVisible({ timeout: 10_000 });

  const result = await scrollTableAndMeasureStickyOffset(page);
  expect(result, 'No scrollable table wrapper found after /purchase-orders redirect').not.toBeNull();
  expect(result!.scrolled).toBeGreaterThan(0);
  expect(result!.stickyOffset).toBeLessThan(2);
});

// ---------------------------------------------------------------------------
// /transfer-orders
// ---------------------------------------------------------------------------
test('transfer-orders: thead stays pinned at 375px', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);

  await mockAuth(page);
  await mockStores(page);
  await mockCompany(page);

  await page.route('**/api/transfer-orders**', (route) => {
    if (route.request().url().match(/\/api\/transfer-orders\/[^/]/)) return route.continue();
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeTransferOrders()),
    });
  });

  await page.goto(`${BASE_URL}/transfer-orders`);
  await expect(page.locator('table')).toBeVisible({ timeout: 10_000 });

  const result = await scrollTableAndMeasureStickyOffset(page);
  expect(result, 'No scrollable table wrapper found on /transfer-orders').not.toBeNull();
  expect(result!.scrolled).toBeGreaterThan(0);
  expect(result!.stickyOffset).toBeLessThan(2);
});
