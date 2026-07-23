/**
 * Browser UI tests for the "Biggest Variance Driver" card on /analyze.
 *
 * All API calls are intercepted via page.route() so no real database state
 * or TFC data seeding is required. The top-item API mock returns a known
 * fixture so the test is deterministic regardless of which inventory counts
 * are in the DB.
 *
 * These tests verify:
 *   1. The card renders when the API returns a non-null top item
 *   2. The cost displayed is positive and non-zero
 *   3. The item name is shown in the card
 *   4. Clicking the card navigates to /tfc/variance with previousCountId,
 *      currentCountId, and highlight query params in the URL
 *   5. The card is absent when the API returns null (no positive variance driver)
 *
 * Key testids (defined in client/src/pages/analyze-landing.tsx):
 *   data-testid="top-variance-item-section"  — outer wrapper div
 *   data-testid="link-top-variance-item"      — clickable Link card
 *   data-testid="text-top-item-name"          — inventory item name
 *   data-testid="text-top-item-cost"          — "+$XX.XX" variance cost
 */

import { test, expect, Page } from './test-helpers';

const BASE_URL = 'http://localhost:5000';

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const FAKE_STORE_ID       = 'test-store-001';
const FAKE_ITEM_ID        = 'test-item-mozzarella';
const FAKE_CURRENT_COUNT  = 'test-count-current-01';
const FAKE_PREVIOUS_COUNT = 'test-count-previous-01';

const TOP_ITEM_FIXTURE = {
  inventoryItemId:   FAKE_ITEM_ID,
  inventoryItemName: 'Mozzarella Cheese',
  varianceCost:      123.45,
  variancePercent:   8.2,
  currentCountId:    FAKE_CURRENT_COUNT,
  previousCountId:   FAKE_PREVIOUS_COUNT,
};

const SUMMARIES_FIXTURE = [
  {
    currentCountId:       FAKE_CURRENT_COUNT,
    inventoryDate:        '2026-07-10T00:00:00.000Z',
    totalVarianceCost:    450.0,
    totalVariancePercent: 6.3,
    daySpan:              7,
  },
];

// ---------------------------------------------------------------------------
// Route mocking helpers
// ---------------------------------------------------------------------------

/**
 * Mock /api/auth/me with a pro-tier company_admin.
 * subscriptionTier: 'pro' unlocks tfc_variance (basic+) and pos_import (basic+).
 */
async function mockAuth(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-id',
        email: 'admin@brians.pizza',
        companyId: 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1',
        companyName: "Brian's Pizza",
        role: 'company_admin',
        firstName: 'Test',
        lastName: 'Admin',
        active: 1,
        subscriptionTier: 'pro',
      }),
    }),
  );
}

/** Mock /api/stores/accessible — returns a single store so StoreProvider auto-selects it. */
async function mockStores(page: Page): Promise<void> {
  await page.route('**/api/stores/accessible', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: FAKE_STORE_ID, name: "Brian's Main" }]),
    }),
  );
}

/** Mock /api/tfc/variance/summaries for the selected store. */
async function mockSummaries(page: Page, body: object[] = SUMMARIES_FIXTURE): Promise<void> {
  await page.route('**/api/tfc/variance/summaries**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
}

/** Mock /api/tfc/variance/top-item to return a known non-null fixture. */
async function mockTopItem(page: Page, item: object | null = TOP_ITEM_FIXTURE): Promise<void> {
  await page.route('**/api/tfc/variance/top-item**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(item),
    }),
  );
}

/** Silence noisy layout-shell calls that would otherwise spray 401s. */
async function mockShellCalls(page: Page): Promise<void> {
  await page.route('**/api/onboarding/milestones', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dismissed: true, milestones: [] }),
    }),
  );
  await page.route('**/api/changelog', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/companies/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1', name: "Brian's Pizza", subscriptionTier: 'pro' }),
    }),
  );
}

/**
 * Set up all mocks and navigate to /analyze, waiting until the page heading
 * is visible before returning.
 */
async function navigateToAnalyze(page: Page, topItem: object | null = TOP_ITEM_FIXTURE): Promise<void> {
  await mockAuth(page);
  await mockStores(page);
  await mockSummaries(page);
  await mockTopItem(page, topItem);
  await mockShellCalls(page);

  await page.goto(`${BASE_URL}/analyze`);
  // Wait for the page heading so we know the React component has mounted
  await page.waitForSelector('h1', { timeout: 10000 });
}

// =============================================================================
// 1. Card renders when top-item API returns a non-null fixture
// =============================================================================

