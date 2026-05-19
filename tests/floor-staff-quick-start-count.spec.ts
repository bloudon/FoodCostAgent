/**
 * Automated tests for the floor-staff quick-start count flow.
 *
 * Covers four key paths:
 *   1. Floor-staff role: clicking "Start New Count" opens the modal.
 *   2. Floor-staff with multiple stores: store picker is shown in the modal.
 *   3. Floor-staff confirm: session is created and user is navigated to /count/:id/mobile.
 *   4. Admin role: clicking "Start New Count" bypasses the modal and navigates
 *      directly to /inventory-sessions.
 *
 * All API responses are mocked via page.route() so no real auth/DB state is needed.
 *
 * Component under test: client/src/pages/dashboard-mobile.tsx
 * Route: /dashboard/mobile
 */

import { test, expect, Page } from 'playwright/test';

const BASE_URL = 'http://localhost:5000';

const FAKE_SESSION_ID = 'test-session-abc123';

const STORES_MULTI = [
  { id: 'store-001', name: 'Main Street' },
  { id: 'store-002', name: 'Westside Location' },
];

const STORE_SINGLE = [{ id: 'store-001', name: 'Main Street' }];

function buildDashboardPayload(
  role: string,
  stores: { id: string; name: string }[],
): object {
  return {
    role,
    userName: 'Test User',
    businessName: "Brian's Pizza",
    locationName: null,
    stores,
    activeSessions: [],
    recentSessions: [],
    recentScans: [],
  };
}

async function mockDashboard(page: Page, role: string, stores: { id: string; name: string }[]): Promise<void> {
  await page.route('**/api/mobile/dashboard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildDashboardPayload(role, stores)),
    });
  });
}

async function mockSessionCreate(page: Page): Promise<void> {
  await page.route('**/api/mobile/sessions', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: FAKE_SESSION_ID,
          name: 'May 18, 2026',
          storeId: 'store-001',
          lineCount: 0,
        }),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mocks /api/auth/me so the React auth guard (ProtectedLayout) considers the
 * browser authenticated and does NOT redirect to /login.
 *
 * The floor-staff tests drive the dashboard-mobile page entirely via mocked
 * API responses — they do not perform a real login. Without this mock,
 * ProtectedLayout sees a 401 from /api/auth/me, sets user=null, and
 * immediately navigates to /login before the dashboard renders.
 *
 * Role is always company_admin here — the role that controls dashboard
 * *behaviour* (floor-staff modal vs. admin bypass) comes from the separate
 * /api/mobile/dashboard mock in mockDashboard().
 */
async function mockAuth(page: Page): Promise<void> {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-id',
        email: 'admin@brians.pizza',
        companyId: 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1',
        companyName: "Brian's Pizza",
        role: 'company_admin',
        firstName: 'Test',
        lastName: 'User',
        active: 1,
        subscriptionTier: 'pro',
      }),
    });
  });

  // Stub noisy layout-shell calls so they don't spray 401 errors into the
  // console and potentially affect test stability.
  await page.route('**/api/stores', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/onboarding/milestones', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dismissed: false, milestones: [] }),
    });
  });
}

async function navigateToDashboard(page: Page): Promise<void> {
  await mockAuth(page);
  await page.goto(`${BASE_URL}/dashboard/mobile`);
  await page.waitForSelector('[data-testid="button-start-count"]', { timeout: 8000 });
}

