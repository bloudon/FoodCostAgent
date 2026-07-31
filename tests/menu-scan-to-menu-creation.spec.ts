/**
 * End-to-end test for the scan-to-menu creation flow (?mode=menu).
 *
 * Flow under test:
 *   1. Visit /menu-scan?mode=menu
 *   2. Upload a fixture image (mocked — no real storage call)
 *   3. AI scan returns two sections with items and prices (mocked)
 *   4. Skip the bar question
 *   5. Edit the "Appetizers" section label to "Starters"
 *   6. Click "Create Menu from N Items" → approve endpoint is called (mocked)
 *   7. On the CreateMenuScreen: verify edited label, name the menu, click "Create Menu"
 *   8. Verify:
 *      a. Navigation lands on /menus/:id
 *      b. The section POST was called with the user-edited label ("Starters"),
 *         not the raw scan value ("Appetizers")
 *      c. The entry POST payloads contain the scanned prices
 *
 * Prerequisites (dev database):
 *   Email: admin@brians.pizza  /  Password: test123
 *
 * Browser note:
 *   This test drives the full browser UI path and is skipped outside CI where
 *   system libraries for headless browsers may be unavailable (same policy as
 *   the calorie-persistence browser test).
 */

import { test, expect, Page } from 'playwright/test';

const BASE_URL      = 'http://localhost:5000';
const TEST_EMAIL    = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';
const TEST_COMPANY_ID = 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

// Stable fake IDs used throughout the mocked chain.
const MOCK_SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const MOCK_MENU_ID    = 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa';
const MOCK_ITEM_ID_1  = 'item-0001-0000-0000-0000-000000000000';
const MOCK_ITEM_ID_2  = 'item-0002-0000-0000-0000-000000000000';
const MOCK_SECTION_ID_1 = 'sect-0001-0000-0000-0000-000000000000';
const MOCK_SECTION_ID_2 = 'sect-0002-0000-0000-0000-000000000000';

// Raw scan values — "Appetizers" will be renamed by the user.
const RAW_SECTION_LABEL   = 'Appetizers';
const EDITED_SECTION_LABEL = 'Starters';
const SECOND_SECTION_LABEL = 'Mains';

const ITEM_1_NAME  = 'Spring Rolls';
const ITEM_1_PRICE = 9.99;
const ITEM_2_NAME  = 'Grilled Salmon';
const ITEM_2_PRICE = 24.50;

