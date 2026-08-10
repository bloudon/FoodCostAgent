/**
 * Playwright tests for Zod validation on the login form.
 *
 * Verifies that the zodResolver is active and that submitting an empty
 * email or empty password shows the correct field-level error without
 * making any API call to /api/auth/login.
 *
 * All API routes are mocked via page.route so no live server is required
 * beyond the Vite dev server.
 *
 * Import { test, expect } from './test-helpers' to force app mode
 * in the Replit preview environment (VITE_SHOW_WEBSITE guard bypass).
 */

import { test, expect, Page } from './test-helpers';

const BASE_URL = 'http://localhost:5000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Intercepts the login API endpoint and records whether it was called.
 * Returns a getter so tests can assert after the fact.
 */
async function interceptLoginApi(page: Page): Promise<() => boolean> {
  let called = false;
  await page.route('**/api/auth/login', (route) => {
    called = true;
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return () => called;
}

/**
 * Navigate to /login and wait for the email input to be visible.
 * Stubs /api/auth/me (unauthenticated) and /api/sso/provider so the
 * page renders fully without hitting a live database.
 */
async function goToLogin(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );

  await page.route('**/api/sso/provider', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'replit' }),
    }),
  );

  await page.goto(`${BASE_URL}/login`);
  await expect(page.getByTestId('input-email')).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Suite: Zod validation blocks blank submissions
// ---------------------------------------------------------------------------

test.describe('Login form — Zod validation', () => {
  test('shows "Email is required" and makes no API call when email is blank', async ({ page }) => {
    const apiWasCalled = await interceptLoginApi(page);

    await goToLogin(page);

    // Leave email blank, fill a valid password, then submit
    await page.getByTestId('input-password').fill('somepassword');
    await page.getByTestId('button-login').click();

    // Zod field error must appear on the email field
    const errorEl = page.getByTestId('error-email');
    await expect(errorEl).toBeVisible({ timeout: 5_000 });
    await expect(errorEl).toContainText('Email is required');

    // The login API must NOT have been called
    await page.waitForTimeout(300);
    expect(apiWasCalled()).toBe(false);
  });

  test('shows "Password is required" and makes no API call when password is blank', async ({ page }) => {
    const apiWasCalled = await interceptLoginApi(page);

    await goToLogin(page);

    // Fill a valid email, leave password blank, then submit
    await page.getByTestId('input-email').fill('user@example.com');
    await page.getByTestId('button-login').click();

    // Zod field error must appear on the password field
    const errorEl = page.getByTestId('error-password');
    await expect(errorEl).toBeVisible({ timeout: 5_000 });
    await expect(errorEl).toContainText('Password is required');

    // The login API must NOT have been called
    await page.waitForTimeout(300);
    expect(apiWasCalled()).toBe(false);
  });

  test('shows "Please enter a valid email address" and makes no API call when email is malformed', async ({ page }) => {
    const apiWasCalled = await interceptLoginApi(page);

    await goToLogin(page);

    // Enter a clearly invalid string that is not an email address
    await page.getByTestId('input-email').fill('notanemail');
    await page.getByTestId('input-password').fill('somepassword');
    await page.getByTestId('button-login').click();

    // Zod field error must appear on the email field
    const errorEl = page.getByTestId('error-email');
    await expect(errorEl).toBeVisible({ timeout: 5_000 });
    await expect(errorEl).toContainText('Please enter a valid email address');

    // The login API must NOT have been called
    await page.waitForTimeout(300);
    expect(apiWasCalled()).toBe(false);
  });
});
