/**
 * Playwright e2e test — Get Operational card stays hidden after page refresh
 *
 * Verifies that the GetOperationalCard does not reappear on the dashboard
 * after a hard reload when the milestones API signals all steps are complete
 * (dismissed: true).  This guards against a regression in frontend cache
 * hydration or React Query state that could re-show the card to users who
 * have already finished onboarding.
 *
 * WHY MOCK APPROACH:
 *   The card's visibility is entirely driven by /api/onboarding/milestones.
 *   Mocking that endpoint lets the test stay deterministic regardless of the
 *   dev-database state for the test user.
 */

import { test, expect } from './test-helpers';

const BASE_URL = 'http://localhost:5000';
const TEST_EMAIL = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';
const TEST_COMPANY_ID = 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

/**
 * Enables app mode on localhost (bypasses VITE_SHOW_WEBSITE=true) by
 * visiting /?app, which sets sessionStorage.forceAppMode = '1'.
 */
async function enableAppMode(page: import('playwright/test').Page): Promise<void> {
  await page.goto(`${BASE_URL}/?app`);
  await page.waitForTimeout(500);
}

/**
 * Logs in using the shared dev test account.
 */
async function login(page: import('playwright/test').Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page
    .locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]')
    .first()
    .fill(TEST_EMAIL);
  await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
  await page
    .locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log in"), button:has-text("Login")')
    .first()
    .click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), {
    timeout: 10_000,
  });
}

/**
 * Intercepts the milestones API and returns a "fully completed + dismissed"
 * payload — the state the server reaches after auto-dismiss once every step
 * is done.
 */
async function mockMilestonesCompleted(page: import('playwright/test').Page): Promise<void> {
  await page.route('**/api/onboarding/milestones', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dismissed: true,
        completedCount: 5,
        totalCount: 5,
        milestones: [
          { id: 'menu_scan', label: 'Scan your menu', completed: true, path: '/menu-scan' },
          { id: 'storage_locations', label: 'Set up store & storage areas', completed: true, path: '/onboarding' },
          { id: 'invoice_scan', label: 'Upload a vendor invoice', completed: true, path: '/onboarding' },
          { id: 'inventory_count', label: 'Run your first inventory count', completed: true, path: '/inventory-sessions' },
        ],
      }),
    }),
  );

  // Orderly batches — returning a non-empty list marks the orderly step done
  await page.route('**/api/inventory-import/orderly/batches', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'batch-1' }]),
    }),
  );
}

test.describe('Get Operational card — hidden after all steps completed', () => {
  test.beforeEach(async ({ page }) => {
    await enableAppMode(page);
    await login(page);
  });

  test('card is absent on initial dashboard load and stays absent after page reload', async ({ page }) => {
    // Intercept milestones BEFORE the dashboard fetch fires
    await mockMilestonesCompleted(page);

    // Navigate to the dashboard (app root)
    await page.goto(`${BASE_URL}/`);

    // Wait for the milestones query to settle — card should never appear
    await page.waitForTimeout(2000);

    await expect(
      page.getByTestId('get-operational-card'),
      'Get Operational card should not be visible for a completed user on first load',
    ).not.toBeVisible();

    // Hard reload — simulates a user refreshing the browser tab.
    // React Query's staleTime=0 + refetchOnMount="always" will re-fetch
    // the milestones endpoint; the card must still stay hidden.
    await page.reload();
    await page.waitForTimeout(2000);

    await expect(
      page.getByTestId('get-operational-card'),
      'Get Operational card should not reappear after page reload for a completed user',
    ).not.toBeVisible();
  });
});

/**
 * Mocks /api/stores/accessible with a single valid store so the dashboard
 * renders past the "No Accessible Stores" guard and mounts GetOperationalCard.
 * Must be called before page.goto() so the route intercept is active on first load.
 */
async function mockAccessibleStore(page: import('playwright/test').Page): Promise<void> {
  await page.route('**/api/stores/accessible', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'store-mock-001',
          companyId: TEST_COMPANY_ID,
          name: 'Test Store',
          address: null,
          city: null,
          state: null,
          zip: null,
          phone: null,
          tccLocationId: null,
          status: 'active',
        },
      ]),
    }),
  );
}

/**
 * Mocks the three endpoints that drive the 3-of-4-required-steps-done scenario:
 * milestones (menu + storage + invoice done, inventory_count NOT done) and the
 * orderly batches response (caller chooses empty vs non-empty).
 */
async function mockThreeRequiredStepsDone(
  page: import('playwright/test').Page,
  orderlyBatches: any[],
): Promise<void> {
  await page.route('**/api/onboarding/milestones', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dismissed: false,
        completedCount: 3,
        totalCount: 4,
        milestones: [
          { id: 'menu_scan', label: 'Scan your menu', completed: true, path: '/menu-scan' },
          { id: 'storage_locations', label: 'Set up store & storage areas', completed: true, path: '/onboarding' },
          { id: 'invoice_scan', label: 'Upload a vendor invoice', completed: true, path: '/onboarding' },
          { id: 'inventory_count', label: 'Run your first inventory count', completed: false, path: '/inventory-sessions' },
        ],
      }),
    }),
  );

  await page.route('**/api/inventory-import/orderly/batches', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(orderlyBatches),
    }),
  );
}

test.describe('Get Operational card — optional inventory count skipped', () => {
  test.beforeEach(async ({ page }) => {
    await enableAppMode(page);
    await login(page);
  });

  /**
   * The 4 required steps (menu_scan, storage_locations, invoice_scan, orderly)
   * are all done but inventory_count (optional) is NOT done.
   * The card should auto-hide because all REQUIRED steps are complete.
   */
  test('card hides when 4 required steps are done even if inventory count is skipped', async ({ page }) => {
    // Ensure dashboard renders past the "no stores" guard
    await mockAccessibleStore(page);
    // 3 milestone steps done + orderly done → all 4 required done, inventory_count skipped
    await mockThreeRequiredStepsDone(page, [{ id: 'batch-1' }]);

    await page.goto(`${BASE_URL}/`);
    await page.waitForTimeout(2000);

    await expect(
      page.getByTestId('get-operational-card'),
      'Card should be hidden when all 4 required steps are done even if inventory count is skipped',
    ).not.toBeVisible();
  });

  /**
   * Only 3 of 4 required steps are done (orderly import NOT done).
   * The card must still be visible because a required step is outstanding.
   */
  test('card remains visible when only 3 of 4 required steps are done (orderly missing)', async ({ page }) => {
    // Ensure dashboard renders past the "no stores" guard
    await mockAccessibleStore(page);
    // 3 milestone steps done + orderly NOT done → only 3 of 4 required done
    await mockThreeRequiredStepsDone(page, []);

    await page.goto(`${BASE_URL}/`);
    await page.waitForTimeout(2000);

    // Precondition: confirm the card is present before asserting it is visible.
    // If this fails, the dashboard didn't reach the GetOperationalCard render
    // path — check whether additional API mocks are needed.
    await expect(
      page.getByTestId('get-operational-card'),
      'Card should still be visible when orderly import (a required step) is not yet done',
    ).toBeVisible();
  });
});