// =============================================================================
// 1. Floor-staff: modal opens on "Start New Count"
// =============================================================================
test.describe('Floor-staff quick-start count modal', () => {
  test('clicking Start New Count opens the modal for a floor-staff user', async ({ page }) => {
    await mockDashboard(page, 'user', STORES_MULTI);
    await navigateToDashboard(page);

    await expect(page.getByTestId('dialog-new-count')).not.toBeVisible();

    await page.getByTestId('button-start-count').click();

    await expect(page.getByTestId('dialog-new-count')).toBeVisible({ timeout: 3000 });
  });

  // ===========================================================================
  // 2. Multiple stores: store picker is shown
  // ===========================================================================
  test('store picker is visible when the floor-staff user has multiple stores', async ({ page }) => {
    await mockDashboard(page, 'user', STORES_MULTI);
    await navigateToDashboard(page);

    await page.getByTestId('button-start-count').click();

    await expect(page.getByTestId('dialog-new-count')).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('select-store')).toBeVisible();
  });

  // ===========================================================================
  // 3. Single store: store picker is hidden (auto-selected)
  // ===========================================================================
  test('store picker is hidden when the floor-staff user has only one store', async ({ page }) => {
    await mockDashboard(page, 'user', STORE_SINGLE);
    await navigateToDashboard(page);

    await page.getByTestId('button-start-count').click();

    await expect(page.getByTestId('dialog-new-count')).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('select-store')).not.toBeVisible();
  });

  // ===========================================================================
  // 4. Confirm: session created, navigate to /count/:id/mobile
  // ===========================================================================
  test('confirming the modal creates a session and navigates to /count/:id/mobile (single store)', async ({ page }) => {
    await mockDashboard(page, 'user', STORE_SINGLE);
    await mockSessionCreate(page);
    await navigateToDashboard(page);

    await page.getByTestId('button-start-count').click();
    await expect(page.getByTestId('dialog-new-count')).toBeVisible({ timeout: 3000 });

    await page.getByTestId('button-confirm-start-count').click();

    await page.waitForURL(
      (url) => url.pathname.includes(`/count/${FAKE_SESSION_ID}/mobile`),
      { timeout: 8000 },
    );
    expect(page.url()).toContain(`/count/${FAKE_SESSION_ID}/mobile`);
  });

  // ===========================================================================
  // 5. Confirm with store picker: select a store, create session, navigate
  // ===========================================================================
  test('confirming with a store selected creates a session and navigates to /count/:id/mobile (multi-store)', async ({ page }) => {
    await mockDashboard(page, 'user', STORES_MULTI);
    await mockSessionCreate(page);
    await navigateToDashboard(page);

    await page.getByTestId('button-start-count').click();
    await expect(page.getByTestId('dialog-new-count')).toBeVisible({ timeout: 3000 });

    // Confirm button should be disabled until a store is selected
    await expect(page.getByTestId('button-confirm-start-count')).toBeDisabled();

    // Open the store select and pick the first option
    await page.getByTestId('select-store').click();
    await page.getByTestId(`option-store-${STORES_MULTI[0].id}`).click();

    // Confirm button should now be enabled
    await expect(page.getByTestId('button-confirm-start-count')).not.toBeDisabled();

    await page.getByTestId('button-confirm-start-count').click();

    await page.waitForURL(
      (url) => url.pathname.includes(`/count/${FAKE_SESSION_ID}/mobile`),
      { timeout: 8000 },
    );
    expect(page.url()).toContain(`/count/${FAKE_SESSION_ID}/mobile`);
  });

  // ===========================================================================
  // 6. Cancel button closes the modal without navigating
  // ===========================================================================
  test('cancel button dismisses the modal without navigating away', async ({ page }) => {
    await mockDashboard(page, 'user', STORE_SINGLE);
    await navigateToDashboard(page);

    await page.getByTestId('button-start-count').click();
    await expect(page.getByTestId('dialog-new-count')).toBeVisible({ timeout: 3000 });

    await page.getByTestId('button-cancel-count').click();

    await expect(page.getByTestId('dialog-new-count')).not.toBeVisible({ timeout: 3000 });
    expect(page.url()).toContain('/dashboard/mobile');
  });

  // ===========================================================================
  // 7. No stores assigned: modal shows the "no locations" state
  // ===========================================================================
  test('modal shows no-locations message when floor-staff has no stores assigned', async ({ page }) => {
    await mockDashboard(page, 'user', []);
    await navigateToDashboard(page);

    await page.getByTestId('button-start-count').click();
    await expect(page.getByTestId('dialog-new-count')).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('dialog-no-stores')).toBeVisible();
    await expect(page.getByTestId('button-confirm-start-count')).not.toBeVisible();
  });
});

// =============================================================================
// 8. Admin role: modal is bypassed
// =============================================================================
test.describe('Admin and manager role bypasses the modal', () => {
  test('company_admin clicking Start New Count navigates directly to /inventory-sessions', async ({ page }) => {
    await mockDashboard(page, 'company_admin', STORE_SINGLE);
    await navigateToDashboard(page);

    await page.getByTestId('button-start-count').click();

    await page.waitForURL(
      (url) => url.pathname.includes('/inventory-sessions'),
      { timeout: 6000 },
    );
    expect(page.url()).toContain('/inventory-sessions');
    await expect(page.getByTestId('dialog-new-count')).not.toBeVisible();
  });

  test('store_manager clicking Start New Count navigates directly to /inventory-sessions', async ({ page }) => {
    await mockDashboard(page, 'store_manager', STORE_SINGLE);
    await navigateToDashboard(page);

    await page.getByTestId('button-start-count').click();

    await page.waitForURL(
      (url) => url.pathname.includes('/inventory-sessions'),
      { timeout: 6000 },
    );
    expect(page.url()).toContain('/inventory-sessions');
    await expect(page.getByTestId('dialog-new-count')).not.toBeVisible();
  });

  test('global_admin clicking Start New Count navigates directly to /inventory-sessions', async ({ page }) => {
    await mockDashboard(page, 'global_admin', STORE_SINGLE);
    await navigateToDashboard(page);

    await page.getByTestId('button-start-count').click();

    await page.waitForURL(
      (url) => url.pathname.includes('/inventory-sessions'),
      { timeout: 6000 },
    );
    expect(page.url()).toContain('/inventory-sessions');
    await expect(page.getByTestId('dialog-new-count')).not.toBeVisible();
  });
});
