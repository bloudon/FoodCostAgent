/**
 * Playwright tests for Zod-backed form validation on authentication pages.
 *
 * PURPOSE
 * -------
 * The Zod / @hookform/resolvers version contract can silently break at
 * runtime — the resolver degrades to a no-op, allowing invalid data to
 * bypass client-side validation and reach the API.
 *
 * Each suite here submits known-bad input and asserts that the correct
 * field error message is visible *before* any API call is made.  If the
 * Zod resolver stops working the error messages will never appear and
 * these tests will fail, catching the regression in CI.
 *
 * COVERAGE
 * --------
 *   1. Login page          — plain form (no Zod); tests that bad credentials
 *                            produce a visible error toast.
 *   2. Accept-invitation   — Zod: firstName, lastName, password min-6,
 *                            password-confirm match.
 *   3. Reset-password      — Zod: password min-6, password-confirm match.
 *   4. Activate-account    — Zod: password min-6, password-confirm match
 *                            (password step, reached after OTP mock).
 *                            Route: /activate?email=...
 *
 * All API calls are mocked via page.route so no live database is required.
 * Import { test, expect } from './test-helpers' to force app mode in Replit.
 *
 * Relevant source files:
 *   artifacts/fnb-cost-pro/src/pages/login.tsx
 *   artifacts/fnb-cost-pro/src/pages/accept-invitation.tsx
 *   artifacts/fnb-cost-pro/src/pages/reset-password.tsx
 *   artifacts/fnb-cost-pro/src/pages/activate-account.tsx
 */

import { test, expect, Page } from './test-helpers';

const BASE_URL = 'http://localhost:5000';

// ---------------------------------------------------------------------------
// Shared API stubs
// ---------------------------------------------------------------------------

/** Return "not authenticated" from /api/auth/me so the app doesn't redirect. */
async function stubUnauthenticated(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
}

/** Stub SSO-provider check so the login page doesn't spin. */
async function stubSsoProvider(page: Page): Promise<void> {
  await page.route('**/api/sso/provider', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'replit' }),
    }),
  );
}

// ===========================================================================
// 1. Login form
// ===========================================================================

test.describe('Login form — credential error path', () => {
  async function setupLogin(page: Page): Promise<void> {
    await stubUnauthenticated(page);
    await stubSsoProvider(page);

    // Mock the login endpoint to reject with an auth error
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid email or password' }),
      }),
    );
  }

  test('shows an error message when wrong credentials are submitted', async ({ page }) => {
    await setupLogin(page);
    await page.goto(`${BASE_URL}/login`);

    await page.getByTestId('input-email').fill('nobody@example.com');
    await page.getByTestId('input-password').fill('wrongpassword');
    await page.getByTestId('button-login').click();

    // The toast title comes from t.auth.loginFailed — match the title element exactly
    await expect(page.getByText('Login failed')).toBeVisible({ timeout: 8000 });
  });

  test('submit button is rendered and clickable before submission', async ({ page }) => {
    await setupLogin(page);
    await page.goto(`${BASE_URL}/login`);

    const btn = page.getByTestId('button-login');
    await expect(btn).toBeVisible({ timeout: 8000 });
    await expect(btn).toBeEnabled();
  });
});

// ===========================================================================
// 2. Accept-invitation form — Zod validation
// ===========================================================================