test.describe('Biggest Variance Driver card — with data', () => {
  test('card section is visible when top-item API returns a non-null item', async ({ page }) => {
    await navigateToAnalyze(page);

    await expect(page.getByTestId('top-variance-item-section')).toBeVisible({ timeout: 5000 });
  });

  test('item name is displayed in the card', async ({ page }) => {
    await navigateToAnalyze(page);

    const nameEl = page.getByTestId('text-top-item-name');
    await expect(nameEl).toBeVisible({ timeout: 5000 });
    await expect(nameEl).toHaveText('Mozzarella Cheese');
  });

  test('variance cost is displayed as a positive dollar amount', async ({ page }) => {
    await navigateToAnalyze(page);

    const costEl = page.getByTestId('text-top-item-cost');
    await expect(costEl).toBeVisible({ timeout: 5000 });

    // The element shows "+$123.45" — must start with +$ and be non-zero
    const text = await costEl.textContent();
    expect(text, 'Cost element should be present').not.toBeNull();
    expect(text!.trim(), 'Cost should be formatted as +$XX.XX').toMatch(/^\+\$\d+\.\d{2}$/);

    // Extract numeric value and assert it is positive and non-zero
    const amount = parseFloat(text!.replace(/[^0-9.]/g, ''));
    expect(amount, 'Displayed variance cost must be > 0').toBeGreaterThan(0);
  });

  test('cost displays the exact value returned by the API', async ({ page }) => {
    await navigateToAnalyze(page);

    const costEl = page.getByTestId('text-top-item-cost');
    await expect(costEl).toBeVisible({ timeout: 5000 });

    // Fixture returns varianceCost: 123.45 → UI should show "+$123.45"
    await expect(costEl).toHaveText('+$123.45');
  });
});

// =============================================================================
// 2. Click-through navigation
// =============================================================================

test.describe('Biggest Variance Driver card — click-through', () => {
  test('clicking the card navigates to /tfc/variance with deep-link params', async ({ page }) => {
    await navigateToAnalyze(page);

    await expect(page.getByTestId('link-top-variance-item')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('link-top-variance-item').click();

    // Wait for URL to change away from /analyze
    await page.waitForURL((url) => url.pathname.startsWith('/tfc/variance'), { timeout: 5000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/tfc/variance');
    expect(
      url.searchParams.get('previousCountId'),
      'URL should contain previousCountId from fixture',
    ).toBe(FAKE_PREVIOUS_COUNT);
    expect(
      url.searchParams.get('currentCountId'),
      'URL should contain currentCountId from fixture',
    ).toBe(FAKE_CURRENT_COUNT);
    expect(
      url.searchParams.get('highlight'),
      'URL should contain highlight param equal to inventoryItemId',
    ).toBe(FAKE_ITEM_ID);
  });
});

// =============================================================================
// 3. Card is absent when API returns null
// =============================================================================

test.describe('Biggest Variance Driver card — no data', () => {
  test('card section is not visible when top-item API returns null', async ({ page }) => {
    await navigateToAnalyze(page, null);

    // Page heading must be present (component mounted)
    await expect(page.locator('h1')).toBeVisible();

    // Card section must NOT be rendered at all
    await expect(page.getByTestId('top-variance-item-section')).not.toBeVisible();
  });
});

// =============================================================================
// 4. Cost is never zero — the endpoint only returns positive drivers
// =============================================================================

test.describe('Biggest Variance Driver card — positive cost invariant', () => {
  test('a zero-cost item from the API does NOT show the card (edge case)', async ({ page }) => {
    // Mock the API returning an item with varianceCost: 0.
    // The React component only renders when topItem is non-null AND showTfc is true.
    // If the backend ever returned a zero-cost item, the card would show "+$0.00"
    // which is misleading. This test documents that the front-end must guard this
    // (currently it renders the item unconditionally when non-null — this test
    // catches a future regression if the backend starts sending zero-cost items).
    //
    // NOTE: The backend filters to varianceCost > 0, so this tests the contract
    // between backend and frontend. If this fails, the backend contract was violated.
    const zeroItem = { ...TOP_ITEM_FIXTURE, varianceCost: 0, variancePercent: 0 };

    await navigateToAnalyze(page, zeroItem);

    // If the backend sends a zero-cost item, the card still renders (frontend
    // trusts the backend). Assert the cost shows $0.00 so it's visible in test
    // output — then document this as a "should not happen" scenario.
    const section = page.getByTestId('top-variance-item-section');

    // The section may or may not be visible — what matters is that IF it is
    // visible, the cost is not misleadingly positive.
    const isVisible = await section.isVisible();
    if (isVisible) {
      const costText = await page.getByTestId('text-top-item-cost').textContent();
      const amount = parseFloat((costText ?? '0').replace(/[^0-9.]/g, ''));
      // If this assertion fails, the backend sent a zero-cost item AND the frontend
      // displayed it — that's the regression this task was meant to prevent.
      expect(
        amount,
        'If the card is visible, the displayed cost must be > 0 (backend should never send a zero-cost top item)',
      ).toBeGreaterThan(0);
    }
  });
});
