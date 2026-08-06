/**
 * Tests confirming that calorie values entered during the menu-scan review
 * step survive the full import end-to-end — both via the API contract and
 * the real UI path (the primary acceptance surface for this feature).
 *
 * UI-path test (Suite 1):
 *   Mocks the object-upload and AI-scan endpoints so no real storage or GPT
 *   call is needed, then drives the browser through the actual MenuScanStep
 *   component:  upload → bar-question (skipped) → review → type calories →
 *   import → verify persisted calorieCount via API readback.
 *
 * API-contract tests (Suite 2):
 *   Direct calls to the approve endpoint to verify the full matrix of
 *   calorieCount values (explicit, null, 0, multi-item).
 *
 * Prerequisites (dev database):
 *   Email: admin@brians.pizza  /  Password: test123
 *
 * The dev-only POST /api/dev/test/menu-import-session helper seeds a pending
 * session record without a real AI scan.
 */

import { test, expect, Page, APIRequestContext } from 'playwright/test';

const BASE_URL      = 'http://localhost:5000';
const TEST_EMAIL    = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';

/** Company ID for admin@brians.pizza in the dev database. */
const TEST_COMPANY_ID = 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
const WIZARD_KEY      = `onboarding_wizard_${TEST_COMPANY_ID}`;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function enableAppMode(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/?app`);
  await page.waitForTimeout(500);
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

async function setWizardStep(page: Page, step: number): Promise<void> {
  await page.evaluate(
    ({ key, companyId, targetStep }: { key: string; companyId: string; targetStep: number }) => {
      localStorage.setItem('selectedCompanyId', companyId);
      const existing = localStorage.getItem(key);
      const base = existing ? JSON.parse(existing) : { approvedMenuItems: [], skippedRecipes: [] };
      localStorage.setItem(key, JSON.stringify({ ...base, step: targetStep }));
    },
    { key: WIZARD_KEY, companyId: TEST_COMPANY_ID, targetStep: step },
  );
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

async function deleteMenuImportSession(
  request: APIRequestContext,
  sessionId: string,
  menuItemIds: string[] = [],
): Promise<void> {
  if (!sessionId) return;
  const res = await request.delete(
    `${BASE_URL}/api/dev/test/menu-import-session/${sessionId}`,
    { data: { menuItemIds }, headers: { 'Content-Type': 'application/json' } },
  );
  if (res.status() !== 200 && res.status() !== 404) {
    console.warn(`[afterEach] Failed to delete test session ${sessionId}: HTTP ${res.status()}`);
  }
}

function uniqueName(base: string): string {
  return `${base}-cal-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Suite 1 — UI path (primary acceptance test)
// ---------------------------------------------------------------------------

/**
 * Drives the real MenuScanStep component through the browser:
 *  - mocks the storage-upload and AI-scan endpoints
 *  - returns one item with calorieCount: null so the user must type it
 *  - types a calorie value in the review UI
 *  - clicks Import
 *  - verifies the persisted value in the database via GET /api/menu-items
 */
test.describe('Menu scan calorie entry — UI path (primary)', () => {
  let seededSessionId = '';
  let seededMenuItemIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    seededSessionId = '';
    seededMenuItemIds = [];
    await enableAppMode(page);
    await loginBrowser(page);
  });

  test.afterEach(async ({ page }) => {
    if (seededSessionId) {
      await deleteMenuImportSession(page.request, seededSessionId, seededMenuItemIds);
    }
    seededSessionId = '';
    seededMenuItemIds = [];
  });

  test('typing a calorie value in the review form persists to the database after import', async ({ page }) => {
    // This test requires a full browser environment.  In the Replit development
    // container the system libraries needed by Firefox/Chromium are unavailable,
    // so we skip locally and let GitHub Actions (CI=true) run the full flow.
    test.skip(!process.env.CI, 'Browser test — runs in CI (GitHub Actions) only; use the vitest component tests for local validation');

    // Seed a real pending session so the approve endpoint can find it
    const { sessionId } = await seedPendingSession(page.request);
    seededSessionId = sessionId;
    if (!sessionId) return; // test.skip called inside seedPendingSession

    const itemName = uniqueName('Grilled Chicken');

    // --- Mock: object storage upload (ObjectUploader calls this first) ---
    await page.route('**/api/objects/upload', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ objectPath: 'test/mock-menu.jpg' }),
      });
    });

    // --- Mock: AI menu scan — return the real seeded sessionId with one item
    //     that has calorieCount: null (the user will fill it in) ---
    await page.route('**/api/onboarding/menu-scan', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          items: [
            {
              name: itemName,
              description: 'Herb-marinated and grilled to order',
              department: 'Entrees',
              category: 'Grill',
              size: '',
              price: 22.99,
              calorieCount: null, // intentionally null — user enters this
              variantGroupKey: '',
            },
          ],
          intelligence: {
            phones: [],
            addresses: [],
            locationCount: 1,
            multiLocationSignal: false,
          },
        }),
      });
    });

    // --- Mock: has-bar (non-fatal, but prevents noise in the test log) ---
    await page.route('**/api/onboarding/has-bar', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    // Navigate to the onboarding wizard and force it to step 1 (menu scan)
    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);
    await setWizardStep(page, 1);
    await page.reload();
    await page.waitForTimeout(2000);

    // The upload card should be visible
    await expect(page.getByTestId('card-step-menu-scan')).toBeVisible({ timeout: 8000 });

    // Trigger the hidden file input via the file-chooser event pattern
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId('button-upload-menu').click(),
    ]);
    await fileChooser.setFiles({
      name: 'menu.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    });

    // After scan mock resolves, the bar-question card appears
    await expect(page.getByTestId('card-step-bar-question')).toBeVisible({ timeout: 8000 });

    // Skip the bar question to proceed to the review step
    await page.getByTestId('button-skip-bar-question').click();

    // Review card should now be visible
    await expect(page.getByTestId('card-step-menu-review')).toBeVisible({ timeout: 8000 });

    // Calorie input for item 0 should be empty (AI returned null)
    const calorieInput = page.getByTestId('input-item-calories-0');
    await expect(calorieInput).toBeVisible();
    await expect(calorieInput).toHaveValue('');

    // User types the calorie count
    await calorieInput.fill('580');
    await expect(calorieInput).toHaveValue('580');

    // Intercept the approve response so we can capture the created item IDs for cleanup
    page.on('response', async (response) => {
      if (response.url().includes('/approve') && response.status() === 200) {
        try {
          const body = await response.json() as { menuItemIds?: string[] };
          if (Array.isArray(body.menuItemIds)) {
            seededMenuItemIds.push(...body.menuItemIds);
          }
        } catch { /* ignore */ }
      }
    });

    // Click the Import button
    await page.getByTestId('button-import-items').click();

    // Wait for the approve call to complete (toast appears or review card is gone)
    await page.waitForTimeout(3000);

    // Verify persistence: fetch the menu items list and find our item by ID
    // (We either captured the ID from the response interceptor, or fall back to name-match)
    const listRes = await page.request.get(`${BASE_URL}/api/menu-items`);
    expect(listRes.status(), 'GET /api/menu-items should return 200').toBe(200);
    const allItems = await listRes.json() as Array<{ id: string; name: string; calorieCount: number | null }>;

    // Try ID-based lookup first (most reliable), fall back to name match
    let savedItem: { id: string; name: string; calorieCount: number | null } | undefined;
    if (seededMenuItemIds.length > 0) {
      savedItem = allItems.find(i => seededMenuItemIds.includes(i.id));
    }
    if (!savedItem) {
      savedItem = allItems.find(i => i.name === itemName);
      if (savedItem && !seededMenuItemIds.includes(savedItem.id)) {
        seededMenuItemIds.push(savedItem.id);
      }
    }

    expect(savedItem, `Menu item "${itemName}" should exist in the database`).toBeDefined();
    expect(savedItem!.calorieCount, 'calorieCount should match the value typed in the UI (580)').toBe(580);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — API contract (supporting coverage)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Suite 3 — menu-items page import path (/api/menu-import/:id/approve)
// ---------------------------------------------------------------------------
/**
 * Mirrors Suite 2 but exercises the second independent approve code path used
 * by the menu management page (/api/menu-import/:sessionId/approve).  This
 * endpoint returns { menuItemsCreated, skipped, recipesSeeded } — it does NOT
 * return created item IDs — so items are located by name after the fact.
 */
test.describe('Menu-items page import — calorie persistence (/api/menu-import)', () => {
  let seededSessionIds: string[] = [];
  let seededMenuItemIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    seededSessionIds = [];
    seededMenuItemIds = [];
    await loginCookieApi(request);
  });

  test.afterEach(async ({ request }) => {
    for (const sessionId of seededSessionIds) {
      await deleteMenuImportSession(request, sessionId, seededMenuItemIds);
    }
    seededSessionIds = [];
    seededMenuItemIds = [];
  });

  async function approveViaMenuImport(
    request: APIRequestContext,
    sessionId: string,
    items: object[],
    storeId?: string | null,
  ): Promise<{ menuItemsCreated: number }> {
    const res = await request.post(
      `${BASE_URL}/api/menu-import/${sessionId}/approve`,
      {
        data: { items, ...(storeId ? { storeId } : {}) },
        headers: { 'Content-Type': 'application/json' },
      },
    );
    expect(res.status(), `menu-import approve should return 200, got ${res.status()}: ${await res.text()}`).toBe(200);
    return res.json();
  }

  async function fetchMenuItemByName(
    request: APIRequestContext,
    name: string,
  ): Promise<{ id: string; name: string; calorieCount: number | null } | null> {
    const res = await request.get(`${BASE_URL}/api/menu-items`);
    expect(res.status()).toBe(200);
    const items = await res.json() as Array<{ id: string; name: string; calorieCount: number | null }>;
    return items.find(i => i.name === name) ?? null;
  }

  test('explicit calorieCount is persisted via the menu-import path', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    seededSessionIds.push(sessionId);

    const itemName = uniqueName('Grilled Salmon Import');
    const body = await approveViaMenuImport(request, sessionId, [
      { name: itemName, department: 'Entrees', price: 24.99, calorieCount: 480 },
    ], storeId);

    expect(body.menuItemsCreated).toBe(1);
    const saved = await fetchMenuItemByName(request, itemName);
    expect(saved, `Menu item "${itemName}" should exist in the database`).not.toBeNull();
    seededMenuItemIds.push(saved!.id);
    expect(saved!.calorieCount, 'calorieCount should be 480').toBe(480);
  });

  test('calorieCount null is stored as null via the menu-import path', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    seededSessionIds.push(sessionId);

    const itemName = uniqueName('Caesar Salad Import');
    await approveViaMenuImport(request, sessionId, [
      { name: itemName, department: 'Salads', price: 13.50, calorieCount: null },
    ], storeId);

    const saved = await fetchMenuItemByName(request, itemName);
    expect(saved, `Menu item "${itemName}" should exist in the database`).not.toBeNull();
    seededMenuItemIds.push(saved!.id);
    expect(saved!.calorieCount, 'calorieCount should be null').toBeNull();
  });

  test('each item in a batch retains its own calorieCount via the menu-import path', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    seededSessionIds.push(sessionId);

    const burgerName = uniqueName('Burger Import');
    const friesName  = uniqueName('Fries Import');
    const sodaName   = uniqueName('Soda Import');

    const body = await approveViaMenuImport(request, sessionId, [
      { name: burgerName, department: 'Mains',  price: 14.99, calorieCount: 750 },
      { name: friesName,  department: 'Sides',  price:  4.99, calorieCount: 320 },
      { name: sodaName,   department: 'Drinks', price:  2.99, calorieCount: null },
    ], storeId);

    expect(body.menuItemsCreated).toBe(3);

    const [burger, fries, soda] = await Promise.all([
      fetchMenuItemByName(request, burgerName),
      fetchMenuItemByName(request, friesName),
      fetchMenuItemByName(request, sodaName),
    ]);

    expect(burger).not.toBeNull();
    expect(fries).not.toBeNull();
    expect(soda).not.toBeNull();

    seededMenuItemIds.push(burger!.id, fries!.id, soda!.id);

    expect(burger!.calorieCount, 'Burger should have 750 calories').toBe(750);
    expect(fries!.calorieCount,  'Fries should have 320 calories').toBe(320);
    expect(soda!.calorieCount,   'Soda should have null calories').toBeNull();
  });

  test('calorieCount of 0 is stored as 0 via the menu-import path', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    seededSessionIds.push(sessionId);

    const itemName = uniqueName('Plain Water Import');
    await approveViaMenuImport(request, sessionId, [
      { name: itemName, department: 'Drinks', price: 0, calorieCount: 0 },
    ], storeId);

    const saved = await fetchMenuItemByName(request, itemName);
    expect(saved, `Menu item "${itemName}" should exist in the database`).not.toBeNull();
    seededMenuItemIds.push(saved!.id);
    expect(saved!.calorieCount, 'calorieCount should be 0, not null').toBe(0);
  });
});



