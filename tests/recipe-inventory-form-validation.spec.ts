/**
 * Playwright tests for form validation on the recipe ingredient edit dialog
 * and the inventory item vendor (unit cost) row.
 *
 * PURPOSE
 * -------
 * Both forms accept cost and quantity data. Incomplete values reaching the API
 * could silently corrupt inventory calculations or food-cost percentages.
 * These tests submit known-bad input and assert that a visible error appears
 * BEFORE any API write is made.
 *
 * COVERAGE
 * --------
 *   1. Recipe ingredient edit dialog — blank quantity → "Quantity required" toast,
 *      no PATCH to /api/recipe-components.
 *   2. Inventory vendor row (unit cost) — zero/blank case price →
 *      "Unit cost required" toast, no POST to /api/vendor-items.
 *
 * All GET API calls are mocked with a single catch-all route handler so that
 * no live database is required. Non-GET requests are passed through via
 * route.continue() so they reach the real network (write mutations are blocked
 * by validation before they fire).
 *
 * ROUTE HANDLER STRATEGY
 * ----------------------
 * A single page.route('**', handler) is the primary mock. It intercepts every
 * browser request; non-API or non-GET requests call route.continue() so that
 * static assets, HMR, and write mutations pass through normally. API GETs are
 * matched with url.includes() checks ordered most-specific first.
 *
 * Write-check interceptors are registered AFTER the primary mock. Because
 * Playwright 1.58 uses LIFO (last-added = first-to-fire), these fire before
 * the primary mock. They call route.fallback() for GETs (handing off to the
 * primary mock) and route.continue() for writes (passing straight to network).
 *
 * Relevant source files:
 *   artifacts/fnb-cost-pro/src/pages/recipe-builder.tsx
 *   artifacts/fnb-cost-pro/src/pages/inventory-item-detail.tsx
 */

import { test, expect, Page } from './test-helpers';

const BASE_URL = 'http://localhost:5000';

// ---------------------------------------------------------------------------
// Shared mock user
// ---------------------------------------------------------------------------

const AUTHED_USER = {
  id: 'user-1',
  companyId: 'company-1',
  role: 'company_admin',
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  subscriptionPlan: 'platform',
  // Matches the app version (1.14.0) so the VersionBanner is suppressed and
  // no POST to /api/user/acknowledge-version fires on page load.
  lastSeenVersion: '1.14.0',
  active: 1,
};

// ---------------------------------------------------------------------------
// 1. Recipe ingredient edit dialog
// ---------------------------------------------------------------------------

const RECIPE_ID = 'test-recipe-id';
const COMP_ID = 'comp-1';
const ITEM_ID = 'item-1';
const UNIT_ID = 'u1';

const MOCK_RECIPE = {
  id: RECIPE_ID,
  name: 'Test Recipe',
  yieldQty: 10,
  yieldUnitId: UNIT_ID,
  canBeIngredient: 0,
  sizeName: null,
  instructions: null,
  imagePath: null,
  isPlaceholder: 0,
  companyId: 'company-1',
};

const MOCK_COMPONENT = {
  id: COMP_ID,
  recipeId: RECIPE_ID,
  componentType: 'inventory_item',
  componentId: ITEM_ID,
  qty: 2,
  unitId: UNIT_ID,
  sortOrder: 0,
  missingItem: false,
};

const MOCK_INVENTORY_ITEM = {
  id: ITEM_ID,
  name: 'Flour',
  unitId: UNIT_ID,
  pricePerUnit: 1.5,
  categoryId: 'cat-1',
  active: 1,
  yieldPercent: 100,
};

const MOCK_UNIT = { id: UNIT_ID, name: 'lb', kind: 'weight', toBaseRatio: 453.6 };

/**
 * Registers a single catch-all route handler for the recipe builder page.
 * Specific API paths are matched with url.includes(); all unrecognised API GETs
 * return null so that components guarded with `if (!data)` exit cleanly.
 */
