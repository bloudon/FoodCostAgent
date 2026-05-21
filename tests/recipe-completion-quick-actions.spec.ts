/**
 * Automated tests for the recipe completion quick-action buttons.
 *
 * Covers four key paths:
 *   1. Desktop "Complete" button appears only on placeholder recipe rows, not on regular rows.
 *   2. Mobile dropdown places "Complete Recipe" at the top for placeholder recipes.
 *   3. "Complete all" button navigates to the first placeholder recipe with the queue banner visible.
 *   4. Queue progress indicator ("X of Y") advances correctly when the Skip button is clicked.
 *
 * All API responses are mocked via page.route() — no real auth or DB state is required.
 *
 * Components under test:
 *   - client/src/pages/recipes.tsx  (route: /recipes)
 *   - client/src/pages/recipe-builder.tsx  (route: /recipes/:id/edit)
 *
 * Note: URLs include "?app" to force app-mode routing in the development environment,
 * which uses hostname-based routing to separate the marketing site from the management app.
 * On localhost, isWebsiteMode is false, but the ?app flag is included defensively.
 */

import { test, expect, Page } from 'playwright/test';

const BASE_URL = 'http://localhost:5000';

// ---------------------------------------------------------------------------
// Test fixtures — two placeholder recipes and one regular recipe
// ---------------------------------------------------------------------------

const PLACEHOLDER_1 = {
  id: 'ph-recipe-001',
  name: 'Burger Placeholder',
  yieldQty: 1,
  yieldUnitId: 'unit-srv',
  computedCost: 0,
  canBeIngredient: 0,
  parentRecipeId: null,
  sizeName: null,
  isActive: 1,
  isPlaceholder: 1,
};

const PLACEHOLDER_2 = {
  id: 'ph-recipe-002',
  name: 'Pasta Placeholder',
  yieldQty: 1,
  yieldUnitId: 'unit-srv',
  computedCost: 0,
  canBeIngredient: 0,
  parentRecipeId: null,
  sizeName: null,
  isActive: 1,
  isPlaceholder: 1,
};

const REGULAR_RECIPE = {
  id: 'reg-recipe-001',
  name: 'Caesar Salad',
  yieldQty: 4,
  yieldUnitId: 'unit-srv',
  computedCost: 8.5,
  canBeIngredient: 0,
  parentRecipeId: null,
  sizeName: null,
  isActive: 1,
  isPlaceholder: 0,
};

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

/**
 * Mock /api/auth/me so ProtectedLayout does not redirect to /login.
 * Also stubs layout-shell calls that would fire 401s and affect test stability.
 */
async function mockAuth(page: Page): Promise<void> {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-id',
        email: 'admin@test.fnbcostpro.com',
        companyId: 'company-test-001',
        companyName: 'Test Kitchen',
        role: 'company_admin',
        firstName: 'Test',
        lastName: 'Admin',
        active: 1,
        subscriptionTier: 'pro',
      }),
    });
  });

  await page.route('**/api/stores', async (route) => {
    // Only intercept the plain /api/stores call (not /api/stores/accessible or sub-paths).
    if (!route.request().url().includes('/api/stores/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/onboarding/milestones', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dismissed: true, milestones: [] }),
    });
  });
}

/**
 * Mock /api/recipes list, missing-ingredients, and orphaned endpoints for the
 * recipes list page.
 */
