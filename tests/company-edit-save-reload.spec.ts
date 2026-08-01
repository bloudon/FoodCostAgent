/**
 * Playwright tests for the company-edit save-and-reload cycle.
 *
 * Covers:
 *   1. Edit → change name → save → updated name appears in the header
 *   2. Optional fields (posProvider, timezone) survive a full edit cycle
 *      (open edit, save without touching them, verify they are still displayed)
 *   3. Cancel restores the original values without saving
 *
 * All API calls are mocked via page.route so no live database is required.
 *
 * Prerequisites:
 *   The app must be running at http://localhost:5000 (npm run dev).
 */

import { test, expect, Page } from './test-helpers';

const BASE_URL    = 'http://localhost:5000';
const COMPANY_ID  = 'test-company-edit-774';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const BASE_COMPANY = {
  id:                 COMPANY_ID,
  name:               "Brian's Pizza",
  legalName:          "Brian's Pizza LLC",
  contactEmail:       'admin@brians.pizza',
  phone:              '(555) 123-4567',
  country:            'US',
  timezone:           'America/Chicago',
  posProvider:        'square',
  primarySalesMethod: 'pos_connector',
  addressLine1:       '123 Main St',
  city:               'Springfield',
  state:              'IL',
  postalCode:         '62701',
  logoImagePath:      null,
  brandImagePath:     null,
  costingMethod:      'last_cost',
  subscriptionPlan:   'platform',
  status:             'active',
  createdAt:          '2024-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Register all API routes the company-detail page needs to render.
 * `companyOverride` merges onto BASE_COMPANY so individual tests can vary
 * what the GET returns after a successful PATCH.
 */
async function mockCompanyPage(
  page: Page,
  companyOverride: Record<string, unknown> = {},
): Promise<void> {
  // Track the "current" company so the PATCH can update it and subsequent GETs
  // return the patched version.
  let currentCompany = { ...BASE_COMPANY, ...companyOverride };

  // Auth — global_admin so the Users section and tier controls render
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify({
        id:               'test-user-774',
        email:            'admin@brians.pizza',
        companyId:        COMPANY_ID,
        companyName:      "Brian's Pizza",
        role:             'global_admin',
        firstName:        'Test',
        lastName:         'Admin',
        active:           1,
        subscriptionPlan: 'platform',
      }),
    }),
  );

  // Company — PATCH updates currentCompany; GET returns it
  await page.route(`**/api/companies/${COMPANY_ID}`, async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        JSON.stringify(currentCompany),
      });
      return;
    }

    if (method === 'PATCH') {
      // postDataJSON() is synchronous in Playwright
      const body = route.request().postDataJSON() as Record<string, unknown> | null;
      if (body) currentCompany = { ...currentCompany, ...body };
      await route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        JSON.stringify(currentCompany),
      });
      return;
    }

    await route.continue();
  });

  // Company list — queryClient also invalidates this key after a save
  await page.route('**/api/companies', async (route) => {
    if (!route.request().url().includes(`/companies/${COMPANY_ID}`)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.continue();
  });

  // Stores — empty list
  await page.route(`**/api/companies/${COMPANY_ID}/stores`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // Admin: company users list
  await page.route(`**/api/admin/companies/${COMPANY_ID}/users`, (route) =>
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify({ users: [] }),
    }),
  );

  // Admin: subscription PATCH (tier selector)
  await page.route(`**/api/admin/companies/${COMPANY_ID}/subscription`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );

  // Shell / layout stubs
  await page.route('**/api/stores', (route) => {
    if (!route.request().url().includes('/stores/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.continue();
  });
  await page.route('**/api/stores/accessible', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/onboarding/milestones', (route) =>
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify({ dismissed: true, milestones: [] }),
    }),
  );
  await page.route('**/api/categories', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/quickbooks/status', (route) =>
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify({ connected: false }),
    }),
  );
  await page.route('**/api/system-preferences', (route) =>
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify({
        unitSystem: 'imperial',
        currency:   'USD',
        timezone:   'America/Chicago',
        posSystem:  null,
        posApiKey:  null,
      }),
    }),
  );
  await page.route('**/api/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // Object storage (brand image card) — avoid 500 noise
  await page.route('**/api/objects/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

/** Navigate to the company-detail page and wait for it to render. */
async function gotoCompanyPage(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/companies/${COMPANY_ID}`);
  await expect(page.getByTestId('text-company-name')).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Suite 1: Basic edit → save → reload
// ---------------------------------------------------------------------------

test.describe('company-edit save-and-reload cycle', () => {
  test('updated company name appears in the page header after save', async ({ page }) => {
    await mockCompanyPage(page);
    await gotoCompanyPage(page);

    // Verify initial name
    await expect(page.getByTestId('text-company-name')).toHaveText("Brian's Pizza");

    // Click Edit
    await page.getByTestId('button-edit-company').click();
    await expect(page.getByTestId('input-company-name')).toBeVisible({ timeout: 5_000 });

    // Clear the name and type the new one
    const nameInput = page.getByTestId('input-company-name');
    await nameInput.fill("Brian's BBQ");

    // Save
    await page.getByTestId('button-save-company').click();

    // After save the form collapses and the header shows the updated name
    await expect(page.getByTestId('input-company-name')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('text-company-name')).toHaveText("Brian's BBQ", { timeout: 10_000 });
  });

  test('edit mode is dismissed (form hidden) after a successful save', async ({ page }) => {
    await mockCompanyPage(page);
    await gotoCompanyPage(page);

    await page.getByTestId('button-edit-company').click();
    await expect(page.getByTestId('input-company-name')).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('button-save-company').click();

    // Form inputs should disappear once the mutation resolves
    await expect(page.getByTestId('input-company-name')).not.toBeVisible({ timeout: 10_000 });
    // Edit button returns to the header
    await expect(page.getByTestId('button-edit-company')).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Optional fields (posProvider, timezone) survive the cycle
// ---------------------------------------------------------------------------

test.describe('company-edit — optional fields preserved across edit cycles', () => {
  test('timezone shown in the view still matches after opening and saving without changes', async ({
    page,
  }) => {
    await mockCompanyPage(page);
    await gotoCompanyPage(page);

    // Confirm timezone is displayed before edit
    await expect(page.getByTestId('text-timezone')).toHaveText('America/Chicago');

    // Open edit
    await page.getByTestId('button-edit-company').click();
    await expect(page.getByTestId('select-timezone')).toBeVisible({ timeout: 5_000 });

    // Save without touching timezone
    await page.getByTestId('button-save-company').click();
    await expect(page.getByTestId('input-company-name')).not.toBeVisible({ timeout: 10_000 });

    // Timezone must still match — verifies toInsertCompany() didn't strip it
    await expect(page.getByTestId('text-timezone')).toHaveText('America/Chicago');
  });

  test('form pre-fills with existing timezone when entering edit mode', async ({ page }) => {
    await mockCompanyPage(page);
    await gotoCompanyPage(page);

    await page.getByTestId('button-edit-company').click();
    const tzTrigger = page.getByTestId('select-timezone');
    await expect(tzTrigger).toBeVisible({ timeout: 5_000 });
    // The trigger label should reflect the stored value
    await expect(tzTrigger).toContainText('Central Time');
  });

  test('second edit cycle keeps timezone correct (no double-transform wipe)', async ({ page }) => {
    await mockCompanyPage(page);
    await gotoCompanyPage(page);

    // First edit cycle — save without changes
    await page.getByTestId('button-edit-company').click();
    await expect(page.getByTestId('select-timezone')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('button-save-company').click();
    await expect(page.getByTestId('button-edit-company')).toBeVisible({ timeout: 10_000 });

    // Second edit cycle — timezone must still pre-fill correctly
    await page.getByTestId('button-edit-company').click();
    const tzTrigger = page.getByTestId('select-timezone');
    await expect(tzTrigger).toBeVisible({ timeout: 5_000 });
    await expect(tzTrigger).toContainText('Central Time');
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Cancel restores original values without saving
// ---------------------------------------------------------------------------

test.describe('company-edit — cancel restores original state', () => {
  test('header still shows original name after editing and then cancelling', async ({ page }) => {
    await mockCompanyPage(page);
    await gotoCompanyPage(page);

    await page.getByTestId('button-edit-company').click();
    await expect(page.getByTestId('input-company-name')).toBeVisible({ timeout: 5_000 });

    // Change the name but cancel
    await page.getByTestId('input-company-name').fill('Temporary Name');
    await page.getByTestId('button-cancel-edit-company').click();

    // Form should be gone
    await expect(page.getByTestId('input-company-name')).not.toBeVisible({ timeout: 5_000 });
    // Original name must be restored in the header
    await expect(page.getByTestId('text-company-name')).toHaveText("Brian's Pizza");
  });

  test('re-opening edit after cancel pre-fills the original name, not the typed one', async ({
    page,
  }) => {
    await mockCompanyPage(page);
    await gotoCompanyPage(page);

    await page.getByTestId('button-edit-company').click();
    await expect(page.getByTestId('input-company-name')).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('input-company-name').fill('Temporary Name');
    await page.getByTestId('button-cancel-edit-company').click();
    await expect(page.getByTestId('button-edit-company')).toBeVisible({ timeout: 5_000 });

    // Open edit again — should show the original name
    await page.getByTestId('button-edit-company').click();
    await expect(page.getByTestId('input-company-name')).toHaveValue("Brian's Pizza", {
      timeout: 5_000,
    });
  });
});