const MENU_NAME = 'Scan-to-Menu E2E Test';

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Scan-to-menu creation — UI path', () => {

  test('navigates to /menus/:id with edited section label and correct entry prices', async ({ page }) => {
    // Browser test — run in CI only (same policy as calorie-persistence test).
    test.skip(
      !process.env.CI,
      'Browser test — runs in CI (GitHub Actions) only; use local Vitest for unit-level coverage',
    );

    // ── 0. Setup ─────────────────────────────────────────────────────────────

    await enableAppMode(page);
    await loginBrowser(page);

    // Spy arrays: capture request bodies from the three creation calls.
    const sectionPostBodies: Array<{ name: string; displayOrder: number }> = [];
    const entryPostBodies: Array<{ menuItemId: string; menuSectionId: string; price: number | null }> = [];

    // ── 1. Register route mocks ──────────────────────────────────────────────

    // Object storage upload
    await page.route('**/api/objects/upload', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ objectPath: 'test/mock-menu-scan.jpg' }),
      });
    });

    // AI menu scan → two sections, two items, both with prices
    await page.route('**/api/onboarding/menu-scan', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: MOCK_SESSION_ID,
          items: [
            {
              name: ITEM_1_NAME,
              description: 'Crispy vegetable rolls',
              department: RAW_SECTION_LABEL,   // will be edited by the user
              category: 'Starter',
              size: '',
              price: ITEM_1_PRICE,
              calorieCount: null,
              variantGroupKey: '',
            },
            {
              name: ITEM_2_NAME,
              description: 'Fresh Atlantic salmon',
              department: SECOND_SECTION_LABEL,
              category: 'Seafood',
              size: '',
              price: ITEM_2_PRICE,
              calorieCount: null,
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

    // Has-bar (non-fatal, just prevent noise)
    await page.route('**/api/onboarding/has-bar', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    // Approve → return stable item IDs so CreateMenuScreen can build entries
    await page.route(`**/api/onboarding/menu-scan/${MOCK_SESSION_ID}/approve`, async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          menuItemsCreated: 2,
          menuItemIds: [MOCK_ITEM_ID_1, MOCK_ITEM_ID_2],
          recipesSeeded: 0,
          variantGroupsLinked: 0,
        }),
      });
    });

    // POST /api/menus → create the menu container
    await page.route('**/api/menus', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      const body = route.request().postDataJSON() as { name: string };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: MOCK_MENU_ID,
          name: body.name,
          status: 'draft',
          companyId: TEST_COMPANY_ID,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    // POST /api/menus/:id/sections → capture body, return stable section IDs
    let sectionCounter = 0;
    await page.route(`**/api/menus/${MOCK_MENU_ID}/sections`, async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      const body = route.request().postDataJSON() as { name: string; displayOrder: number };
      sectionPostBodies.push(body);
      const sectionId = sectionCounter === 0 ? MOCK_SECTION_ID_1 : MOCK_SECTION_ID_2;
      sectionCounter++;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: sectionId,
          menuId: MOCK_MENU_ID,
          name: body.name,
          displayOrder: body.displayOrder,
          companyId: TEST_COMPANY_ID,
        }),
      });
    });

    // POST /api/menus/:id/entries → capture body
    await page.route(`**/api/menus/${MOCK_MENU_ID}/entries`, async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      const body = route.request().postDataJSON() as {
        menuItemId: string;
        menuSectionId: string;
        displayOrder: number;
        price: number | null;
      };
      entryPostBodies.push(body);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: `entry-${entryPostBodies.length}`,
          menuId: MOCK_MENU_ID,
          menuItemId: body.menuItemId,
          menuSectionId: body.menuSectionId,
          price: body.price,
          active: 1,
        }),
      });
    });

    // GET /api/menus/:id → menu detail page after redirect
    await page.route(`**/api/menus/${MOCK_MENU_ID}`, async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: MOCK_MENU_ID,
          name: MENU_NAME,
          status: 'draft',
          companyId: TEST_COMPANY_ID,
          sections: [
            { id: MOCK_SECTION_ID_1, name: EDITED_SECTION_LABEL, displayOrder: 0 },
            { id: MOCK_SECTION_ID_2, name: SECOND_SECTION_LABEL, displayOrder: 1 },
          ],
          entries: [
            {
              id: 'entry-1',
              menuId: MOCK_MENU_ID,
              menuItemId: MOCK_ITEM_ID_1,
              menuSectionId: MOCK_SECTION_ID_1,
              price: ITEM_1_PRICE,
              active: 1,
              displayOrder: 0,
              item: { id: MOCK_ITEM_ID_1, name: ITEM_1_NAME },
            },
            {
              id: 'entry-2',
              menuId: MOCK_MENU_ID,
              menuItemId: MOCK_ITEM_ID_2,
              menuSectionId: MOCK_SECTION_ID_2,
              price: ITEM_2_PRICE,
              active: 1,
              displayOrder: 0,
              item: { id: MOCK_ITEM_ID_2, name: ITEM_2_NAME },
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    // Additional endpoints the menu-builder page may request — return empty/minimal
    await page.route(`**/api/menus/${MOCK_MENU_ID}/readiness`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ canTransitionToReady: false, blockers: [], warnings: [] }),
      });
    });
    await page.route(`**/api/menus/${MOCK_MENU_ID}/locations`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route(`**/api/menus/${MOCK_MENU_ID}/forecast`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) });
    });

    // ── 2. Navigate to the scan tool in menu-mode ────────────────────────────

    await page.goto(`${BASE_URL}/menu-scan?mode=menu`);
    await page.waitForTimeout(1000);

    // Upload card should be visible
    await expect(page.getByTestId('card-step-menu-scan')).toBeVisible({ timeout: 8000 });

    // ── 3. Trigger file upload ────────────────────────────────────────────────

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId('button-upload-menu').click(),
    ]);
    await fileChooser.setFiles({
      name: 'menu.jpg',
      mimeType: 'image/jpeg',
      // Minimal valid JFIF header — enough to pass as a file
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    });

    // ── 4. Skip the bar question ──────────────────────────────────────────────

    await expect(page.getByTestId('card-step-bar-question')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-skip-bar-question').click();

    // ── 5. Review step — edit the section label ───────────────────────────────

    await expect(page.getByTestId('card-step-menu-review')).toBeVisible({ timeout: 8000 });

    // The editable section header for the raw "Appetizers" section
    const sectionInput = page.getByTestId(`input-section-name-${RAW_SECTION_LABEL}`);
    await expect(sectionInput).toBeVisible({ timeout: 5000 });
    await expect(sectionInput).toHaveValue(RAW_SECTION_LABEL);

    // Clear and type the new label
    await sectionInput.click({ clickCount: 3 });
    await sectionInput.fill(EDITED_SECTION_LABEL);
    await expect(sectionInput).toHaveValue(EDITED_SECTION_LABEL);

    // Both items should be visible by name
    await expect(page.getByTestId('input-item-name-0')).toHaveValue(ITEM_1_NAME);
    await expect(page.getByTestId('input-item-name-1')).toHaveValue(ITEM_2_NAME);

    // ── 6. Click "Create Menu from 2 Items" ──────────────────────────────────

    const importBtn = page.getByTestId('button-import-items');
    await expect(importBtn).toBeVisible();
    await expect(importBtn).toContainText('Create Menu from');
    await importBtn.click();

    // ── 7. CreateMenuScreen — verify edited label, name the menu, create it ──

    await expect(page.getByTestId('text-create-menu-title')).toBeVisible({ timeout: 8000 });

    // The edited section label ("Starters") should appear in the section list —
    // not the raw scan value ("Appetizers")
    await expect(
      page.getByTestId(`create-section-row-${EDITED_SECTION_LABEL}`),
    ).toBeVisible({ timeout: 5000 });

    // The raw scan label must NOT appear as a section row
    await expect(
      page.getByTestId(`create-section-row-${RAW_SECTION_LABEL}`),
    ).not.toBeVisible();

    // Second section (unchanged) should still be present
    await expect(
      page.getByTestId(`create-section-row-${SECOND_SECTION_LABEL}`),
    ).toBeVisible();

    // Set the menu name
    const nameInput = page.getByTestId('input-menu-name-create');
    await nameInput.fill(MENU_NAME);

    // Click "Create Menu"
    await page.getByTestId('button-create-menu-from-scan').click();

    // ── 8. Assert: navigation lands on /menus/:id ─────────────────────────────

    await page.waitForURL(
      (url: URL) => url.pathname === `/menus/${MOCK_MENU_ID}`,
      { timeout: 12000 },
    );
    expect(page.url()).toContain(`/menus/${MOCK_MENU_ID}`);

    // ── 9. Assert: section POST bodies used the edited label ──────────────────

    // Two sections should have been posted
    expect(sectionPostBodies.length, 'Two section POST calls expected').toBe(2);

    // First section must use the USER-EDITED label, not the raw scan value
    const firstSection = sectionPostBodies[0];
    expect(
      firstSection.name,
      `First section POST name should be the edited label "${EDITED_SECTION_LABEL}", got "${firstSection.name}"`,
    ).toBe(EDITED_SECTION_LABEL);

    // Second section should use the unchanged scan label
    const secondSection = sectionPostBodies[1];
    expect(secondSection.name).toBe(SECOND_SECTION_LABEL);

    // displayOrder must be sequential
    expect(firstSection.displayOrder).toBe(0);
    expect(secondSection.displayOrder).toBe(1);

    // ── 10. Assert: entry POST bodies carry the scanned prices ─────────────────

    expect(entryPostBodies.length, 'Two entry POST calls expected').toBe(2);

    // Locate the entry for item 1 (Spring Rolls / ITEM_1_PRICE)
    const entry1 = entryPostBodies.find(e => e.menuItemId === MOCK_ITEM_ID_1);
    expect(entry1, 'Entry for item 1 should have been posted').toBeDefined();
    expect(
      entry1!.price,
      `Item 1 entry price should be ${ITEM_1_PRICE}`,
    ).toBeCloseTo(ITEM_1_PRICE, 2);
    expect(entry1!.menuSectionId).toBe(MOCK_SECTION_ID_1);

    // Locate the entry for item 2 (Grilled Salmon / ITEM_2_PRICE)
    const entry2 = entryPostBodies.find(e => e.menuItemId === MOCK_ITEM_ID_2);
    expect(entry2, 'Entry for item 2 should have been posted').toBeDefined();
    expect(
      entry2!.price,
      `Item 2 entry price should be ${ITEM_2_PRICE}`,
    ).toBeCloseTo(ITEM_2_PRICE, 2);
    expect(entry2!.menuSectionId).toBe(MOCK_SECTION_ID_2);
  });

});