async function mockRecipesList(page: Page, recipes: object[]): Promise<void> {
  await page.route('**/api/recipes/missing-ingredients', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/recipes/orphaned', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orphaned: [], parentTemplates: [], total: 0 }),
    });
  });

  // Must be registered after the more-specific routes above so it does not
  // intercept /api/recipes/missing-ingredients or /api/recipes/orphaned.
  await page.route('**/api/recipes', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(recipes),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock all API endpoints consumed by the recipe-builder page for a given recipe.
 * Does NOT set up a catch-all for /api/recipes — that is handled separately by the
 * caller so that route registration order can be controlled.
 */
async function mockRecipeBuilderRoutes(
  page: Page,
  recipe: { id: string; [key: string]: unknown },
): Promise<void> {
  const { id } = recipe;

  await page.route(`**/api/recipes/${id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(recipe),
    });
  });

  await page.route(`**/api/recipe-components/${id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(`**/api/store-recipes/${id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

/**
 * Mock the shared data endpoints consumed by the recipe-builder
 * (inventory items, units, categories, menu items, accessible stores).
 */
async function mockRecipeBuilderShared(page: Page): Promise<void> {
  await page.route('**/api/inventory-items', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/units', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/categories', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/menu-items', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/stores/accessible', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/inventory-item-units', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

/**
 * Navigate to /recipes with full mocking, then wait for the first recipe row.
 */
async function goToRecipesPage(page: Page, recipes: object[]): Promise<void> {
  await mockAuth(page);
  await mockRecipesList(page, recipes);
  // Use ?app to force app-mode routing in the development environment.
  await page.goto(`${BASE_URL}/recipes?app`);
  await page.waitForSelector('[data-testid^="row-recipe-"]:not([data-testid*="-mobile-"])', { timeout: 10000 });
}

// =============================================================================
// 1. Desktop: "Complete" button appears only on placeholder rows
// =============================================================================
test.describe('"Complete" button visibility on desktop recipe rows', () => {
  test('Complete button is visible on a placeholder recipe row (desktop)', async ({ page }) => {
    await goToRecipesPage(page, [PLACEHOLDER_1, REGULAR_RECIPE]);

    const completeBtn = page.getByTestId(`button-complete-recipe-${PLACEHOLDER_1.id}`);
    await expect(completeBtn).toBeVisible({ timeout: 5000 });
  });

  test('Complete button is NOT present on a regular (non-placeholder) recipe row', async ({ page }) => {
    await goToRecipesPage(page, [PLACEHOLDER_1, REGULAR_RECIPE]);

    // The regular recipe row should not have a "Complete" button.
    const completeBtnRegular = page.getByTestId(`button-complete-recipe-${REGULAR_RECIPE.id}`);
    await expect(completeBtnRegular).not.toBeVisible();

    // The regular recipe shows a "View" button instead.
    const viewBtn = page.getByTestId(`button-view-recipe-${REGULAR_RECIPE.id}`);
    await expect(viewBtn).toBeVisible();
  });

  test('"Needs completion" badge appears on placeholder rows but not on regular rows', async ({ page }) => {
    await goToRecipesPage(page, [PLACEHOLDER_1, REGULAR_RECIPE]);

    const placeholderBadge = page.getByTestId(`badge-needs-completion-${PLACEHOLDER_1.id}`);
    await expect(placeholderBadge).toBeVisible({ timeout: 5000 });

    const regularBadge = page.getByTestId(`badge-needs-completion-${REGULAR_RECIPE.id}`);
    await expect(regularBadge).not.toBeVisible();
  });
});

// =============================================================================
// 2. Mobile: "Complete Recipe" is at the top of the dropdown for placeholders
// =============================================================================
test.describe('"Complete Recipe" in mobile dropdown', () => {
  test('Complete Recipe appears in the mobile action dropdown for a placeholder recipe', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await mockAuth(page);
    await mockRecipesList(page, [PLACEHOLDER_1, REGULAR_RECIPE]);
    await page.goto(`${BASE_URL}/recipes?app`);

    await page.waitForSelector(
      `[data-testid="row-recipe-mobile-${PLACEHOLDER_1.id}"]`,
      { timeout: 10000 },
    );

    // Open the three-dot dropdown for the placeholder row.
    const dropdownTrigger = page.getByTestId(`button-actions-recipe-mobile-${PLACEHOLDER_1.id}`);
    await dropdownTrigger.click();

    // "Complete Recipe" item should now be visible.
    const completeItem = page.getByTestId(`button-complete-recipe-mobile-${PLACEHOLDER_1.id}`);
    await expect(completeItem).toBeVisible({ timeout: 3000 });

    // Assert ordering: "Complete Recipe" must be the first actionable item in the dropdown.
    // Radix DropdownMenuItems render with role="menuitem". The first one in the open menu
    // must be the "Complete Recipe" link — before "View Recipe" and any destructive actions.
    const firstMenuItem = page.locator('[role="menuitem"]').first();
    await expect(firstMenuItem).toHaveAttribute(
      'data-testid',
      `button-complete-recipe-mobile-${PLACEHOLDER_1.id}`,
    );
  });

  test('Complete Recipe does NOT appear in the mobile dropdown for a regular recipe', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await mockAuth(page);
    await mockRecipesList(page, [PLACEHOLDER_1, REGULAR_RECIPE]);
    await page.goto(`${BASE_URL}/recipes?app`);

    await page.waitForSelector(
      `[data-testid="row-recipe-mobile-${REGULAR_RECIPE.id}"]`,
      { timeout: 10000 },
    );

    // Open the three-dot dropdown for the regular recipe row.
    const dropdownTrigger = page.getByTestId(`button-actions-recipe-mobile-${REGULAR_RECIPE.id}`);
    await dropdownTrigger.click();

    // "Complete Recipe" should NOT be present for a regular recipe.
    const completeItem = page.getByTestId(`button-complete-recipe-mobile-${REGULAR_RECIPE.id}`);
    await expect(completeItem).not.toBeVisible();
  });
});

// =============================================================================
// 3. "Complete all" navigates to first placeholder with queue banner visible
// =============================================================================
test.describe('"Complete all" button launches the completion queue', () => {
  test('clicking Complete all navigates to the first placeholder recipe and shows the queue banner', async ({ page }) => {
    await mockAuth(page);
    await mockRecipesList(page, [PLACEHOLDER_1, PLACEHOLDER_2, REGULAR_RECIPE]);

    // Set up recipe-builder mocks before navigation so the builder page loads cleanly.
    await mockRecipeBuilderRoutes(page, PLACEHOLDER_1);
    await mockRecipeBuilderRoutes(page, PLACEHOLDER_2);
    await mockRecipeBuilderShared(page);

    // The builder also calls /api/recipes (flat list) — stub it for both placeholders.
    await page.route('**/api/recipes', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([PLACEHOLDER_1, PLACEHOLDER_2, REGULAR_RECIPE]),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE_URL}/recipes?app`);
    await page.waitForSelector('[data-testid="button-complete-all-recipes"]', { timeout: 10000 });

    await page.getByTestId('button-complete-all-recipes').click();

    // handleCompleteAll sorts placeholders alphabetically by name before building the queue.
    // PLACEHOLDER_1.name = "Burger Placeholder" sorts before PLACEHOLDER_2.name = "Pasta Placeholder",
    // so the first recipe opened must be ph-recipe-001.
    await page.waitForURL(
      (url) =>
        url.pathname === `/recipes/${PLACEHOLDER_1.id}/edit` &&
        url.searchParams.get('queueTotal') === '2' &&
        (url.searchParams.get('queue') ?? '').includes(PLACEHOLDER_2.id),
      { timeout: 8000 },
    );

    // Queue banner must be visible and show the correct progress.
    await expect(page.getByTestId('banner-completion-queue')).toBeVisible({ timeout: 8000 });
    const bannerText = await page.getByTestId('banner-completion-queue').textContent();
    expect(bannerText).toContain('1 of 2');
  });

  test('queue banner shows correct progress text on the first recipe (1 of N)', async ({ page }) => {
    await mockAuth(page);
    await mockRecipeBuilderRoutes(page, PLACEHOLDER_1);
    await mockRecipeBuilderShared(page);

    // Stub the flat /api/recipes list used by the recipe-builder's own query.
    await page.route('**/api/recipes', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([PLACEHOLDER_1]),
        });
      } else {
        await route.continue();
      }
    });

    // Navigate directly: queueTotal=2, queue has 1 remaining → currentQueuePosition = 2 − 1 = 1
    await page.goto(
      `${BASE_URL}/recipes/${PLACEHOLDER_1.id}/edit?queue=${PLACEHOLDER_2.id}&queueTotal=2&app`,
    );

    await expect(page.getByTestId('banner-completion-queue')).toBeVisible({ timeout: 10000 });

    const bannerText = await page.getByTestId('banner-completion-queue').textContent();
    expect(bannerText).toContain('1 of 2');
  });
});

