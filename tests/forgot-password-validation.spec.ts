/**
 * Playwright tests for Zod validation on the forgot-password form.
 *
 * Verifies that the zodResolver is active and that submitting an empty
 * or malformed email shows the correct field-level error without making
 * any API call to /api/auth/forgot-password.
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
 * Intercepts the forgot-password API endpoint and records whether it was
 * called.  Returns a getter so tests can assert after the fact.
 */
async function interceptForgotPasswordApi(
  page: Page,
): Promise<() => boolean> {
  let called = false;
  await page.route('**/api/auth/forgot-password', (route) => {
    called = true;
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return () => called;
}

/**
 * Navigate to /forgot-password and wait for the email input to be visible.
 */
async function goToForgotPassword(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/forgot-password`);
  await expect(page.getByTestId('input-email')).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Suite: Zod validation blocks invalid submissions
// ---------------------------------------------------------------------------

test.describe('Forgot-password form — Zod validation', () => {
  test('shows "Email is required" and makes no API call when submitted empty', async ({ page }) => {
    const apiWasCalled = await interceptForgotPasswordApi(page);

    await goToForgotPassword(page);

    // Leave the email field blank and click submit
    await page.getByTestId('button-send-reset').click();

    // Zod field error must appear
    const errorEl = page.getByTestId('error-email');
    await expect(errorEl).toBeVisible({ timeout: 5_000 });
    await expect(errorEl).toContainText('Email is required');

    // The API must NOT have been called
    // Give a short moment in case a mutation fires asynchronously
    await page.waitForTimeout(300);
    expect(apiWasCalled()).toBe(false);
  });

  test('shows "Please enter a valid email address" and makes no API call when email is malformed', async ({ page }) => {
    const apiWasCalled = await interceptForgotPasswordApi(page);

    await goToForgotPassword(page);

    // Enter a clearly invalid string that is not an email address
    await page.getByTestId('input-email').fill('notanemail');
    await page.getByTestId('button-send-reset').click();

    // Zod field error must appear
    const errorEl = page.getByTestId('error-email');
    await expect(errorEl).toBeVisible({ timeout: 5_000 });
    await expect(errorEl).toContainText('Please enter a valid email address');

    // The API must NOT have been called
    await page.waitForTimeout(300);
    expect(apiWasCalled()).toBe(false);
  });

  test('clears the error and calls the API when a valid email is submitted', async ({ page }) => {
    const apiWasCalled = await interceptForgotPasswordApi(page);

    await goToForgotPassword(page);

    // First trigger the error
    await page.getByTestId('button-send-reset').click();
    await expect(page.getByTestId('error-email')).toBeVisible({ timeout: 5_000 });

    // Then correct the email and resubmit
    await page.getByTestId('input-email').fill('valid@example.com');
    await page.getByTestId('button-send-reset').click();

    // The error must disappear
    await expect(page.getByTestId('error-email')).not.toBeVisible({ timeout: 5_000 });

    // The API must have been called with the valid address
    await page.waitForTimeout(500);
    expect(apiWasCalled()).toBe(true);
  });
});
