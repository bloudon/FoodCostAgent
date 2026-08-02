/**
 * Playwright tests: 'No recipe linked' badge in the waste log
 *
 * The GET /api/waste enrichment attaches `noRecipeLinked: true` to waste
 * log entries for menu items that have no recipe.  The badge is rendered
 * inside the Menu Items table of the Waste page.
 *
 * These tests verify:
 *   1. The amber "No recipe linked" badge appears on a menu-item waste entry
 *      when `noRecipeLinked` is `true`.
 *   2. The badge is absent when `noRecipeLinked` is `false` (recipe exists).
 *
 * All API calls are mocked — no live database required.
 * The app must be running at http://localhost:5000 (npm run dev).
 */

import { test, expect, Page } from './test-helpers';

const BASE_URL   = 'http://localhost:5000';
const STORE_ID   = 'store-badge-932';
const STORE_NAME = "Brian's Pizza";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Stubs every API route the Waste page needs to render.
 *
 * wasteLogs is injected as the body of GET /api/waste responses so each
 * test can supply its own scenario.
 */
async function mockWastePage(page: Page, wasteLogs: object[]): Promise<void> {
  // Auth
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-932',
        email: 'admin@brians.pizza',
        companyId: 'company-932',
        companyName: STORE_NAME,
        role: 'company_admin',
        firstName: 'Test',
        lastName: 'Admin',
        active: 1,
        subscriptionPlan: 'platform',
      }),
    }),
  );

  // Stores accessible to this user
  await page.route('**/api/stores/accessible', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: STORE_ID, name: STORE_NAME }]),
    }),
  );

  // Waste log — respond to any query-param combination
  await page.route(`**/api/waste**`, (route) => {
    const url = route.request().url();
    if (route.request().method() === 'GET' && url.includes('/api/waste')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(wasteLogs),
      });
    }
    return route.continue();
  });

  // Shell / layout stubs
  await page.route('**/api/onboarding/milestones', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dismissed: true, milestones: [] }),
    }),
  );

  await page.route('**/api/categories', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  await page.route('**/api/units', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  await page.route('**/api/system-preferences', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        unitSystem: 'imperial',
        currency: 'USD',
        timezone: 'America/Chicago',
        posSystem: null,
        posApiKey: null,
      }),
    }),
  );

  // Voice failures report (manager role)
  await page.route('**/api/reports/voice-interpret-failures**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ days: 30, rows: [] }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Shared waste log fixtures
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString();

/** A menu-item waste entry where the item has NO linked recipe. */
const entryNoRecipe = {
  id: 'wl-no-recipe-932',
  wasteType: 'menu_item',
  inventoryItemName: null,
  menuItemName: 'Caesar Salad',
  qty: 2,
  unitName: null,
  reasonCode: 'SPOILED',
  notes: null,
  wastedAt: TODAY,
  totalValue: 0,
  storeName: STORE_NAME,
  noRecipeLinked: true,
};

/** A menu-item waste entry where the item HAS a linked recipe. */
const entryWithRecipe = {
  id: 'wl-with-recipe-932',
  wasteType: 'menu_item',
  inventoryItemName: null,
  menuItemName: 'Margherita Pizza',
  qty: 1,
  unitName: null,
  reasonCode: 'OVERPRODUCTION',
  notes: null,
  wastedAt: TODAY,
  totalValue: 4.5,
  storeName: STORE_NAME,
  noRecipeLinked: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Waste log — "No recipe linked" badge', () => {
  test('badge appears for a menu-item entry with noRecipeLinked = true', async ({ page }) => {
    await mockWastePage(page, [entryNoRecipe]);
    await page.goto(`${BASE_URL}/waste`);

    // Wait for the Menu Items section to load
    await expect(page.getByText('Caesar Salad')).toBeVisible({ timeout: 15000 });

    // The amber badge must be present inside the row for this item
    const row = page.locator('tr', { hasText: 'Caesar Salad' });
    await expect(row.getByText('No recipe linked')).toBeVisible({ timeout: 5000 });
  });

  test('badge is absent for a menu-item entry with noRecipeLinked = false', async ({ page }) => {
    await mockWastePage(page, [entryWithRecipe]);
    await page.goto(`${BASE_URL}/waste`);

    await expect(page.getByText('Margherita Pizza')).toBeVisible({ timeout: 15000 });

    // No badge should appear anywhere on the page
    await expect(page.getByText('No recipe linked')).not.toBeVisible();
  });

  test('badge appears only on the no-recipe row when both entries are present', async ({ page }) => {
    await mockWastePage(page, [entryNoRecipe, entryWithRecipe]);
    await page.goto(`${BASE_URL}/waste`);

    // Both items should be visible
    await expect(page.getByText('Caesar Salad')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Margherita Pizza')).toBeVisible({ timeout: 5000 });

    // Badge is present in the Caesar Salad row
    const noRecipeRow = page.locator('tr', { hasText: 'Caesar Salad' });
    await expect(noRecipeRow.getByText('No recipe linked')).toBeVisible({ timeout: 5000 });

    // Badge is absent in the Margherita Pizza row
    const recipeRow = page.locator('tr', { hasText: 'Margherita Pizza' });
    await expect(recipeRow.getByText('No recipe linked')).not.toBeVisible();
  });
});
