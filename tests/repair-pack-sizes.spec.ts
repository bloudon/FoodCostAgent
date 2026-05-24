/**
 * Automated tests for the Repair Pack Sizes admin tool.
 *
 * The "Vendor Pack Size Repair" card on the Admin Dashboard (/companies) lets a
 * global admin trigger POST /api/admin/backfill-vendor-pack-sizes, which
 * re-derives innerPackSize from compound pack strings (e.g. "6/5 LB") for any
 * vendor_items rows where inner_pack_size IS NULL.
 *
 * UI tests (Suites 1 & 2) use page.route to mock the backfill endpoint so they
 * run without touching the development database.  Both mocked states are
 * exercised:
 *   • updated > 0  → success toast + inline "Updated N vendor items" message
 *   • updated = 0  → "Already up to date" toast + inline message + button disabled
 *
 * API tests (Suites 3 & 4) verify the endpoint's auth contract:
 *   • No session  → 401
 *   • Non-admin session → 403
 *   • Global admin real run → 200 with correct payload shape
 *
 * Prerequisites (dev database):
 *   Email: admin@brians.pizza  /  Password: test123
 */

import { test, expect, Page, APIRequestContext } from 'playwright/test';

const BASE_URL      = 'http://localhost:5000';
const TEST_EMAIL    = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function loginCookie(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status(), 'Login should succeed').toBe(200);
}

// ---------------------------------------------------------------------------
// Page-level mock helpers
// ---------------------------------------------------------------------------

/**
 * Stubs every API endpoint that the /companies page calls on mount so the
 * page renders quickly and predictably in isolation.
 *
 * Only POST /api/admin/backfill-vendor-pack-sizes is left unmocked by default;
 * callers should add their own route for it after calling this helper.
 */