test.describe('Menu scan calorie persistence — API contract', () => {
  let seededSessionIds: string[] = [];
  let seededMenuItemIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    seededSessionIds = [];
    seededMenuItemIds = [];
    await loginCookieApi(request);
  });

  test.afterEach(async ({ request }) => {
    for (const sessionId of seededSessionIds) {
      await deleteMenuImportSession(request, sessionId, seededMenuItemIds);
    }
    seededSessionIds = [];
    seededMenuItemIds = [];
  });

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

  async function fetchMenuItemById(
    request: APIRequestContext,
    id: string,
  ): Promise<{ id: string; calorieCount: number | null } | null> {
    const res = await request.get(`${BASE_URL}/api/menu-items`);
    expect(res.status()).toBe(200);
    const items = await res.json() as Array<{ id: string; calorieCount: number | null }>;
    return items.find(i => i.id === id) ?? null;
  }

  test('explicit calorieCount is persisted with the correct value', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    seededSessionIds.push(sessionId);

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Grilled Salmon'), department: 'Entrees', price: 24.99, calorieCount: 480 },
    ], storeId);
    seededMenuItemIds.push(...body.menuItemIds);

    expect(body.menuItemsCreated).toBe(1);
    const saved = await fetchMenuItemById(request, body.menuItemIds[0]);
    expect(saved).not.toBeNull();
    expect(saved!.calorieCount).toBe(480);
  });

  test('calorieCount null is stored as null — no phantom value invented', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    seededSessionIds.push(sessionId);

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Caesar Salad'), department: 'Salads', price: 13.50, calorieCount: null },
    ], storeId);
    seededMenuItemIds.push(...body.menuItemIds);

    const saved = await fetchMenuItemById(request, body.menuItemIds[0]);
    expect(saved).not.toBeNull();
    expect(saved!.calorieCount).toBeNull();
  });

  test('each item in a batch retains its own calorieCount independently', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    seededSessionIds.push(sessionId);

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Burger'),  department: 'Mains',  price: 14.99, calorieCount: 750 },
      { name: uniqueName('Fries'),   department: 'Sides',  price:  4.99, calorieCount: 320 },
      { name: uniqueName('Soda'),    department: 'Drinks', price:  2.99, calorieCount: null },
    ], storeId);
    seededMenuItemIds.push(...body.menuItemIds);

    expect(body.menuItemsCreated).toBe(3);
    const [item1, item2, item3] = await Promise.all(body.menuItemIds.map(id => fetchMenuItemById(request, id)));

    expect(item1!.calorieCount).toBe(750);
    expect(item2!.calorieCount).toBe(320);
    expect(item3!.calorieCount).toBeNull();
  });

  test('calorieCount of 0 is stored as 0, not coerced to null', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    seededSessionIds.push(sessionId);

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Plain Water'), department: 'Drinks', price: 0, calorieCount: 0 },
    ], storeId);
    seededMenuItemIds.push(...body.menuItemIds);

    const saved = await fetchMenuItemById(request, body.menuItemIds[0]);
    expect(saved).not.toBeNull();
    expect(saved!.calorieCount).toBe(0);
  });
});