async function setupRecipeBuilder(page: Page): Promise<void> {
  await page.route('**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Pass non-GET and non-API requests straight through to the network.
    if (!url.includes('/api/') || method !== 'GET') return route.continue();

    const json = (data: unknown) => ({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
    const nullJson = { status: 200, contentType: 'application/json', body: 'null' };

    // Auth & layout endpoints
    if (url.includes('/api/auth/me')) return route.fulfill(json(AUTHED_USER));
    if (url.includes('/api/stores/accessible')) return route.fulfill(json([{ id: 's1', name: 'Main', status: 'active' }]));
    if (url.includes('/api/pos/connections')) return route.fulfill(json([]));
    if (url.includes('/api/onboarding/milestones')) return route.fulfill(nullJson);

    // More-specific recipe paths before the general /api/recipes catch
    if (url.includes(`/api/recipes/${RECIPE_ID}`)) return route.fulfill(json(MOCK_RECIPE));
    if (url.includes(`/api/recipe-components/${RECIPE_ID}`)) return route.fulfill(json([MOCK_COMPONENT]));
    if (url.includes(`/api/store-recipes/${RECIPE_ID}`)) return route.fulfill(json([{ storeId: 's1' }]));

    // Unit lookups (the edit dialog fires /api/units/compatible?... on open)
    if (url.includes('/api/units/compatible')) return route.fulfill(json([MOCK_UNIT]));
    if (url.includes('/api/inventory-item-units')) return route.fulfill(json([]));
    if (url.includes('/api/units')) return route.fulfill(json([MOCK_UNIT]));

    // Inventory items and all recipes (used for ingredient enrichment in useEffect)
    if (url.includes('/api/inventory-items')) return route.fulfill(json([MOCK_INVENTORY_ITEM]));
    if (url.includes('/api/recipes')) return route.fulfill(json([MOCK_RECIPE]));

    // Anything else: return null so components guard cleanly
    return route.fulfill(nullJson);
  });
}

test.describe('Recipe ingredient edit dialog — quantity validation', () => {
  test('shows "Quantity required" toast when quantity is cleared and Save is clicked', async ({ page }) => {
    await setupRecipeBuilder(page);
    await page.goto(`${BASE_URL}/recipes/${RECIPE_ID}/edit`);

    // Wait for the ingredient row to appear (useEffect runs once all data resolves)
    await expect(page.getByTestId(`text-ingredient-name-${COMP_ID}`)).toBeVisible({ timeout: 20000 });

    // Open the edit dialog via the edit button on the ingredient row
    await page.getByTestId(`button-edit-ingredient-${COMP_ID}`).click();
    await expect(page.getByTestId('dialog-edit-ingredient')).toBeVisible({ timeout: 5000 });

    // Clear the quantity field and attempt to save
    await page.getByTestId('input-edit-qty').fill('');
    await page.getByTestId('button-confirm-edit').click();

    // exact: true avoids also matching the hidden aria-live status region
    await expect(page.getByText('Quantity required', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('shows "Quantity required" toast when quantity is zero', async ({ page }) => {
    await setupRecipeBuilder(page);
    await page.goto(`${BASE_URL}/recipes/${RECIPE_ID}/edit`);

    await expect(page.getByTestId(`text-ingredient-name-${COMP_ID}`)).toBeVisible({ timeout: 20000 });
    await page.getByTestId(`button-edit-ingredient-${COMP_ID}`).click();
    await expect(page.getByTestId('dialog-edit-ingredient')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('input-edit-qty').fill('0');
    await page.getByTestId('button-confirm-edit').click();

    await expect(page.getByText('Quantity required', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('no PATCH to recipe-components is made when quantity is blank', async ({ page }) => {
    await setupRecipeBuilder(page);

    // Write-check interceptor added AFTER the primary mock.
    // Playwright 1.58 LIFO: this fires FIRST; route.fallback() passes GETs
    // to the primary '**' mock so recipe-components still load correctly.
    let patchCalled = false;
    await page.route('**/api/recipe-components/**', (route) => {
      if (route.request().method() !== 'GET') {
        if (route.request().method() === 'PATCH') patchCalled = true;
        return route.continue(); // send write to network (validation should prevent this)
      }
      return route.fallback(); // pass GET to the '**' handler above
    });

    await page.goto(`${BASE_URL}/recipes/${RECIPE_ID}/edit`);
    await expect(page.getByTestId(`text-ingredient-name-${COMP_ID}`)).toBeVisible({ timeout: 20000 });
    await page.getByTestId(`button-edit-ingredient-${COMP_ID}`).click();
    await expect(page.getByTestId('dialog-edit-ingredient')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('input-edit-qty').fill('');
    await page.getByTestId('button-confirm-edit').click();

    await expect(page.getByText('Quantity required', { exact: true })).toBeVisible({ timeout: 5000 });
    expect(patchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Inventory item vendor row — blank / zero unit cost (case price)
// ---------------------------------------------------------------------------

const INV_ITEM_ID = 'test-item-id';
const INV_UNIT_ID = 'u2';

const MOCK_INV_ITEM = {
  id: INV_ITEM_ID,
  name: 'Chicken Breast',
  unitId: INV_UNIT_ID,
  active: 1,
  categoryId: 'cat-2',
  pricePerUnit: 5.0,
  yieldPercent: 100,
};

const MOCK_INV_UNIT = { id: INV_UNIT_ID, name: 'lb', kind: 'weight', toBaseRatio: 453.6 };

/**
 * Registers a single catch-all route handler for the inventory item detail page.
 * Sub-resource paths (e.g. /vendor-items) are checked before the parent
 * /api/inventory-items/{id} path so the more-specific mock wins.
 */
async function setupInventoryItemDetail(page: Page): Promise<void> {
  await page.route('**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (!url.includes('/api/') || method !== 'GET') return route.continue();

    const json = (data: unknown) => ({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
    const nullJson = { status: 200, contentType: 'application/json', body: 'null' };

    // Auth & layout
    if (url.includes('/api/auth/me')) return route.fulfill(json(AUTHED_USER));
    if (url.includes('/api/stores/accessible')) return route.fulfill(json([{ id: 's1', name: 'Main', status: 'active' }]));
    if (url.includes('/api/pos/connections')) return route.fulfill(json([]));
    if (url.includes('/api/onboarding/milestones')) return route.fulfill(nullJson);

    // Inventory item sub-resources — checked before the parent path
    if (url.includes(`/api/inventory-items/${INV_ITEM_ID}/vendor-items`)) return route.fulfill(json([]));
    if (url.includes(`/api/inventory-items/${INV_ITEM_ID}/stores`)) return route.fulfill(json([{ storeId: 's1' }]));
    if (url.includes(`/api/inventory-items/${INV_ITEM_ID}/recipe-units`)) return route.fulfill(json([]));
    if (url.includes(`/api/inventory-items/${INV_ITEM_ID}/locations`)) return route.fulfill(json([]));

    // Inventory item detail — the custom queryFn may add ?store_id= params;
    // url.includes() matches both the plain and param forms.
    if (url.includes(`/api/inventory-items/${INV_ITEM_ID}`)) return route.fulfill(json(MOCK_INV_ITEM));

    // Supporting data
    if (url.includes('/api/units/compatible')) return route.fulfill(json([MOCK_INV_UNIT]));
    if (url.includes('/api/units')) return route.fulfill(json([MOCK_INV_UNIT]));
    if (url.includes('/api/vendors')) return route.fulfill(json([{ id: 'v1', name: 'US Foods' }]));

    return route.fulfill(nullJson);
  });
}

/**
 * Opens the new vendor row on the inventory item detail page and selects a
 * vendor so that the save button becomes enabled (the button is disabled until
 * both vendorId and purchaseUnitId are set; purchaseUnitId defaults to the
 * item's own unit, so only the vendor needs selecting).
 */
async function openVendorRowAndSelectVendor(page: Page): Promise<void> {
  await expect(page.getByTestId('button-add-vendor')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('button-add-vendor').click();
  await expect(page.getByTestId('vendor-item-row-new')).toBeVisible({ timeout: 5000 });

  // Select a vendor so the save button becomes enabled
  await page.getByTestId('select-vendor-new').click();
  await page.getByRole('option', { name: 'US Foods' }).click();

  // Save button should now be enabled (vendorId set, purchaseUnitId pre-set to item unit)
  await expect(page.getByTestId('button-save-vendor-new')).toBeEnabled({ timeout: 3000 });
}

test.describe('Inventory item vendor row — unit cost validation', () => {
  test('shows "Unit cost required" toast when case price is zero before saving', async ({ page }) => {
    await setupInventoryItemDetail(page);
    await page.goto(`${BASE_URL}/inventory-items/${INV_ITEM_ID}`);

    // Open the row and select vendor (enables the save button)
    await openVendorRowAndSelectVendor(page);

    // The row initialises with lastCasePrice = "0"; attempt to save
    await page.getByTestId('button-save-vendor-new').click();

    await expect(page.getByText('Unit cost required', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('no POST to vendor-items is made when case price is zero', async ({ page }) => {
    await setupInventoryItemDetail(page);

    // Write-check interceptor registered after the primary mock (LIFO → fires first).
    // route.fallback() for GETs passes to the primary '**' handler.
    let postCalled = false;
    await page.route('**/api/vendor-items', (route) => {
      if (route.request().method() !== 'GET') {
        if (route.request().method() === 'POST') postCalled = true;
        return route.continue();
      }
      return route.fallback();
    });

    await page.goto(`${BASE_URL}/inventory-items/${INV_ITEM_ID}`);
    await openVendorRowAndSelectVendor(page);

    // The row initialises with lastCasePrice = "0"; attempt to save
    await page.getByTestId('button-save-vendor-new').click();

    await expect(page.getByText('Unit cost required', { exact: true })).toBeVisible({ timeout: 5000 });
    expect(postCalled).toBe(false);
  });
});
