/**
 * Shared Playwright test helpers for the FnB Cost Pro test suite.
 *
 * WHY THIS FILE EXISTS:
 * In the Replit development environment, VITE_SHOW_WEBSITE=true is set so
 * that the marketing site is visible in the Replit preview. This causes
 * Playwright tests that navigate to app URLs to see the marketing site
 * instead of the application (because App.tsx checks sessionStorage
 * "forceAppMode" vs VITE_SHOW_WEBSITE at module load time).
 *
 * This file extends the built-in Playwright `test` object with a custom
 * `page` fixture that injects `sessionStorage.setItem('forceAppMode', '1')`
 * before any script runs on the page. This forces the SPA into app mode
 * regardless of the VITE_SHOW_WEBSITE env var, without modifying production
 * code or requiring any changes to the test logic.
 *
 * All spec files that test UI routes should import `test` and `expect` from
 * this module instead of directly from `playwright/test`.
 */

import { test as base, expect } from 'playwright/test';
import type { Page } from 'playwright/test';

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('forceAppMode', '1');
    });
    await use(page);
  },
});

export { expect };
export type { Page, APIRequestContext } from 'playwright/test';

/**
 * Stubs the shell endpoints that the order guide review page calls on mount
 * so the page renders without hitting the real database.
 */
export async function mockReviewPageShell(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-id',
        email: 'admin@brians.pizza',
        companyId: 'test-company-id',
        companyName: "Brian's Pizza",
        role: 'company_admin',
        firstName: 'Test',
        lastName: 'User',
        active: 1,
        subscriptionTier: 'pro',
      }),
    }),
  );

  await page.route('**/api/stores', (route) => {
    if (!route.request().url().includes('/api/stores/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'store-1', name: "Brian's Main" }]),
      });
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

  await page.route('**/api/vendors', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'vendor-1', name: 'Sysco' }]),
    }),
  );
}
