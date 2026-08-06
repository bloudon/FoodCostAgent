/**
 * Playwright tests for the admin dashboard (/companies) after the QB card
 * consolidation.
 *
 * Verifies that:
 *   1. The five stat cards (companies, pending signups, users/active-now,
 *      QB, backup) are all present.
 *   2. The single QB summary stat card (card-stat-qb) is visible and
 *      clicking it opens the QB details modal (dialog-qb-details).
 *   3. The QB details modal shows the "Company Connections" section.
 *   4. The company search input (input-company-search) filters the list.
 *
 * All API calls are mocked so no live database is required.
 * The app must be running at http://localhost:5000 (npm run dev).
 */

import { test, expect } from './test-helpers';

const BASE_URL = 'http://localhost:5000';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

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
  {
    id: 'co-beta',
    name: 'Beta Kitchen',
    legalName: 'Beta Kitchen Inc',
    contactEmail: 'admin@beta.com',
    country: 'US',
    timezone: 'America/Chicago',
    posProvider: null,
    primarySalesMethod: null,
    subscriptionPlan: 'platform',
    status: 'active',
    createdAt: '2024-02-01T00:00:00.000Z',
    lastActivityAt: null,
  },
];

const MOCK_STATS = {
  totalCompanies: 2,
  pendingSignups: 1,
  activeUsers: 5,
  activeSessions: 3,
  mobileUsers: 2,
};

const MOCK_BACKUP_STATUS = {
  status: 'success',
  lastRun: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  lastLine: 'Backup completed successfully',
};

const MOCK_QB_APP_STATUS = {
  data: {
    configured: true,
    hasClientId: true,
    hasClientSecret: true,
    environment: 'sandbox',
  },
};

const MOCK_QB_CONNECTIONS = [
  {
    companyId: 'co-alpha',
    companyName: 'Alpha Bistro',
    connected: true,
    realmId: 'realm-001',
    connectionLevel: 'company',
    lastSyncedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    companyId: 'co-beta',
    companyName: 'Beta Kitchen',
    connected: false,
    realmId: null,
    connectionLevel: 'company',
    lastSyncedAt: null,
    expiresAt: null,
  },
];

const MOCK_CHAT_LOGS = {
  logs: [],
  todayCount: 0,
  mostActiveCompany: null,
  topTopics: [],
};

// ---------------------------------------------------------------------------
// Setup helper: mock all API routes the /companies page needs
// ---------------------------------------------------------------------------

