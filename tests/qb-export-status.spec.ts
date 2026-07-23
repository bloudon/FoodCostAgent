/**
 * Automated tests for the QuickBooks export status display on the receiving-detail page.
 *
 * The QB export section in client/src/pages/receiving-detail.tsx renders when:
 *   isCompleted && hasFeature(subscriptionTier, "transfer_orders") && qbStatus?.connected
 *
 * Three UI states are exercised:
 *
 *   1. "Reconciled — Ready to Export" badge (data-testid="badge-pending-export")
 *      → purchaseOrder.status === "pending_qb_export"
 *
 *   2. "Exported to QB" success section (data-testid="section-qb-export-success",
 *      "text-qb-bill-id", "text-qb-export-timestamp")
 *      → purchaseOrder.status === "qb_exported"
 *      → syncLog.quickbooksBillId and syncLog.createdAt are set
 *
 *   3. "Export Failed" warning section (data-testid="section-export-failed",
 *      "badge-export-failed")
 *      → syncLog.syncStatus === "failed" or "retry_exhausted"
 *      → syncLog.errorMessage is present
 *
 * Page-level API mocking is used (page.route) so these tests run without a live
 * QB connection and without requiring specific database state.
 *
 * A second suite of API-level tests covers auth validation and request validation
 * for the three QB-related endpoints:
 *   GET  /api/purchase-orders/:id/reconciliation
 *   POST /api/purchase-orders/:id/reconcile
 *   POST /api/quickbooks/export-bills
 *
 * Prerequisites (dev database):
 *   Email: admin@brians.pizza  /  Password: test123
 *   CI vendor (ci-vendor-sysco-001) must exist — run `npx tsx scripts/ci-seed.ts`
 */

import { test, expect, Page, APIRequestContext } from './test-helpers';

const BASE_URL      = 'http://localhost:5000';
const TEST_EMAIL    = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';
const FAKE_UUID     = '00000000-0000-0000-0000-000000000000';
const MOCK_PO_ID    = 'ci-qb-test-po-0001';

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
// Dev seed helper (API-level tests only)
// ---------------------------------------------------------------------------

async function seedQbPoState(
  request: APIRequestContext,
  opts: {
    status: 'pending_qb_export' | 'qb_exported' | 'received';
    syncStatus?: 'success' | 'failed' | 'retry_exhausted' | 'pending';
    quickbooksBillId?: string;
    errorMessage?: string;
  },
): Promise<{ poId: string; syncLogId: string | null }> {
  const res = await request.post(`${BASE_URL}/api/dev/test/qb-po-state`, {
    data: opts,
    headers: { 'Content-Type': 'application/json' },
  });

  if (res.status() === 404 || res.status() === 401) {
    test.skip(true, 'Dev test helper not available — server may be in production mode');
    return { poId: '', syncLogId: null };
  }

  expect(
    res.status(),
    `Dev QB state seed should succeed, got ${res.status()}: ${await res.text()}`,
  ).toBe(200);

  const body = await res.json() as { poId: string; syncLogId: string | null };
  expect(body.poId, 'Seed must return a poId').toBeTruthy();
  return body;
}

// ---------------------------------------------------------------------------
// Page-level mock helpers (UI tests)
// ---------------------------------------------------------------------------

/** A minimal PO detail shape that the page accepts. */
function makeMockPO(status: string) {
  return {
    id: MOCK_PO_ID,
    vendorId: 'ci-vendor-sysco-001',
    vendorName: 'Sysco (CI)',
    status,
    createdAt: new Date().toISOString(),
    expectedDate: null,
    lines: [],
  };
}

/** A completed receipt for the mock PO. */
function makeMockReceipt() {
  return {
    receipt: {
      id: 'ci-receipt-0001',
      purchaseOrderId: MOCK_PO_ID,
      status: 'completed',
      storageLocationId: null,
      receivedAt: new Date().toISOString(),
      receiveByUnit: 0,
    },
    lines: [],
  };
}

/**
 * Sets up the routes needed for the receiving-detail page to render the QB
 * export section.  All data comes from inline mocks so no DB state is needed.
 *
 * @param page - Playwright page object
 * @param poStatus - "pending_qb_export" | "qb_exported"
 * @param syncLog  - optional sync log object (drives success/failed sections)
 */