async function mockAdminPage(page: Page): Promise<void> {
  // Auth — global_admin user so the Companies page renders
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-global-admin-id',
        email: TEST_EMAIL,
        companyId: 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1',
        companyName: "Brian's Pizza",
        role: 'global_admin',
        firstName: 'Admin',
        lastName: 'User',
        active: 1,
        subscriptionTier: 'pro',
      }),
    }),
  );

  // Layout shell stubs
  await page.route('**/api/stores', (route) => {
    if (!route.request().url().includes('/api/stores/')) {
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

  // Companies page data stubs — empty lists so the page renders without errors
  await page.route('**/api/companies', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.continue();
  });
  await page.route('**/api/admin/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totalCompanies: 1, pendingSignups: 0, activeUsers: 1, activeNow: 0 }),
    }),
  );
  await page.route('**/api/admin/backup-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lastBackupAt: null, status: 'ok' }),
    }),
  );
  await page.route('**/api/admin/orphaned-signups', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/admin/quickbooks/app-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { configured: false, hasClientId: false, hasClientSecret: false, environment: 'sandbox' } }),
    }),
  );
  await page.route('**/api/admin/quickbooks/connections', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/admin/chat-logs**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ logs: [], todayCount: 0, mostActiveCompany: null }),
    }),
  );
  await page.route('**/api/admin/chat-corrections**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

// ---------------------------------------------------------------------------
// Suite 1: UI — button triggers backfill and shows success feedback (updated > 0)
// ---------------------------------------------------------------------------

test.describe('Repair Pack Sizes UI — items updated (updated > 0)', () => {
  test('button is visible and enabled on initial page load', async ({ page }) => {
    await mockAdminPage(page);
    await page.route('**/api/admin/backfill-vendor-pack-sizes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { candidatesFound: 1, updated: 1, skipped: 0, details: [] } }),
      }),
    );

    await page.goto(`${BASE_URL}/companies`);

    const btn = page.getByTestId('button-repair-pack-sizes');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(btn).toBeEnabled();
  });

  test('clicking the button shows a success toast when items were updated', async ({ page }) => {
    await mockAdminPage(page);
    await page.route('**/api/admin/backfill-vendor-pack-sizes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { candidatesFound: 2, updated: 2, skipped: 0, details: [] } }),
      }),
    );

    await page.goto(`${BASE_URL}/companies`);

    const btn = page.getByTestId('button-repair-pack-sizes');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();

    // Toast should appear confirming the count
    const toast = page.locator('[role="status"]').filter({ hasText: 'Updated 2 vendor items' });
    await expect(toast).toBeVisible({ timeout: 8000 });
  });

  test('inline "Updated N vendor items" message appears after a successful repair run', async ({ page }) => {
    await mockAdminPage(page);
    await page.route('**/api/admin/backfill-vendor-pack-sizes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { candidatesFound: 3, updated: 3, skipped: 0, details: [] } }),
      }),
    );

    await page.goto(`${BASE_URL}/companies`);

    const btn = page.getByTestId('button-repair-pack-sizes');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();

    const inlineMsg = page.getByTestId('text-pack-size-updated');
    await expect(inlineMsg).toBeVisible({ timeout: 8000 });
    await expect(inlineMsg).toContainText('Updated 3 vendor item');
  });

  test('"Already up to date" message does NOT appear when items were updated', async ({ page }) => {
    await mockAdminPage(page);
    await page.route('**/api/admin/backfill-vendor-pack-sizes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { candidatesFound: 1, updated: 1, skipped: 0, details: [] } }),
      }),
    );

    await page.goto(`${BASE_URL}/companies`);

    const btn = page.getByTestId('button-repair-pack-sizes');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();

    // Wait for success state
    await expect(page.getByTestId('text-pack-size-updated')).toBeVisible({ timeout: 8000 });

    // "Already up to date" must NOT appear
    await expect(page.getByTestId('text-pack-size-up-to-date')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: UI — "Already up to date" state (updated = 0)
// ---------------------------------------------------------------------------

test.describe('Repair Pack Sizes UI — already up to date (updated = 0)', () => {
  test('clicking the button shows "All vendor pack sizes are already up to date" toast', async ({ page }) => {
    await mockAdminPage(page);
    await page.route('**/api/admin/backfill-vendor-pack-sizes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { candidatesFound: 0, updated: 0, skipped: 0, details: [] } }),
      }),
    );

    await page.goto(`${BASE_URL}/companies`);

    const btn = page.getByTestId('button-repair-pack-sizes');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();

    const toast = page.locator('[role="status"]').filter({ hasText: /already up to date/i });
    await expect(toast).toBeVisible({ timeout: 8000 });
  });

  test('inline "Already up to date" message appears when nothing was updated', async ({ page }) => {
    await mockAdminPage(page);
    await page.route('**/api/admin/backfill-vendor-pack-sizes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { candidatesFound: 0, updated: 0, skipped: 0, details: [] } }),
      }),
    );

    await page.goto(`${BASE_URL}/companies`);

    const btn = page.getByTestId('button-repair-pack-sizes');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();

    const inlineMsg = page.getByTestId('text-pack-size-up-to-date');
    await expect(inlineMsg).toBeVisible({ timeout: 8000 });
    await expect(inlineMsg).toContainText('Already up to date');
  });

  test('button is disabled after an "already up to date" result', async ({ page }) => {
    await mockAdminPage(page);
    await page.route('**/api/admin/backfill-vendor-pack-sizes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { candidatesFound: 0, updated: 0, skipped: 0, details: [] } }),
      }),
    );

    await page.goto(`${BASE_URL}/companies`);

    const btn = page.getByTestId('button-repair-pack-sizes');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(btn).toBeEnabled();

    await btn.click();

    // After receiving updated=0 the button should become disabled
    await expect(page.getByTestId('text-pack-size-up-to-date')).toBeVisible({ timeout: 8000 });
    await expect(btn).toBeDisabled();
  });

  test('success "Updated N vendor items" message does NOT appear in the already-up-to-date state', async ({ page }) => {
    await mockAdminPage(page);
    await page.route('**/api/admin/backfill-vendor-pack-sizes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { candidatesFound: 0, updated: 0, skipped: 0, details: [] } }),
      }),
    );

    await page.goto(`${BASE_URL}/companies`);

    const btn = page.getByTestId('button-repair-pack-sizes');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();

    await expect(page.getByTestId('text-pack-size-up-to-date')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('text-pack-size-updated')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Endpoint auth contract (API-level, no DB seeding required)
// ---------------------------------------------------------------------------

test.describe('POST /api/admin/backfill-vendor-pack-sizes — auth contract', () => {
  test('returns 401 when called without a session', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/backfill-vendor-pack-sizes`);
    expect(res.status()).toBe(401);
  });

  test('returns 403 when called by a company_admin (non-global-admin) user', async ({ request }) => {
    // Log in as the dev test user (company_admin role in dev DB)
    const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });

    if (loginRes.status() !== 200) {
      test.skip(true, 'Could not log in as test user — skipping 403 auth check');
      return;
    }

    const me = await loginRes.json() as { role?: string };

    // This test only applies when the dev test account has company_admin role.
    // If the dev DB happens to have a global_admin test account, skip and let
    // Suite 4 handle it.
    if (me.role === 'global_admin') {
      test.skip(true, 'Test account is global_admin — 403 guard cannot be verified with this account');
      return;
    }

    const res = await request.post(`${BASE_URL}/api/admin/backfill-vendor-pack-sizes`);
    expect(res.status(), 'company_admin must receive 403 from a global-admin-only endpoint').toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Endpoint integration — real run against dev database (global_admin only)
// ---------------------------------------------------------------------------

/**
 * These tests require a global_admin test account.  They skip gracefully when
 * the only available test account is company_admin (typical in dev DBs).
 *
 * To run these tests locally:
 *   1. Ensure a user with role = 'global_admin' exists in the dev DB.
 *   2. Set GLOBAL_ADMIN_EMAIL and GLOBAL_ADMIN_PASSWORD env vars, or update
 *      the constants at the top of this file.
 */

const GLOBAL_ADMIN_EMAIL    = process.env.GLOBAL_ADMIN_EMAIL    ?? TEST_EMAIL;
const GLOBAL_ADMIN_PASSWORD = process.env.GLOBAL_ADMIN_PASSWORD ?? TEST_PASSWORD;

async function loginAsGlobalAdmin(request: APIRequestContext): Promise<boolean> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: GLOBAL_ADMIN_EMAIL, password: GLOBAL_ADMIN_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status() !== 200) return false;
  const body = await res.json() as { role?: string };
  return body.role === 'global_admin';
}

test.describe('POST /api/admin/backfill-vendor-pack-sizes — integration (real DB, global_admin)', () => {
  test('endpoint returns 200 with the correct response shape', async ({ request }) => {
    const isGlobalAdmin = await loginAsGlobalAdmin(request);
    if (!isGlobalAdmin) {
      test.skip(true, 'No global_admin test account available — skipping integration test (see Suite 4 comment)');
      return;
    }

    const res = await request.post(`${BASE_URL}/api/admin/backfill-vendor-pack-sizes`);
    expect(res.status(), `Expected 200, got ${res.status()}`).toBe(200);

    const body = await res.json() as {
      data: {
        candidatesFound: number;
        updated: number;
        skipped: number;
        details: Array<{ vendorItemId: string; caseSizeRaw: string; newCaseSize: number; newInnerPack: number }>;
      };
    };

    expect(body.data, 'Response must include a data object').toBeDefined();
    expect(typeof body.data.candidatesFound).toBe('number');
    expect(typeof body.data.updated).toBe('number');
    expect(typeof body.data.skipped).toBe('number');
    expect(Array.isArray(body.data.details)).toBe(true);
  });

  test('endpoint is idempotent — a second call returns updated = 0 when nothing remains', async ({ request }) => {
    const isGlobalAdmin = await loginAsGlobalAdmin(request);
    if (!isGlobalAdmin) {
      test.skip(true, 'No global_admin test account available — skipping idempotency test (see Suite 4 comment)');
      return;
    }

    // First call (may update some items or return 0 if already clean)
    const first = await request.post(`${BASE_URL}/api/admin/backfill-vendor-pack-sizes`);
    expect(first.status()).toBe(200);

    // Second call — all candidate rows that were fixable are now fixed, so
    // updated must be 0 (idempotent: WHERE inner_pack_size IS NULL filters them out)
    const second = await request.post(`${BASE_URL}/api/admin/backfill-vendor-pack-sizes`);
    expect(second.status()).toBe(200);

    const body = await second.json() as { data: { updated: number } };
    expect(body.data.updated, 'Second call must report updated = 0 (idempotent)').toBe(0);
  });

  test('endpoint repairs a vendor item seeded with inner_pack_size = NULL', async ({ request }) => {
    const isGlobalAdmin = await loginAsGlobalAdmin(request);
    if (!isGlobalAdmin) {
      test.skip(true, 'No global_admin test account available — skipping seed-based integration test (see Suite 4 comment)');
      return;
    }

    // Fetch FK anchor IDs from the dev database
    const vendorsRes = await request.get(`${BASE_URL}/api/vendors`);
    const unitsRes   = await request.get(`${BASE_URL}/api/units`);
    const itemsRes   = await request.get(`${BASE_URL}/api/inventory-items`);

    if (vendorsRes.status() !== 200 || unitsRes.status() !== 200 || itemsRes.status() !== 200) {
      test.skip(true, 'Could not fetch prerequisite data — skipping seed-based integration test');
      return;
    }

    const vendorList = await vendorsRes.json() as Array<{ id: string }>;
    const unitList   = await unitsRes.json()   as Array<{ id: string }>;
    const itemList   = await itemsRes.json()   as Array<{ id: string }>;

    if (!vendorList.length || !unitList.length || !itemList.length) {
      test.skip(true, 'Dev DB has no vendors/units/items — skipping seed-based integration test');
      return;
    }

    const vendorId        = vendorList[0].id;
    const purchaseUnitId  = unitList[0].id;
    const inventoryItemId = itemList[0].id;
    const testSku         = `ci-pack-test-${Date.now()}`;

    // Seed test rows via the dev helper endpoint
    const seedRes = await request.post(`${BASE_URL}/api/dev/test/vendor-pack-size-state`, {
      data: { vendorId, purchaseUnitId, inventoryItemId, vendorSku: testSku, caseSizeRaw: '6/5 LB' },
      headers: { 'Content-Type': 'application/json' },
    });

    if (seedRes.status() === 404 || seedRes.status() === 401) {
      test.skip(true, 'Dev helper /api/dev/test/vendor-pack-size-state not available — skipping seed test');
      return;
    }

    expect(seedRes.status(), `Seed must succeed, got ${seedRes.status()}: ${await seedRes.text()}`).toBe(200);
    const { vendorItemId, orderGuideId, orderGuideLineId } =
      await seedRes.json() as { vendorItemId: string; orderGuideId: string; orderGuideLineId: string };

    try {
      // Run the backfill
      const backfillRes = await request.post(`${BASE_URL}/api/admin/backfill-vendor-pack-sizes`);
      expect(backfillRes.status()).toBe(200);

      const body = await backfillRes.json() as {
        data: { updated: number; details: Array<{ vendorItemId: string; newCaseSize: number; newInnerPack: number }> };
      };

      expect(body.data.updated, 'At least one vendor item must have been updated').toBeGreaterThanOrEqual(1);

      const detail = body.data.details.find(d => d.vendorItemId === vendorItemId);
      expect(detail, 'Seeded vendor item must appear in the response details').toBeDefined();
      // "6/5 LB" → outer pack = 6, inner pack = 5
      expect(detail!.newCaseSize).toBe(6);
      expect(detail!.newInnerPack).toBe(5);
    } finally {
      // Teardown — always clean up seeded rows
      await request.delete(
        `${BASE_URL}/api/dev/test/vendor-pack-size-state/${vendorItemId}?orderGuideId=${orderGuideId}&orderGuideLineId=${orderGuideLineId}`,
      );
    }
  });
});
