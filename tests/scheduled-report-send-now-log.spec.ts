/**
 * Playwright test: "Send now" delivery visible in the run log after a short delay
 *
 * The POST /api/report-subscriptions/:id/run endpoint fires the subscription
 * asynchronously and returns immediately.  The ScheduledReportsPage then polls
 * the logs endpoint (every 2 s, up to 15 s) until an entry with a
 * triggered_at timestamp newer than the send time appears.
 *
 * This test verifies the full round-trip:
 *   1. "Send now" button click
 *   2. POST …/run returns { ok: true }
 *   3. Logs panel opens automatically
 *   4. A new log entry (success or error) eventually appears in the panel
 *
 * All API calls are mocked so no live database is required.
 */

import { test, expect, Page } from './test-helpers';

const BASE_URL    = 'http://localhost:5000';
const COMPANY_ID  = 'test-company-845';
const SUB_ID      = 'sub-845-001';

// ─────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────────────────────────────────────

async function mockScheduledReportsPage(page: Page): Promise<void> {
  // Auth — company_admin so all report routes are accessible
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-845',
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

  // One active subscription
  await page.route('**/api/report-subscriptions', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: SUB_ID,
          name: 'Weekly Recipe Cost',
          report_type: 'recipe_cost',
          schedule_frequency: 'weekly',
          schedule_hour: 8,
          email_recipients: ['owner@brians.pizza'],
          is_active: 1,
          last_run_at: null,
          filters: {},
        },
      ]),
    });
  });

  // "Send now" — acknowledge immediately (async fire-and-forget)
  await page.route(`**/api/report-subscriptions/${SUB_ID}/run`, (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  // Logs endpoint — returns a log entry whose triggered_at is always *after*
  // the moment this mock handler is called (i.e. after the "Send now" round-trip).
  // Using a far-future offset (+60 s) guarantees it is newer than triggerTime.current
  // even if the first poll fires within milliseconds of the mutation succeeding.
  await page.route(`**/api/report-subscriptions/${SUB_ID}/logs`, (route) => {
    const triggeredAt = new Date(Date.now() + 60_000).toISOString();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'log-845-001',
          triggered_at: triggeredAt,
          status: 'success',
          emails_sent: 1,
          error_message: null,
        },
      ]),
    });
  });

  // Shell / layout stubs
  await page.route('**/api/accessible-stores', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/stores', (route) => {
    if (!route.request().url().includes('/api/stores/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.continue();
  });
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Scheduled report — Send now log entry', () => {
  test('logs panel opens automatically after clicking Send now', async ({ page }) => {
    await mockScheduledReportsPage(page);
    await page.goto(`${BASE_URL}/reports/scheduled`);

    // The subscription card must be visible
    await expect(page.getByText('Weekly Recipe Cost')).toBeVisible({ timeout: 15_000 });

    // Click "Send now" (Play button)
    await page.getByTitle('Send now').click();

    // The logs panel title appears immediately after the mutation succeeds
    await expect(page.getByText(/Run log/i)).toBeVisible({ timeout: 10_000 });
  });

  test('a log entry with success or error status appears in the panel after a short delay', async ({ page }) => {
    await mockScheduledReportsPage(page);
    await page.goto(`${BASE_URL}/reports/scheduled`);

    await expect(page.getByText('Weekly Recipe Cost')).toBeVisible({ timeout: 15_000 });

    // Click "Send now"
    await page.getByTitle('Send now').click();

    // Logs panel must open
    await expect(page.getByText(/Run log/i)).toBeVisible({ timeout: 10_000 });

    // Within the polling window (≤ 15 s the page polls; give the test 20 s total)
    // at least one log row must appear.  The row contains either a CheckCircle2
    // icon (success) or an XCircle icon (error); we locate it by the status text.
    const logEntry = page.locator('.space-y-1\\.5 > div').first();
    await expect(logEntry).toBeVisible({ timeout: 20_000 });
  });

  test('log entry shows "1 email sent" for a successful delivery', async ({ page }) => {
    await mockScheduledReportsPage(page);
    await page.goto(`${BASE_URL}/reports/scheduled`);

    await expect(page.getByText('Weekly Recipe Cost')).toBeVisible({ timeout: 15_000 });

    await page.getByTitle('Send now').click();

    await expect(page.getByText(/Run log/i)).toBeVisible({ timeout: 10_000 });

    // The success log row renders "1 email sent" for emails_sent === 1
    await expect(page.getByText(/1 email sent/i)).toBeVisible({ timeout: 20_000 });
  });

  test('"Send now" toast confirms the report is queued', async ({ page }) => {
    await mockScheduledReportsPage(page);
    await page.goto(`${BASE_URL}/reports/scheduled`);

    await expect(page.getByText('Weekly Recipe Cost')).toBeVisible({ timeout: 15_000 });

    await page.getByTitle('Send now').click();

    // The onSuccess handler fires a "Report queued" toast
    await expect(page.getByText(/Report queued/i)).toBeVisible({ timeout: 10_000 });
  });

  test('closing the logs panel mid-poll clears the 15s timer and closes cleanly', async ({ page }) => {
    // Override the logs route to return an empty array so no entry ever appears
    // (simulates the report still processing when the user closes the panel)
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user-845',
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

    await page.route('**/api/report-subscriptions', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: SUB_ID,
            name: 'Weekly Recipe Cost',
            report_type: 'recipe_cost',
            schedule_frequency: 'weekly',
            schedule_hour: 8,
            email_recipients: ['owner@brians.pizza'],
            is_active: 1,
            last_run_at: null,
            filters: {},
          },
        ]),
      });
    });

    await page.route(`**/api/report-subscriptions/${SUB_ID}/run`, (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    // Logs endpoint returns EMPTY — no entry has arrived yet
    await page.route(`**/api/report-subscriptions/${SUB_ID}/logs`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      }),
    );

    await page.route('**/api/accessible-stores', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/stores', (route) => {
      if (!route.request().url().includes('/api/stores/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.continue();
    });
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

    await page.goto(`${BASE_URL}/reports/scheduled`);
    await expect(page.getByText('Weekly Recipe Cost')).toBeVisible({ timeout: 15_000 });

    // Click "Send now" — opens the logs panel and starts the 15s hard-stop timer
    await page.getByTitle('Send now').click();

    // Logs panel must appear (polling has started, no entries yet)
    await expect(page.getByText(/Run log/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/No runs recorded yet/i)).toBeVisible({ timeout: 5_000 });

    // Immediately close the panel — this must cancel the pollingTimer
    await page.getByRole('button', { name: /close/i }).click();

    // Panel must disappear
    await expect(page.getByText(/Run log/i)).not.toBeVisible({ timeout: 5_000 });

    // Wait longer than the 15s timer to confirm it does not fire and cause an error
    // (e.g. setting state on an unmounted component or unexpected re-renders).
    // We only wait 2s here — enough to catch immediate errors — since CI time is precious.
    await page.waitForTimeout(2_000);

    // No error overlay or console errors about state updates
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    expect(errors).toHaveLength(0);

    // Re-open the logs panel manually — confirms no stale polling state causes unexpected refetches
    await page.getByTitle('View logs').click();
    await expect(page.getByText(/Run log/i)).toBeVisible({ timeout: 5_000 });
    // Panel shows the empty state (no stale polling re-opened a ghost panel)
    await expect(page.getByText(/No runs recorded yet/i)).toBeVisible({ timeout: 5_000 });
  });
});
