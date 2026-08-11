/**
 * Playwright tests for the Pending Approval panel on the admin dashboard (/companies).
 *
 * Verifies the full flow introduced by Task #1044:
 *   1. A user with no companyId appears in the Pending Approval card.
 *   2. The admin opens the assign dialog and picks a company + role.
 *   3. After submitting, the assign endpoint is called and the pending-users
 *      list refreshes to empty (no card shown).
 *
 * All API calls are mocked — no live database is required beyond the Vite
 * dev server. Import `test` and `expect` from `./test-helpers` to force
 * app mode in the Replit preview environment.
 */

import { test, expect, Page } from './test-helpers';

const BASE_URL = 'http://localhost:5000';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const PENDING_USER = {
  id: 'pending-user-001',
  email: 'newuser@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  role: 'store_user',
  active: 1,
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  sso_provider: 'google',
  last_login_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  matchingInvitation: null,
};

const MOCK_COMPANIES = [
  {
    id: 'co-alpha',
    name: 'Alpha Bistro',
    legalName: 'Alpha Bistro LLC',
    contactEmail: 'admin@alpha.com',
    country: 'US',
    timezone: 'America/New_York',
    posProvider: null,
    primarySalesMethod: null,
    subscriptionPlan: 'platform',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    lastActivityAt: null,
  },
];

const MOCK_STATS = {
  totalCompanies: 1,
  pendingSignups: 0,
  activeUsers: 3,
  activeSessions: 2,
  mobileUsers: 1,
};

const MOCK_BACKUP_STATUS = {
  status: 'success',
  lastRun: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  lastLine: 'Backup completed successfully',
};

const MOCK_QB_APP_STATUS = {
  data: {
    configured: false,
    hasClientId: false,
    hasClientSecret: false,
    environment: 'sandbox',
  },
};

const MOCK_CHAT_LOGS = {
  logs: [],
  todayCount: 0,
  mostActiveCompany: null,
  topTopics: [],
};

// ---------------------------------------------------------------------------
// Setup helper: mock all routes needed by the /companies admin page
// ---------------------------------------------------------------------------

async function mockAdminDashboard(
  page: Page,
  pendingUsers: typeof PENDING_USER[] = [PENDING_USER],
): Promise<void> {
  // Auth — global_admin (no companyId needed for global admins)
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'admin-user-001',
        email: 'superadmin@system.local',
        companyId: null,
        companyName: null,
        role: 'global_admin',
        firstName: 'Super',
        lastName: 'Admin',
        active: 1,
        subscriptionPlan: 'platform',
      }),
    }),
  );

  // Company list (GET only — POST continues for create)
  await page.route('**/api/companies', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_COMPANIES),
      });
    } else {
      await route.continue();
    }
  });

  // Pending users — returns the supplied list
  await page.route('**/api/admin/pending-users', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pendingUsers }),
      });
    } else {
      await route.continue();
    }
  });

  // Admin stats
  await page.route('**/api/admin/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_STATS),
    }),
  );

  // Backup status
  await page.route('**/api/admin/backup-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_BACKUP_STATUS),
    }),
  );

  // Orphaned signups (none)
  await page.route('**/api/admin/orphaned-signups', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  // QuickBooks app status
  await page.route('**/api/admin/quickbooks/app-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_QB_APP_STATUS),
    }),
  );

  // QuickBooks connections (none)
  await page.route('**/api/admin/quickbooks/connections', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  // Chat logs (always-on preview query and full query)
  await page.route('**/api/admin/chat-logs**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CHAT_LOGS),
    }),
  );

  // Chat corrections
  await page.route('**/api/admin/chat-corrections**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  // Onboarding milestones
  await page.route('**/api/onboarding/milestones', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dismissed: true, milestones: [] }),
    }),
  );

  // Stores for company (used by the assign dialog)
  await page.route(`**/api/companies/${MOCK_COMPANIES[0].id}/stores`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'store-101', name: 'Alpha Main St', companyId: 'co-alpha', status: 'active' },
        { id: 'store-102', name: 'Alpha Downtown', companyId: 'co-alpha', status: 'active' },
      ]),
    }),
  );

  // SSO provider
  await page.route('**/api/sso/provider', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'google' }),
    }),
  );
}