async function mockAdminDashboard(page: import('./test-helpers').Page): Promise<void> {
  // Auth — global_admin
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-admin-870',
        email: 'admin@system.local',
        companyId: 'co-alpha',
        companyName: 'Alpha Bistro',
        role: 'global_admin',
        firstName: 'Super',
        lastName: 'Admin',
        active: 1,
        subscriptionPlan: 'platform',
      }),
    }),
  );

  // Company list
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

  // Orphaned signups — empty so the pending-signups panel is hidden
  await page.route('**/api/admin/orphaned-signups', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  // QB app status
  await page.route('**/api/admin/quickbooks/app-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_QB_APP_STATUS),
    }),
  );

  // QB connections
  await page.route('**/api/admin/quickbooks/connections', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_QB_CONNECTIONS),
    }),
  );

  // Chat logs (preview + full)
  await page.route('**/api/admin/chat-logs**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CHAT_LOGS),
    }),
  );

  // Chat corrections
  await page.route('**/api/admin/chat-corrections', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  // Shell / layout stubs
  await page.route('**/api/stores/accessible', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/stores', (route) => {
    if (!route.request().url().includes('/stores/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.continue();
  });
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
  await page.route('**/api/system-preferences', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        unitSystem: 'imperial',
        currency: 'USD',
        timezone: 'America/New_York',
        posSystem: null,
        posApiKey: null,
      }),
    }),
  );
  await page.route('**/api/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/objects/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

/** Navigate to the admin dashboard and wait for the page title. */
async function gotoAdminDashboard(page: import('./test-helpers').Page): Promise<void> {
  await page.goto(`${BASE_URL}/companies`);
  await expect(page.getByTestId('text-page-title')).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Suite 1: Stat cards
// ---------------------------------------------------------------------------

test.describe('admin dashboard — stat cards render after QB consolidation', () => {
  test('all five stat cards are visible', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    // Companies
    await expect(page.getByTestId('card-stat-total-companies')).toBeVisible();

    // Pending signups
    await expect(page.getByTestId('card-stat-pending-signups')).toBeVisible();

    // Users / active-now (merged — no separate card-stat-active-sessions)
    await expect(page.getByTestId('card-stat-active-users')).toBeVisible();

    // QB summary (replaces the old card-qb-app-status + card-qb-connections pair)
    await expect(page.getByTestId('card-stat-qb')).toBeVisible();

    // Backup
    await expect(page.getByTestId('card-stat-backup-status')).toBeVisible();
  });

  test('QB stat card shows connected-company count from the connections list', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    // MOCK_QB_CONNECTIONS has 1 connected company → value should be "1"
    await expect(page.getByTestId('card-stat-qb-value')).toHaveText('1');
  });

  test('active-now indicator appears inside the users stat card (not a separate card)', async ({
    page,
  }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    const usersCard = page.getByTestId('card-stat-active-users');
    await expect(usersCard).toBeVisible();
    // The active-sessions sub-text is rendered inside the same card
    await expect(usersCard).toContainText('active now');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: QB details modal flow
// ---------------------------------------------------------------------------

test.describe('admin dashboard — QB details modal', () => {
  test('clicking the QB stat card opens the details modal', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    // Modal should not be visible initially
    await expect(page.getByTestId('dialog-qb-details')).not.toBeVisible();

    // Click the QB stat card (it has an onClick that sets qbDetailsOpen)
    await page.getByTestId('card-stat-qb').click();

    // Modal must appear
    await expect(page.getByTestId('dialog-qb-details')).toBeVisible({ timeout: 5_000 });
  });

  test('QB details modal shows the company connections section', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    await page.getByTestId('card-stat-qb').click();
    await expect(page.getByTestId('dialog-qb-details')).toBeVisible({ timeout: 5_000 });

    // The modal title should mention QuickBooks
    await expect(page.getByTestId('dialog-qb-details')).toContainText('QuickBooks');

    // The connections section heading is "Company Connections"
    await expect(page.getByTestId('dialog-qb-details')).toContainText('Company Connections');
  });

  test('QB details modal lists each company row', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    await page.getByTestId('card-stat-qb').click();
    await expect(page.getByTestId('dialog-qb-details')).toBeVisible({ timeout: 5_000 });

    // One row per QB connection entry
    await expect(page.getByTestId('row-qb-co-alpha')).toBeVisible();
    await expect(page.getByTestId('row-qb-co-beta')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Company search
// ---------------------------------------------------------------------------

test.describe('admin dashboard — company search filter', () => {
  test('search input is visible in the company list section', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    await expect(page.getByTestId('input-company-search')).toBeVisible();
  });

  test('typing in the search input filters company cards', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    // Both companies should be visible before filtering
    await expect(page.getByTestId('card-company-co-alpha')).toBeVisible();
    await expect(page.getByTestId('card-company-co-beta')).toBeVisible();

    // Type a search term that matches only Alpha Bistro
    await page.getByTestId('input-company-search').fill('Alpha');

    // Alpha Bistro stays visible; Beta Kitchen is hidden
    await expect(page.getByTestId('card-company-co-alpha')).toBeVisible();
    await expect(page.getByTestId('card-company-co-beta')).not.toBeVisible();
  });

  test('clearing the search restores all company cards', async ({ page }) => {
    await mockAdminDashboard(page);
    await gotoAdminDashboard(page);

    await page.getByTestId('input-company-search').fill('Alpha');
    await expect(page.getByTestId('card-company-co-beta')).not.toBeVisible();

    // The clear button appears when there is text
    await page.getByTestId('button-clear-company-search').click();

    // Both companies must be visible again
    await expect(page.getByTestId('card-company-co-alpha')).toBeVisible();
    await expect(page.getByTestId('card-company-co-beta')).toBeVisible();
  });
});
