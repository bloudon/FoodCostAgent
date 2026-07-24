/**
 * Tests confirming that calorie edits made via the menu item edit form
 * (PATCH /api/menu-items/:id) are correctly persisted to the database.
 *
 * This test covers the post-import edit path, which is separate from the
 * menu-scan import path covered by menu-scan-calorie-persistence.spec.ts.
 *
 * The edit button lives inside a Radix DropdownMenu — the trigger
 * (button-menu-item-actions-{id} in flat view, button-actions-{id} in
 * hierarchy view) must be clicked first to render the dropdown content
 * before button-edit-{id} becomes clickable.
 *
 * Prerequisites (dev database):
 *   Email: admin@brians.pizza  /  Password: test123
 */

import { test, expect, Page, APIRequestContext } from 'playwright/test';

const BASE_URL      = 'http://localhost:5000';
const TEST_EMAIL    = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function enableAppMode(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/?app`);
  await page.waitForLoadState('networkidle');
}

async function loginBrowser(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(TEST_EMAIL);
  await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log in"), button:has-text("Login")').first().click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 10000 });
}

async function loginCookieApi(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status(), 'API login should succeed').toBe(200);
}

async function seedPendingSession(
  request: APIRequestContext,
): Promise<{ sessionId: string; storeId: string | null }> {
  const res = await request.post(`${BASE_URL}/api/dev/test/menu-import-session`, {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status() === 404 || res.status() === 401) {
    test.skip(true, 'Dev test helper endpoint not available');
    return { sessionId: '', storeId: null };
  }
  expect(res.status(), `Seed should succeed, got ${res.status()}`).toBe(200);
  const body = await res.json() as { sessionId: string; storeId: string | null };
  expect(body.sessionId).toBeTruthy();
  return body;
}

async function approveSession(
  request: APIRequestContext,
  sessionId: string,
  items: object[],
  storeId?: string | null,
): Promise<{ menuItemsCreated: number; menuItemIds: string[] }> {
  const res = await request.post(
    `${BASE_URL}/api/onboarding/menu-scan/${sessionId}/approve`,
    {
      data: { items, ...(storeId ? { storeId } : {}) },
      headers: { 'Content-Type': 'application/json' },
    },
  );
  expect(res.status(), `Approve should return 200, got ${res.status()}: ${await res.text()}`).toBe(200);
  return res.json();
}

async function deleteMenuImportSession(
  request: APIRequestContext,
  sessionId: string,
  menuItemIds: string[] = [],
): Promise<void> {
  if (!sessionId) return;
  await request.delete(
    `${BASE_URL}/api/dev/test/menu-import-session/${sessionId}`,
    { data: { menuItemIds }, headers: { 'Content-Type': 'application/json' } },
  );
  // 200 or 404 both acceptable — session may already be consumed by the approve step
}

function uniqueName(base: string): string {
  return `${base}-ecal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Opens the edit dialog for a menu item in flat view.
 *
 * Flat-view actions trigger: data-testid="button-menu-item-actions-{id}"
 * Edit dropdown item:        data-testid="button-edit-{id}"
 *
 * The edit dropdown item lives inside a Radix DropdownMenuContent and is
 * NOT in the DOM until the trigger is clicked.
 */
async function openEditDialogInFlatView(page: Page, itemId: string): Promise<void> {
  const trigger = page.getByTestId(`button-menu-item-actions-${itemId}`);
  await expect(trigger).toBeVisible({ timeout: 8000 });
  await trigger.click();

  // Wait for the dropdown to open and the edit item to appear
  const editItem = page.getByTestId(`button-edit-${itemId}`);
  await expect(editItem).toBeVisible({ timeout: 5000 });
  await editItem.click();

  // Wait for the edit dialog to open (calories input becomes visible)
  await expect(page.getByTestId('input-edit-calories')).toBeVisible({ timeout: 5000 });
}

/**
 * Switches the menu items page to flat list view.
 * The flat-view toggle button has data-testid="button-view-flat".
 * The page always resets to hierarchy view on each navigation, so this
 * must be called after every navigation to /menu-items.
 */
async function switchToFlatView(page: Page): Promise<void> {
  const flatBtn = page.getByTestId('button-view-flat');
  await expect(flatBtn).toBeVisible({ timeout: 5000 });
  await flatBtn.click();
  await page.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
// Suite — Edit form calorie persistence
// ---------------------------------------------------------------------------

test.describe('Menu item edit form — calorie persistence', () => {
  let seededSessionId = '';
  let seededMenuItemId = '';

  test.beforeEach(async ({ page, request }) => {
    seededSessionId = '';
    seededMenuItemId = '';
    await loginCookieApi(request);
    await enableAppMode(page);
    await loginBrowser(page);
  });

  test.afterEach(async ({ request }) => {
    if (seededSessionId) {
      await deleteMenuImportSession(
        request,
        seededSessionId,
        seededMenuItemId ? [seededMenuItemId] : [],
      );
    }
    seededSessionId = '';
    seededMenuItemId = '';
  });

  test('editing calories via the edit form saves the new value to the database', async ({ page, request }) => {
    // Seed a menu item with calorieCount = 350 that will be edited to 720
    const { sessionId, storeId } = await seedPendingSession(request);
    seededSessionId = sessionId;
    if (!sessionId) return;

    const itemName = uniqueName('Veggie Wrap');
    const { menuItemIds } = await approveSession(
      request,
      sessionId,
      [{ name: itemName, department: 'Mains', price: 11.99, calorieCount: 350 }],
      storeId,
    );
    expect(menuItemIds.length, 'One menu item should be created').toBe(1);
    seededMenuItemId = menuItemIds[0];

    // Navigate to menu items in flat view so the row actions are accessible
    await page.goto(`${BASE_URL}/menu-items`);
    await page.waitForLoadState('networkidle');
    await switchToFlatView(page);

    // Search to narrow the list to the seeded item
    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill(itemName);
      await page.waitForLoadState('networkidle');
    }

    // Open edit dialog: click actions trigger → click Edit dropdown item
    await openEditDialogInFlatView(page, seededMenuItemId);

    // Confirm the seeded calorie value is pre-filled
    const calorieInput = page.getByTestId('input-edit-calories');
    await expect(calorieInput).toHaveValue('350');

    // Update to 720
    await calorieInput.fill('720');
    await expect(calorieInput).toHaveValue('720');

    // Save — wait for the dialog to close as confirmation
    const saveButton = page.getByTestId('button-confirm-edit');
    await expect(saveButton).toBeEnabled();

    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes(`/api/menu-items/${seededMenuItemId}`) && resp.request().method() === 'PATCH',
        { timeout: 10000 },
      ),
      saveButton.click(),
    ]);
    expect(patchResponse.status(), 'PATCH /api/menu-items/:id should return 200').toBe(200);

    // Verify persistence via API readback
    const listRes = await request.get(`${BASE_URL}/api/menu-items`);
    expect(listRes.status()).toBe(200);
    const allItems = await listRes.json() as Array<{ id: string; calorieCount: number | null }>;
    const savedItem = allItems.find(i => i.id === seededMenuItemId);
    expect(savedItem, 'Updated menu item should exist in the database').toBeDefined();
    expect(savedItem!.calorieCount, 'calorieCount should be 720 after edit').toBe(720);
  });

  test('clearing calories in the edit form saves null to the database', async ({ page, request }) => {
    // Seed an item with calorieCount = 500 that will be cleared to null
    const { sessionId, storeId } = await seedPendingSession(request);
    seededSessionId = sessionId;
    if (!sessionId) return;

    const itemName = uniqueName('Garden Salad');
    const { menuItemIds } = await approveSession(
      request,
      sessionId,
      [{ name: itemName, department: 'Salads', price: 9.99, calorieCount: 500 }],
      storeId,
    );
    expect(menuItemIds.length).toBe(1);
    seededMenuItemId = menuItemIds[0];

    // Navigate to menu items in flat view
    await page.goto(`${BASE_URL}/menu-items`);
    await page.waitForLoadState('networkidle');
    await switchToFlatView(page);

    // Search for the item
    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill(itemName);
      await page.waitForLoadState('networkidle');
    }

    // Open edit dialog
    await openEditDialogInFlatView(page, seededMenuItemId);

    const calorieInput = page.getByTestId('input-edit-calories');
    await expect(calorieInput).toHaveValue('500');

    // Clear the calorie field
    await calorieInput.clear();
    await expect(calorieInput).toHaveValue('');

    // Save
    const saveButton = page.getByTestId('button-confirm-edit');
    await expect(saveButton).toBeEnabled();

    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes(`/api/menu-items/${seededMenuItemId}`) && resp.request().method() === 'PATCH',
        { timeout: 10000 },
      ),
      saveButton.click(),
    ]);
    expect(patchResponse.status(), 'PATCH /api/menu-items/:id should return 200').toBe(200);

    // Verify null is persisted
    const listRes = await request.get(`${BASE_URL}/api/menu-items`);
    expect(listRes.status()).toBe(200);
    const allItems = await listRes.json() as Array<{ id: string; calorieCount: number | null }>;
    const savedItem = allItems.find(i => i.id === seededMenuItemId);
    expect(savedItem, 'Menu item should still exist after clearing calories').toBeDefined();
    expect(savedItem!.calorieCount, 'calorieCount should be null after clearing the field').toBeNull();
  });
});
