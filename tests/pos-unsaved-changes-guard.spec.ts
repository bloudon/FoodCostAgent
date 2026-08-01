/**
 * Playwright tests for the unsaved-changes POS guard on the Settings page.
 *
 * The guard fires when the user makes a change on the "POS & Sales" tab (tab
 * value="connections") and then tries to navigate to a different settings tab.
 * It shows a dialog with two choices:
 *
 *   • "Stay and Save"     → dialog closes, user stays on the POS tab
 *   • "Leave and Discard" → dialog closes, tab switches, dirty state resets
 *
 * All API calls are mocked via page.route so no live database is required.
 *
 * Prerequisites:
 *   The app must be running at http://localhost:5000 (npm run dev).
 *   Import { test, expect } from './test-helpers' to force app mode in Replit.
 */

import { test, expect, Page } from './test-helpers';

const BASE_URL     = 'http://localhost:5000';
const COMPANY_ID   = 'test-company-id-621';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Registers the minimal API routes the Settings page needs to render the
 * POS & Sales tab without hitting the real database.
 */
async function mockSettingsPage(page: Page): Promise<void> {
  // Auth — company_admin tier so all sections are accessible
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-621',
        email: 'admin@brians.pizza',
        companyId: COMPANY_ID,
        companyName: "Brian's Pizza",
        role: 'company_admin',
        firstName: 'Test',
        lastName: 'Admin',
        active: 1,
        subscriptionPlan: 'platform',
      }),
    }),
  );

  // Company data — posProvider starts as "none" so any change makes it dirty
  await page.route(`**/api/companies/${COMPANY_ID}`, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: COMPANY_ID,
          name: "Brian's Pizza",
          posProvider: 'none',
          primarySalesMethod: null,
          addressLine1: '123 Main St',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701',
          phone: '(555) 123-4567',
          contactEmail: 'admin@brians.pizza',
          logoImagePath: null,
          costingMethod: 'last_cost',
          subscriptionPlan: 'platform',
        }),
      });
    }
    return route.continue();
  });

  // POS config PATCH — always succeed (not expected to be called in these tests)
  await page.route(`**/api/companies/${COMPANY_ID}/pos-config`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  // POS providers list — include Square so the selector has a real option
  await page.route('**/api/pos/providers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          providerKey: 'square',
          displayName: 'Square',
          availability: 'available',
          capabilities: {
            oauth: true,
            salesRetrieval: true,
            locationMapping: true,
            itemMapping: true,
            backfill: true,
          },
        },
        {
          providerKey: 'toast',
          displayName: 'Toast',
          availability: 'coming_later',
          capabilities: {
            oauth: false,
            salesRetrieval: false,
            locationMapping: false,
            itemMapping: false,
            backfill: false,
          },
        },
      ]),
    }),
  );

  // POS setup status
  await page.route('**/api/pos/setup-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        providerSelected: false,
        primaryMethodSelected: false,
        connectorAvailable: false,
        connectionStatus: 'not_configured',
        locations: { total: 0, mapped: 0, ignored: 0, unresolved: 0 },
        items: { total: 0, mapped: 0, ignored: 0, unresolved: 0 },
        lastSuccessfulSyncAt: null,
        lastAttemptedSyncAt: null,
        latestSyncStatus: null,
        warningCount: 0,
      }),
    }),
  );

  // POS connections — empty (no existing connection)
  await page.route('**/api/pos/connections', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // Shell / layout stubs
  await page.route('**/api/stores', (route) => {
    if (!route.request().url().includes('/api/stores/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.continue();
  });
  await page.route('**/api/accessible-stores', (route) =>
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
  await page.route('**/api/quickbooks/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ connected: false }),
    }),
  );
  // Users management (users tab) — avoid 401 noise
  await page.route('**/api/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

/**
 * Navigate to Settings, open the POS & Sales tab, and change the provider
 * selector so the form becomes dirty.  Returns without waiting for any dialog.
 */
async function openPosTabAndMakeDirty(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/settings`);

  // Wait for the settings page title to appear
  await expect(page.getByTestId('text-settings-title')).toBeVisible({ timeout: 15000 });

  // Switch to the POS & Sales tab
  await page.getByTestId('tab-connections').click();

  // Wait for the provider selector to be visible
  const providerTrigger = page.getByTestId('select-pos-provider');
  await expect(providerTrigger).toBeVisible({ timeout: 10000 });

  // Open the selector and pick Square (changes the value from "none")
  await providerTrigger.click();
  await page.getByRole('option', { name: /Square/i }).click();

  // The save button appearing confirms the dirty state was set
  await expect(page.getByTestId('button-save-pos-config-inline')).toBeVisible({ timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Suite 1: Dialog appears when navigating away from the dirty POS tab
// ---------------------------------------------------------------------------

test.describe('POS unsaved-changes guard — dialog visibility', () => {
  test('shows unsaved-changes dialog when switching tabs with dirty POS state', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    // Click the Company tab — should trigger the guard
    await page.getByTestId('tab-company').click();

    const dialog = page.getByTestId('dialog-unsaved-tab-changes');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText('Unsaved Changes');
  });

  test('dialog contains both "Stay and Save" and "Leave and Discard" buttons', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    await page.getByTestId('tab-company').click();

    await expect(page.getByTestId('dialog-unsaved-tab-changes')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('button-stay-on-tab')).toBeVisible();
    await expect(page.getByTestId('button-leave-tab')).toBeVisible();
  });

  test('no dialog appears when switching tabs without making any changes', async ({ page }) => {
    await mockSettingsPage(page);
    await page.goto(`${BASE_URL}/settings`);

    await expect(page.getByTestId('text-settings-title')).toBeVisible({ timeout: 15000 });

    // Go to POS tab but do NOT change anything
    await page.getByTestId('tab-connections').click();
    await expect(page.getByTestId('select-pos-provider')).toBeVisible({ timeout: 10000 });

    // Switch to Company tab — guard must NOT fire
    await page.getByTestId('tab-company').click();

    await expect(page.getByTestId('dialog-unsaved-tab-changes')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Page-level navigation guard (sidebar links away from /settings)
// ---------------------------------------------------------------------------

test.describe('POS unsaved-changes guard — sidebar / page navigation', () => {
  /**
   * Simulate a sidebar link push by evaluating pushState directly in the
   * browser (the same mechanism wouter uses for <Link> clicks).
   */
  async function pushToPath(page: Page, path: string): Promise<void> {
    await page.evaluate((p) => {
      window.history.pushState({}, '', p);
    }, path);
  }

  test('shows page-leave dialog when sidebar pushState targets a non-settings path', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    // Simulate a sidebar link click that navigates to /dashboard
    await pushToPath(page, '/');

    const dialog = page.getByTestId('dialog-unsaved-nav-changes');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText('Unsaved Changes');
  });

  test('page-leave dialog has "Stay and Save" and "Leave and Discard" buttons', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    await pushToPath(page, '/analyze');

    await expect(page.getByTestId('dialog-unsaved-nav-changes')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('button-cancel-leave-settings')).toBeVisible();
    await expect(page.getByTestId('button-confirm-leave-settings')).toBeVisible();
  });

  test('no page-leave dialog when navigating within /settings', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    // A push that stays within /settings should NOT trigger the guard
    await pushToPath(page, '/settings?tab=company');

    await expect(page.getByTestId('dialog-unsaved-nav-changes')).not.toBeVisible();
  });

  test('"Leave and Discard" completes navigation and URL changes away from /settings', async ({ page }) => {
    await mockSettingsPage(page);
    // Stub the home route so the SPA doesn't make failing API calls after redirect
    await page.route('**/api/onboarding/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dismissed: true, milestones: [] }) }),
    );
    await page.route('**/api/inventory-sessions**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await openPosTabAndMakeDirty(page);

    await pushToPath(page, '/');

    await expect(page.getByTestId('dialog-unsaved-nav-changes')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('button-confirm-leave-settings').click();

    // Dialog must close
    await expect(page.getByTestId('dialog-unsaved-nav-changes')).not.toBeVisible({ timeout: 5000 });

    // URL must have left /settings (SPA pushState changed it to '/')
    await expect(page).not.toHaveURL(/\/settings/, { timeout: 5000 });
  });

  test('"Stay and Save" closes the dialog and keeps the URL on /settings', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    await pushToPath(page, '/');

    await expect(page.getByTestId('dialog-unsaved-nav-changes')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('button-cancel-leave-settings').click();

    // Dialog must close
    await expect(page.getByTestId('dialog-unsaved-nav-changes')).not.toBeVisible({ timeout: 5000 });

    // URL must still be /settings
    await expect(page).toHaveURL(/\/settings/, { timeout: 5000 });
  });

  test('"Stay and Save" preserves dirty state — POS save button still visible', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    await pushToPath(page, '/');

    await expect(page.getByTestId('dialog-unsaved-nav-changes')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('button-cancel-leave-settings').click();
    await expect(page.getByTestId('dialog-unsaved-nav-changes')).not.toBeVisible({ timeout: 5000 });

    // Unsaved changes must still be present
    await expect(page.getByTestId('button-save-pos-config-inline')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Suite 3: "Leave and Discard" path (tab guard)
// ---------------------------------------------------------------------------

test.describe('POS unsaved-changes guard — Leave and Discard', () => {
  test('clicking "Leave and Discard" switches to the target tab', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    // Trigger the guard by clicking Company tab
    await page.getByTestId('tab-company').click();
    await expect(page.getByTestId('dialog-unsaved-tab-changes')).toBeVisible({ timeout: 5000 });

    // Confirm leaving
    await page.getByTestId('button-leave-tab').click();

    // Dialog must close
    await expect(page.getByTestId('dialog-unsaved-tab-changes')).not.toBeVisible({ timeout: 5000 });

    // The Company tab content should now be active — check for the company name input
    await expect(page.getByTestId('input-company-name')).toBeVisible({ timeout: 5000 });
  });

  test('clicking "Leave and Discard" clears the dirty state (no save button visible)', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    await page.getByTestId('tab-company').click();
    await expect(page.getByTestId('dialog-unsaved-tab-changes')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('button-leave-tab').click();
    await expect(page.getByTestId('dialog-unsaved-tab-changes')).not.toBeVisible({ timeout: 5000 });

    // Go back to the POS tab — the save button must NOT be present (dirty reset)
    await page.getByTestId('tab-connections').click();
    await expect(page.getByTestId('select-pos-provider')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('button-save-pos-config-inline')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: "Stay and Save" path
// ---------------------------------------------------------------------------

test.describe('POS unsaved-changes guard — Stay and Save', () => {
  test('clicking "Stay and Save" closes the dialog without switching tabs', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    // Trigger the guard
    await page.getByTestId('tab-company').click();
    await expect(page.getByTestId('dialog-unsaved-tab-changes')).toBeVisible({ timeout: 5000 });

    // Choose to stay
    await page.getByTestId('button-stay-on-tab').click();

    // Dialog must close
    await expect(page.getByTestId('dialog-unsaved-tab-changes')).not.toBeVisible({ timeout: 5000 });
  });

  test('clicking "Stay and Save" keeps the user on the POS & Sales tab', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    // Trigger the guard
    await page.getByTestId('tab-company').click();
    await expect(page.getByTestId('dialog-unsaved-tab-changes')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('button-stay-on-tab').click();
    await expect(page.getByTestId('dialog-unsaved-tab-changes')).not.toBeVisible({ timeout: 5000 });

    // POS tab content must still be visible (provider select is present)
    await expect(page.getByTestId('select-pos-provider')).toBeVisible({ timeout: 5000 });

    // Company tab content must NOT be visible
    await expect(page.getByTestId('input-company-name')).not.toBeVisible();
  });

  test('"Stay and Save" preserves the dirty state — save button still visible', async ({ page }) => {
    await mockSettingsPage(page);
    await openPosTabAndMakeDirty(page);

    await page.getByTestId('tab-company').click();
    await expect(page.getByTestId('dialog-unsaved-tab-changes')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('button-stay-on-tab').click();
    await expect(page.getByTestId('dialog-unsaved-tab-changes')).not.toBeVisible({ timeout: 5000 });

    // The unsaved changes must still be present — save button remains
    await expect(page.getByTestId('button-save-pos-config-inline')).toBeVisible({ timeout: 5000 });
  });
});
