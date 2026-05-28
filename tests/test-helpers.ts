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

export const test = base.extend<{ page: import('playwright/test').Page }>({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('forceAppMode', '1');
    });
    await use(page);
  },
});

export { expect };
export type { Page, APIRequestContext } from 'playwright/test';