async function mockReceivingPage(
  page: Page,
  poStatus: string,
  syncLog: Record<string, unknown> | null = null,
): Promise<void> {
  // Auth — Pro-tier user so hasFeature("transfer_orders") returns true
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-id',
        email: TEST_EMAIL,
        companyId: 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1',
        companyName: "Brian's Pizza",
        role: 'company_admin',
        firstName: 'Test',
        lastName: 'Admin',
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

  // QB connected → the section renders
  await page.route('**/api/quickbooks/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ connected: true }),
    }),
  );

  // Purchase order with the target status
  await page.route(`**/api/purchase-orders/${MOCK_PO_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeMockPO(poStatus)),
    }),
  );

  // Completed receipt → isCompleted becomes true
  await page.route(`**/api/receipts/draft/${MOCK_PO_ID}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeMockReceipt()),
    }),
  );

  // Reconciliation data — drives the success/failed section content
  await page.route(`**/api/purchase-orders/${MOCK_PO_ID}/reconciliation`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null, syncLog }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Suite 1: UI — "Reconciled — Ready to Export" badge (pending_qb_export)
// ---------------------------------------------------------------------------

test.describe('QB export UI — pending_qb_export state', () => {
  test('shows "Reconciled — Ready to Export" badge when PO is pending_qb_export', async ({ page }) => {
    await mockReceivingPage(page, 'pending_qb_export', null);
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    const badge = page.getByTestId('badge-pending-export');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText('Reconciled');

    // Success and failed sections must NOT appear
    await expect(page.getByTestId('section-qb-export-success')).not.toBeVisible();
    await expect(page.getByTestId('section-export-failed')).not.toBeVisible();
  });

  test('shows the Export Bill button when PO is pending_qb_export', async ({ page }) => {
    await mockReceivingPage(page, 'pending_qb_export', null);
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    const exportBtn = page.getByTestId('button-export-to-qb');
    await expect(exportBtn).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Suite 2: UI — "Exported to QB" success state (qb_exported)
// ---------------------------------------------------------------------------

test.describe('QB export UI — qb_exported success state', () => {
  const BILL_ID     = 'QB-BILL-TEST-12345';
  const EXPORTED_AT = new Date('2026-05-23T14:00:00.000Z');

  function makeSuccessLog() {
    return {
      id: 'ci-sync-log-0001',
      companyId: 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1',
      purchaseOrderId: MOCK_PO_ID,
      quickbooksBillId: BILL_ID,
      syncStatus: 'success',
      attemptCount: 1,
      errorMessage: null,
      errorCode: null,
      lastAttemptAt: EXPORTED_AT.toISOString(),
      succeededAt: EXPORTED_AT.toISOString(),
      createdAt: EXPORTED_AT.toISOString(),
    };
  }

  test('shows "Exported to QB" badge when PO status is qb_exported', async ({ page }) => {
    await mockReceivingPage(page, 'qb_exported', makeSuccessLog());
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    const badge = page.getByTestId('badge-qb-exported');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText('Exported');
  });

  test('shows success section (data-testid="section-qb-export-success") when qb_exported', async ({ page }) => {
    await mockReceivingPage(page, 'qb_exported', makeSuccessLog());
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    const successSection = page.getByTestId('section-qb-export-success');
    await expect(successSection).toBeVisible({ timeout: 10000 });
  });

  test('shows the QuickBooks Bill ID (data-testid="text-qb-bill-id")', async ({ page }) => {
    await mockReceivingPage(page, 'qb_exported', makeSuccessLog());
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    const billIdEl = page.getByTestId('text-qb-bill-id');
    await expect(billIdEl).toBeVisible({ timeout: 10000 });
    await expect(billIdEl).toContainText(BILL_ID);
  });

  test('shows the export timestamp (data-testid="text-qb-export-timestamp")', async ({ page }) => {
    await mockReceivingPage(page, 'qb_exported', makeSuccessLog());
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    const tsEl = page.getByTestId('text-qb-export-timestamp');
    await expect(tsEl).toBeVisible({ timeout: 10000 });
    // Timestamp is formatted as locale date+time — just verify it is non-empty
    const text = await tsEl.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('does NOT show the Export Failed section when qb_exported', async ({ page }) => {
    await mockReceivingPage(page, 'qb_exported', makeSuccessLog());
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    await expect(page.getByTestId('section-qb-export-success')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('section-export-failed')).not.toBeVisible();
    await expect(page.getByTestId('badge-export-failed')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: UI — "Export Failed" warning state
// ---------------------------------------------------------------------------

test.describe('QB export UI — export failed state', () => {
  const ERROR_MSG = 'QuickBooks API returned 403 Forbidden — token expired';

  function makeFailedLog(syncStatus: 'failed' | 'retry_exhausted') {
    return {
      id: 'ci-sync-log-failed-001',
      companyId: 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1',
      purchaseOrderId: MOCK_PO_ID,
      quickbooksBillId: null,
      syncStatus,
      attemptCount: 2,
      errorMessage: ERROR_MSG,
      errorCode: 'QB_403',
      lastAttemptAt: new Date().toISOString(),
      succeededAt: null,
      createdAt: new Date().toISOString(),
    };
  }

  test('shows "Export Failed" badge when syncStatus is "failed"', async ({ page }) => {
    await mockReceivingPage(page, 'pending_qb_export', makeFailedLog('failed'));
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    const badge = page.getByTestId('badge-export-failed');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText('Export Failed');
  });

  test('shows the export-failed section (data-testid="section-export-failed")', async ({ page }) => {
    await mockReceivingPage(page, 'pending_qb_export', makeFailedLog('failed'));
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    const failedSection = page.getByTestId('section-export-failed');
    await expect(failedSection).toBeVisible({ timeout: 10000 });
  });

  test('shows the error message text inside the failed section', async ({ page }) => {
    await mockReceivingPage(page, 'pending_qb_export', makeFailedLog('failed'));
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    const failedSection = page.getByTestId('section-export-failed');
    await expect(failedSection).toBeVisible({ timeout: 10000 });
    await expect(failedSection).toContainText(ERROR_MSG);
  });

  test('shows "Export Failed" badge for syncStatus "retry_exhausted"', async ({ page }) => {
    await mockReceivingPage(page, 'pending_qb_export', makeFailedLog('retry_exhausted'));
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    const badge = page.getByTestId('badge-export-failed');
    await expect(badge).toBeVisible({ timeout: 10000 });
  });

  test('does NOT show the success section when export failed', async ({ page }) => {
    await mockReceivingPage(page, 'pending_qb_export', makeFailedLog('failed'));
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    await expect(page.getByTestId('badge-export-failed')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('section-qb-export-success')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: UI — QB section is hidden when QB is not connected
// ---------------------------------------------------------------------------

test.describe('QB export UI — section hidden when QB not connected', () => {
  test('QB export card does not render when qbStatus.connected is false', async ({ page }) => {
    await mockReceivingPage(page, 'pending_qb_export', null);
    // Override the QB status to disconnected
    await page.route('**/api/quickbooks/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ connected: false }),
      }),
    );
    await page.goto(`${BASE_URL}/receiving/${MOCK_PO_ID}`);

    // Wait for the page to finish loading
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('badge-pending-export')).not.toBeVisible();
    await expect(page.getByTestId('badge-qb-exported')).not.toBeVisible();
    await expect(page.getByTestId('badge-export-failed')).not.toBeVisible();
    await expect(page.getByTestId('section-qb-export-success')).not.toBeVisible();
    await expect(page.getByTestId('section-export-failed')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Endpoint auth validation — 401 without a session
// ---------------------------------------------------------------------------

test.describe('QB export — unauthenticated requests are rejected', () => {
  test('GET /api/purchase-orders/:id/reconciliation returns 401 without auth', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/purchase-orders/${FAKE_UUID}/reconciliation`);
    expect(res.status()).toBe(401);
  });

  test('POST /api/purchase-orders/:id/reconcile returns 401 without auth', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/purchase-orders/${FAKE_UUID}/reconcile`, {
      data: { invoiceTotal: 100, receiptId: FAKE_UUID, initials: 'AB' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/quickbooks/export-bills returns 401 without auth', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/quickbooks/export-bills`, {
      data: { purchaseOrderIds: [FAKE_UUID] },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: export-bills request body validation
// ---------------------------------------------------------------------------

test.describe('POST /api/quickbooks/export-bills — request validation', () => {
  test.beforeEach(async ({ request }) => {
    await loginCookie(request);
  });

  test('400 when purchaseOrderIds is missing from body', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/quickbooks/export-bills`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  test('400 when purchaseOrderIds is an empty array', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/quickbooks/export-bills`, {
      data: { purchaseOrderIds: [] },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  test('non-existent PO produces an error result (not a 2xx success)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/quickbooks/export-bills`, {
      data: { purchaseOrderIds: [FAKE_UUID] },
      headers: { 'Content-Type': 'application/json' },
    });

    // When QB not connected → 400; when QB connected → 200 with per-PO failure
    if (res.status() === 400) {
      const body = await res.json() as { error: string };
      expect(body.error).toBeTruthy();
    } else {
      expect(res.status()).toBe(200);
      const body = await res.json() as {
        data: { results: Array<{ poId: string; success: boolean; error?: string }>; failureCount: number };
      };
      expect(body.data.failureCount).toBeGreaterThanOrEqual(1);
      const entry = body.data.results.find(r => r.poId === FAKE_UUID);
      expect(entry?.success).toBe(false);
      expect(entry?.error).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 7: PO status data contract (API-level, uses dev seed helper)
//
// These tests verify that the three QB export states are correctly stored and
// returned by GET /api/purchase-orders/:id, which is the primary API call
// that drives the badge rendering in the UI.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Teardown helper — deletes a seeded test PO and its sync log rows
// ---------------------------------------------------------------------------

async function deleteQbPoState(
  request: APIRequestContext,
  poId: string,
): Promise<void> {
  if (!poId) return;
  const res = await request.delete(`${BASE_URL}/api/dev/test/qb-po-state/${poId}`);
  // 404 means already gone; both outcomes are acceptable in teardown
  if (res.status() !== 200 && res.status() !== 404) {
    console.warn(`[afterEach] Failed to delete test PO ${poId}: HTTP ${res.status()}`);
  }
}

test.describe('PO status data contract — API-level state verification', () => {
  let seededPoIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    seededPoIds = [];
    await loginCookie(request);
  });

  test.afterEach(async ({ request }) => {
    for (const poId of seededPoIds) {
      await deleteQbPoState(request, poId);
    }
    seededPoIds = [];
  });

  test('seeded pending_qb_export PO is returned with correct status by GET /api/purchase-orders/:id', async ({ request }) => {
    const { poId } = await seedQbPoState(request, { status: 'pending_qb_export' });
    seededPoIds.push(poId);

    const res = await request.get(`${BASE_URL}/api/purchase-orders/${poId}`);
    expect(res.status()).toBe(200);

    const body = await res.json() as { status?: string };
    expect(body.status).toBe('pending_qb_export');
  });

  test('seeded qb_exported PO is returned with correct status by GET /api/purchase-orders/:id', async ({ request }) => {
    const { poId, syncLogId } = await seedQbPoState(request, {
      status: 'qb_exported',
      syncStatus: 'success',
      quickbooksBillId: `QB-BILL-${Date.now()}`,
    });
    seededPoIds.push(poId);

    const res = await request.get(`${BASE_URL}/api/purchase-orders/${poId}`);
    expect(res.status()).toBe(200);

    const body = await res.json() as { status?: string };
    expect(body.status).toBe('qb_exported');

    expect(syncLogId, 'sync log row must be created for qb_exported state').toBeTruthy();
  });

  test('seeded failed export PO stays in pending_qb_export (not qb_exported)', async ({ request }) => {
    const { poId, syncLogId } = await seedQbPoState(request, {
      status: 'pending_qb_export',
      syncStatus: 'failed',
      errorMessage: 'QB API error 403 — token expired',
    });
    seededPoIds.push(poId);

    const res = await request.get(`${BASE_URL}/api/purchase-orders/${poId}`);
    expect(res.status()).toBe(200);

    const body = await res.json() as { status?: string };
    expect(body.status, 'A failed export must not advance the PO to qb_exported').toBe('pending_qb_export');

    expect(syncLogId, 'sync log row must be created for failed export').toBeTruthy();
  });

  test('export-bills rejects a qb_exported PO (already exported)', async ({ request }) => {
    const { poId } = await seedQbPoState(request, {
      status: 'qb_exported',
      syncStatus: 'success',
      quickbooksBillId: `QB-DUPE-${Date.now()}`,
    });
    seededPoIds.push(poId);

    const res = await request.post(`${BASE_URL}/api/quickbooks/export-bills`, {
      data: { purchaseOrderIds: [poId] },
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.status() === 200) {
      const body = await res.json() as {
        data: { results: Array<{ poId: string; success: boolean; error?: string }>; failureCount: number };
      };
      expect(body.data.failureCount).toBeGreaterThanOrEqual(1);
      const entry = body.data.results.find(r => r.poId === poId);
      expect(entry?.success).toBe(false);
      expect(entry?.error).toBeTruthy();
    } else {
      // QB not connected guard fired — still a valid rejection
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
  });

  test('export-bills rejects a received-status PO (not yet reconciled)', async ({ request }) => {
    const { poId } = await seedQbPoState(request, { status: 'received' });
    seededPoIds.push(poId);

    const res = await request.post(`${BASE_URL}/api/quickbooks/export-bills`, {
      data: { purchaseOrderIds: [poId] },
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.status() === 200) {
      const body = await res.json() as {
        data: { results: Array<{ poId: string; success: boolean; error?: string }>; failureCount: number };
      };
      expect(body.data.failureCount).toBeGreaterThanOrEqual(1);
      const entry = body.data.results.find(r => r.poId === poId);
      expect(entry?.success).toBe(false);
      expect(entry?.error).toMatch(/reconcil/i);
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
  });
});
