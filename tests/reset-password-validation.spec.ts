/**
 * Playwright tests for Zod validation on the reset-password form.
 *
 * Verifies that the zodResolver is active and that submitting an empty,
 * too-short, or mismatched password shows the correct field-level error
 * without making any API call to /api/auth/reset-password.
 *
 * All API routes are mocked via page.route so no live server is required
 * beyond the Vite dev server.
 *
 * Import { test, expect } from './tests/test-helpers' to force app mode
 * in the Replit preview environment (VITE_SHOW_WEBSITE guard bypass).
 */

import { test, expect, Page } from './test-helpers';

const BASE_URL = 'http://localhost:5000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Intercepts the reset-password API endpoint and records whether it was
 * called.  Returns a getter so tests can assert after the fact.
 */
async function interceptResetPasswordApi(
  page: Page,
): Promise<() => boolean> {
  let called = false;
  await page.route('**/api/auth/reset-password', (route) => {
    called = true;
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return () => called;
}

/**
 * Navigate to /reset-password?token=test-token and wait for the password
 * input to be visible.
 */
async function goToResetPassword(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/reset-password?token=test-token`);
  await expect(page.getByTestId('input-password')).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Suite: Zod validation blocks invalid submissions
// ---------------------------------------------------------------------------

test.describe('Reset-password form — Zod validation', () => {
  test('shows password error and makes no API call when submitted with empty password', async ({ page }) => {
    const apiWasCalled = await interceptResetPasswordApi(page);

    await goToResetPassword(page);

    // Leave both fields blank and click submit
    await page.getByTestId('button-update-password').click();

    // Zod field error must appear on the password field
    const errorEl = page.getByTestId('error-password');
    await expect(errorEl).toBeVisible({ timeout: 5_000 });
    await expect(errorEl).toContainText('Password must be at least 6 characters');

    // The API must NOT have been called
    await page.waitForTimeout(300);
    expect(apiWasCalled()).toBe(false);
  });

  test('shows "Password must be at least 6 characters" and makes no API call when password is too short', async ({ page }) => {
    const apiWasCalled = await interceptResetPasswordApi(page);

    await goToResetPassword(page);

    // Enter a password that is shorter than 6 characters
    await page.getByTestId('input-password').fill('abc');
    await page.getByTestId('input-confirm-password').fill('abc');
    await page.getByTestId('button-update-password').click();

    // Zod field error must appear on the password field
    const errorEl = page.getByTestId('error-password');
    await expect(errorEl).toBeVisible({ timeout: 5_000 });
    await expect(errorEl).toContainText('Password must be at least 6 characters');

    // The API must NOT have been called
    await page.waitForTimeout(300);
    expect(apiWasCalled()).toBe(false);
  });

  test('shows "Passwords do not match" and makes no API call when confirm-password differs', async ({ page }) => {
    const apiWasCalled = await interceptResetPasswordApi(page);

    await goToResetPassword(page);

    // Enter a valid password but a different value in the confirm field
    await page.getByTestId('input-password').fill('secret123');
    await page.getByTestId('input-confirm-password').fill('different123');
    await page.getByTestId('button-update-password').click();

    // Zod refine error must appear on the confirmPassword field
    const errorEl = page.getByTestId('error-confirm-password');
    await expect(errorEl).toBeVisible({ timeout: 5_000 });
    await expect(errorEl).toContainText('Passwords do not match');

    // The API must NOT have been called
    await page.waitForTimeout(300);
    expect(apiWasCalled()).toBe(false);
  });
});