test.describe('Accept-invitation form — Zod field validation', () => {
  const FAKE_TOKEN = 'test-invite-token-abc123';

  async function setupInvitation(page: Page): Promise<void> {
    await stubUnauthenticated(page);

    // Return a valid invitation so the form renders (not the error screen)
    await page.route(`**/api/invitations/by-token/${FAKE_TOKEN}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          email: 'jane@restaurant.com',
          role: 'store_manager',
          companyName: "Brian's Pizza",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      }),
    );
  }

  test('shows "First name is required" when first name is empty', async ({ page }) => {
    await setupInvitation(page);
    await page.goto(`${BASE_URL}/accept-invitation/${FAKE_TOKEN}`);

    await expect(page.getByTestId('button-accept-invite')).toBeVisible({ timeout: 10000 });

    // Leave firstName blank; fill everything else validly
    await page.getByTestId('input-last-name').fill('Doe');
    await page.getByTestId('input-password').fill('secret1');
    await page.getByTestId('input-confirm-password').fill('secret1');
    await page.getByTestId('button-accept-invite').click();

    await expect(page.getByText('First name is required')).toBeVisible({ timeout: 5000 });
  });

  test('shows "Last name is required" when last name is empty', async ({ page }) => {
    await setupInvitation(page);
    await page.goto(`${BASE_URL}/accept-invitation/${FAKE_TOKEN}`);

    await expect(page.getByTestId('button-accept-invite')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('input-first-name').fill('Jane');
    // Leave lastName blank
    await page.getByTestId('input-password').fill('secret1');
    await page.getByTestId('input-confirm-password').fill('secret1');
    await page.getByTestId('button-accept-invite').click();

    await expect(page.getByText('Last name is required')).toBeVisible({ timeout: 5000 });
  });

  test('shows "Password must be at least 6 characters" for a short password', async ({ page }) => {
    await setupInvitation(page);
    await page.goto(`${BASE_URL}/accept-invitation/${FAKE_TOKEN}`);

    await expect(page.getByTestId('button-accept-invite')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('input-first-name').fill('Jane');
    await page.getByTestId('input-last-name').fill('Doe');
    await page.getByTestId('input-password').fill('abc');   // too short
    await page.getByTestId('input-confirm-password').fill('abc');
    await page.getByTestId('button-accept-invite').click();

    await expect(page.getByText('Password must be at least 6 characters')).toBeVisible({ timeout: 5000 });
  });

  test('shows "Passwords do not match" when confirm password differs', async ({ page }) => {
    await setupInvitation(page);
    await page.goto(`${BASE_URL}/accept-invitation/${FAKE_TOKEN}`);

    await expect(page.getByTestId('button-accept-invite')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('input-first-name').fill('Jane');
    await page.getByTestId('input-last-name').fill('Doe');
    await page.getByTestId('input-password').fill('secret1');
    await page.getByTestId('input-confirm-password').fill('different');
    await page.getByTestId('button-accept-invite').click();

    await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 5000 });
  });

  test('no API call to accept endpoint is made when validation fails', async ({ page }) => {
    await setupInvitation(page);

    let acceptCalled = false;
    await page.route('**/api/invitations/accept-local', (route) => {
      acceptCalled = true;
      return route.continue();
    });

    await page.goto(`${BASE_URL}/accept-invitation/${FAKE_TOKEN}`);
    await expect(page.getByTestId('button-accept-invite')).toBeVisible({ timeout: 10000 });

    // Submit completely empty — all fields fail Zod validation
    await page.getByTestId('button-accept-invite').click();

    await expect(page.getByText('First name is required')).toBeVisible({ timeout: 5000 });
    expect(acceptCalled).toBe(false);
  });
});

// ===========================================================================
// 3. Reset-password form — Zod validation
// ===========================================================================

test.describe('Reset-password form — Zod field validation', () => {
  async function gotoResetPassword(page: Page): Promise<void> {
    await stubUnauthenticated(page);
    await page.goto(`${BASE_URL}/reset-password?token=test-reset-token-xyz`);
    await expect(page.getByTestId('button-update-password')).toBeVisible({ timeout: 10000 });
  }

  test('shows "Password must be at least 6 characters" for a short password', async ({ page }) => {
    await gotoResetPassword(page);

    await page.getByTestId('input-password').fill('abc');
    await page.getByTestId('input-confirm-password').fill('abc');
    await page.getByTestId('button-update-password').click();

    await expect(page.getByText('Password must be at least 6 characters')).toBeVisible({ timeout: 5000 });
  });

  test('shows "Please confirm your password" when confirm field is empty', async ({ page }) => {
    await gotoResetPassword(page);

    await page.getByTestId('input-password').fill('validpass');
    // leave confirmPassword empty
    await page.getByTestId('button-update-password').click();

    await expect(page.getByText('Please confirm your password')).toBeVisible({ timeout: 5000 });
  });

  test('shows "Passwords do not match" when confirm password differs', async ({ page }) => {
    await gotoResetPassword(page);

    await page.getByTestId('input-password').fill('validpass');
    await page.getByTestId('input-confirm-password').fill('different');
    await page.getByTestId('button-update-password').click();

    await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 5000 });
  });

  test('no API call to reset-password endpoint is made when validation fails', async ({ page }) => {
    await stubUnauthenticated(page);

    let resetCalled = false;
    await page.route('**/api/auth/reset-password', (route) => {
      resetCalled = true;
      return route.continue();
    });

    await page.goto(`${BASE_URL}/reset-password?token=test-reset-token-xyz`);
    await expect(page.getByTestId('button-update-password')).toBeVisible({ timeout: 10000 });

    // Submit with mismatched passwords — Zod refine should block submission
    await page.getByTestId('input-password').fill('validpass');
    await page.getByTestId('input-confirm-password').fill('mismatch');
    await page.getByTestId('button-update-password').click();

    await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 5000 });
    expect(resetCalled).toBe(false);
  });
});

// ===========================================================================
// 4. Activate-account form — Zod validation (password step)
//    Route: /activate?email=...
// ===========================================================================

test.describe('Activate-account form — Zod field validation (password step)', () => {
  const TEST_EMAIL = 'newuser@restaurant.com';

  /**
   * Navigate to /activate and advance past the OTP step by mocking the
   * verify-otp endpoint to succeed, then entering a valid 6-digit code.
   */
  async function advanceToPasswordStep(page: Page): Promise<void> {
    await stubUnauthenticated(page);

    // Mock OTP verification to always succeed
    await page.route('**/api/auth/verify-otp', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }),
    );

    await page.goto(`${BASE_URL}/activate?email=${encodeURIComponent(TEST_EMAIL)}`);
    await expect(page.getByTestId('input-otp-0')).toBeVisible({ timeout: 10000 });

    // Fill all 6 OTP digit inputs
    for (let i = 0; i < 6; i++) {
      await page.getByTestId(`input-otp-${i}`).fill('1');
    }

    await page.getByTestId('button-verify-otp').click();

    // Wait for the password step to become visible
    await expect(page.getByTestId('button-activate')).toBeVisible({ timeout: 8000 });
  }

  test('shows "Password must be at least 6 characters" for a short password', async ({ page }) => {
    await advanceToPasswordStep(page);

    await page.getByTestId('input-password').fill('abc');
    await page.getByTestId('input-confirm-password').fill('abc');
    await page.getByTestId('button-activate').click();

    await expect(page.getByText('Password must be at least 6 characters')).toBeVisible({ timeout: 5000 });
  });

  test('shows "Passwords do not match" when confirm password differs', async ({ page }) => {
    await advanceToPasswordStep(page);

    await page.getByTestId('input-password').fill('validpass');
    await page.getByTestId('input-confirm-password').fill('different');
    await page.getByTestId('button-activate').click();

    await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 5000 });
  });

  test('no API call to activate endpoint is made when validation fails', async ({ page }) => {
    await advanceToPasswordStep(page);

    let activateCalled = false;
    await page.route('**/api/leads/activate', (route) => {
      activateCalled = true;
      return route.continue();
    });

    // Submit with mismatched passwords — Zod refine should block the API call
    await page.getByTestId('input-password').fill('validpass');
    await page.getByTestId('input-confirm-password').fill('mismatch');
    await page.getByTestId('button-activate').click();

    await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 5000 });
    expect(activateCalled).toBe(false);
  });
});