async function gotoAdminDashboard(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/companies`);
  // Wait for the page title to confirm the page rendered
  await expect(page.getByTestId('text-page-title')).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Suite 1: Pending Approval card visibility
// ---------------------------------------------------------------------------

test.describe('admin dashboard — Pending Approval panel', () => {
  test('shows the Pending Approval card when a user has no companyId', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    const card = page.getByTestId('card-pending-approval');
    await expect(card).toBeVisible({ timeout: 10_000 });
  });

  test('badge shows the correct pending user count', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    await expect(page.getByTestId('badge-pending-count')).toHaveText('1');
  });

  test('pending user row displays name and email', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    const row = page.getByTestId(`row-pending-user-${PENDING_USER.id}`);
    await expect(row).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId(`text-pending-name-${PENDING_USER.id}`)).toContainText('Jane Doe');
    await expect(page.getByTestId(`text-pending-email-${PENDING_USER.id}`)).toContainText('newuser@example.com');
  });

  test('does not show the card when there are no pending users', async ({ page }) => {
    await mockAdminDashboard(page, []);
    await gotoAdminDashboard(page);

    // Give the page time to settle — the card must not appear
    await page.waitForTimeout(500);
    await expect(page.getByTestId('card-pending-approval')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Assign dialog — open and submit
// ---------------------------------------------------------------------------

test.describe('admin dashboard — assign pending user', () => {
  test('clicking Assign opens the dialog', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    await page.getByTestId(`button-assign-pending-${PENDING_USER.id}`).click();

    // The dialog confirm button must appear
    await expect(page.getByTestId('button-confirm-assign')).toBeVisible({ timeout: 5_000 });
  });

  test('assign dialog with company_admin role: submit enabled without store selection', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    await page.getByTestId(`button-assign-pending-${PENDING_USER.id}`).click();
    await expect(page.getByTestId('button-confirm-assign')).toBeVisible({ timeout: 5_000 });

    // Pick a company first (required for canSubmit)
    const companyTrigger = page.getByTestId('select-assign-company');
    await companyTrigger.click();
    await page.getByRole('option', { name: 'Alpha Bistro' }).click();

    // Switch role to company_admin — no stores required
    const roleTrigger = page.getByTestId('select-assign-role');
    await roleTrigger.click();
    await page.getByRole('option', { name: 'Company Admin' }).click();

    // Confirm button must now be enabled (no store required for company_admin)
    await expect(page.getByTestId('button-confirm-assign')).toBeEnabled();
  });

  test('full assign flow: picks company + company_admin role and submits successfully', async ({ page }) => {
    // Track what the assign POST receives
    let assignBody: Record<string, unknown> | null = null;

    await mockAdminDashboard(page);

    // Override the assign endpoint to capture the request
    await page.route(`**/api/admin/pending-users/${PENDING_USER.id}/assign`, async (route) => {
      if (route.request().method() === 'POST') {
        assignBody = await route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              ...PENDING_USER,
              companyId: 'co-alpha',
              role: 'company_admin',
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // After successful assign, the pending-users endpoint returns empty
    let pendingCallCount = 0;
    await page.route('**/api/admin/pending-users', async (route) => {
      if (route.request().method() === 'GET') {
        pendingCallCount += 1;
        const users = pendingCallCount === 1 ? [PENDING_USER] : [];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ pendingUsers: users }),
        });
      } else {
        await route.continue();
      }
    });

    await gotoAdminDashboard(page);

    // Open the assign dialog
    await page.getByTestId(`button-assign-pending-${PENDING_USER.id}`).click();
    await expect(page.getByTestId('button-confirm-assign')).toBeVisible({ timeout: 5_000 });

    // Pick a company
    const companyTrigger = page.getByTestId('select-assign-company');
    await companyTrigger.click();
    await page.getByRole('option', { name: 'Alpha Bistro' }).click();

    // Switch to company_admin (no stores required)
    const roleTrigger = page.getByTestId('select-assign-role');
    await roleTrigger.click();
    await page.getByRole('option', { name: 'Company Admin' }).click();

    // Submit
    await page.getByTestId('button-confirm-assign').click();

    // Verify the POST was sent with the correct companyId and role
    await page.waitForTimeout(500);
    expect(assignBody).not.toBeNull();
    expect(assignBody!.companyId).toBe('co-alpha');
    expect(assignBody!.role).toBe('company_admin');

    // After assignment the pending-users query is invalidated and re-fetched.
    // The card must disappear because the list is now empty.
    await expect(page.getByTestId('card-pending-approval')).not.toBeVisible({ timeout: 8_000 });
  });

  test('assign with store_user role requires store selection before submit is enabled', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    await page.getByTestId(`button-assign-pending-${PENDING_USER.id}`).click();
    await expect(page.getByTestId('button-confirm-assign')).toBeVisible({ timeout: 5_000 });

    // Pick a company (which fetches stores)
    const companyTrigger = page.getByTestId('select-assign-company');
    await companyTrigger.click();
    await page.getByRole('option', { name: 'Alpha Bistro' }).click();

    // Role default (store_user) needs at least one store — button should be disabled
    await expect(page.getByTestId('button-confirm-assign')).toBeDisabled();

    // Select one store
    await expect(page.getByTestId('checkbox-assign-store-store-101')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('checkbox-assign-store-store-101').click();

    // Now the button should be enabled
    await expect(page.getByTestId('button-confirm-assign')).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: UI behaviour when server returns 409 (user already has a company)
//
// The server-side 409 guard is tested against the real database in:
//   artifacts/api-server/src/routes/pendingUserAssign.test.ts
//
// These UI tests verify that the React layer handles a 409 response correctly —
// the dialog stays open and a destructive toast is shown.
// ---------------------------------------------------------------------------

test.describe('admin dashboard — assign 409 guard (user already has a company)', () => {
  /**
   * When the server returns 409 the dialog must stay open and an error toast
   * must appear so the admin knows the assignment was rejected.
   */
  test('shows error toast and keeps dialog open when server returns 409', async ({ page }) => {
    await mockAdminDashboard(page);

    // Intercept the assign POST and simulate the 409 the server returns when
    // the target user's companyId is already set.
    await page.route(
      `**/api/admin/pending-users/${PENDING_USER.id}/assign`,
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'User is already assigned to a company' }),
          });
        } else {
          await route.continue();
        }
      },
    );

    await gotoAdminDashboard(page);

    // Open the assign dialog
    await page.getByTestId(`button-assign-pending-${PENDING_USER.id}`).click();
    await expect(page.getByTestId('button-confirm-assign')).toBeVisible({ timeout: 5_000 });

    // Pick a company and role so the submit button is enabled
    const companyTrigger = page.getByTestId('select-assign-company');
    await companyTrigger.click();
    await page.getByRole('option', { name: 'Alpha Bistro' }).click();

    const roleTrigger = page.getByTestId('select-assign-role');
    await roleTrigger.click();
    await page.getByRole('option', { name: 'Company Admin' }).click();

    // Submit — the server will return 409
    await page.getByTestId('button-confirm-assign').click();

    // The dialog must remain open (the confirm button is still visible)
    await expect(page.getByTestId('button-confirm-assign')).toBeVisible({ timeout: 5_000 });

    // A destructive toast must appear with the error message
    const toast = page.locator('[data-testid="toast"], [role="status"], [data-radix-toast-viewport] li').first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText(/assign|fail|already/i);
  });

});