// =============================================================================
// 4. Queue progress indicator advances correctly on Skip
// =============================================================================
test.describe('Queue progress advances when Skip is clicked', () => {
  test('clicking Skip from position 1 of 2 navigates to the second recipe showing 2 of 2', async ({ page }) => {
    await mockAuth(page);
    await mockRecipeBuilderRoutes(page, PLACEHOLDER_1);
    await mockRecipeBuilderRoutes(page, PLACEHOLDER_2);
    await mockRecipeBuilderShared(page);

    // Flat /api/recipes list for the builder.
    await page.route('**/api/recipes', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([PLACEHOLDER_1, PLACEHOLDER_2]),
        });
      } else {
        await route.continue();
      }
    });

    // Start at recipe 1 with recipe 2 still in the queue.
    await page.goto(
      `${BASE_URL}/recipes/${PLACEHOLDER_1.id}/edit?queue=${PLACEHOLDER_2.id}&queueTotal=2&app`,
    );

    await expect(page.getByTestId('banner-completion-queue')).toBeVisible({ timeout: 10000 });

    // Confirm position 1 of 2.
    let bannerText = await page.getByTestId('banner-completion-queue').textContent();
    expect(bannerText).toContain('1 of 2');

    // Click Skip → should navigate to recipe 2 with an empty queue param.
    await page.getByTestId('button-skip-recipe-in-queue').click();

    await page.waitForURL(
      (url) =>
        url.pathname.includes(PLACEHOLDER_2.id) &&
        url.searchParams.get('queueTotal') === '2',
      { timeout: 8000 },
    );

    // Banner must still be visible and now show "2 of 2".
    await expect(page.getByTestId('banner-completion-queue')).toBeVisible({ timeout: 8000 });
    bannerText = await page.getByTestId('banner-completion-queue').textContent();
    expect(bannerText).toContain('2 of 2');
  });

  test('queue banner is NOT shown when queueTotal is absent from the URL', async ({ page }) => {
    await mockAuth(page);
    await mockRecipeBuilderRoutes(page, PLACEHOLDER_1);
    await mockRecipeBuilderShared(page);

    await page.route('**/api/recipes', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([PLACEHOLDER_1]),
        });
      } else {
        await route.continue();
      }
    });

    // Navigate without any queue params — queueTotal defaults to 0, banner should not render.
    await page.goto(`${BASE_URL}/recipes/${PLACEHOLDER_1.id}/edit?app`);

    // The placeholder info banner should appear (recipe.isPlaceholder === 1).
    await page.waitForSelector('[data-testid="banner-placeholder-recipe"]', { timeout: 10000 });

    // The queue progress banner must NOT be visible.
    await expect(page.getByTestId('banner-completion-queue')).not.toBeVisible();
  });
});
