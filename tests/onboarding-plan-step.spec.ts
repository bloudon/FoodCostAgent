import { test, expect, Page } from 'playwright/test';

const BASE_URL = 'http://localhost:5000';
const TEST_EMAIL = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';

/**
 * Company ID for admin@brians.pizza (Brian's Pizza) in the dev database.
 * Used to build the localStorage key for wizard state.
 */
const TEST_COMPANY_ID = 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
const WIZARD_KEY = `onboarding_wizard_${TEST_COMPANY_ID}`;

/**
 * Enables app mode on localhost (bypasses VITE_SHOW_WEBSITE=true) by
 * visiting /?app, which sets sessionStorage.forceAppMode = '1'.
 */
async function enableAppMode(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/?app`);
  await page.waitForTimeout(500);
}

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(TEST_EMAIL);
  await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log in"), button:has-text("Login")').first().click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 10000 });
}

/**
 * Injects wizard state + selectedCompanyId into localStorage.
 * Required because global_admin users are gated by selectedCompanyId in OnboardingSetup.
 */
async function setWizardStep(page: Page, step: number): Promise<void> {
  await page.evaluate(
    ({ key, companyId, targetStep }: { key: string; companyId: string; targetStep: number }) => {
      localStorage.setItem('selectedCompanyId', companyId);
      const existing = localStorage.getItem(key);
      const base = existing ? JSON.parse(existing) : { approvedMenuItems: [], skippedRecipes: [] };
      localStorage.setItem(key, JSON.stringify({ ...base, step: targetStep }));
    },
    { key: WIZARD_KEY, companyId: TEST_COMPANY_ID, targetStep: step }
  );
}

/**
 * Mocks both /api/auth/me and /api/companies/:id to return the given subscriptionTier.
 * Both are required: useCompany() fetches company via /api/companies/:id, and PlanStep
 * polls /api/auth/me. Without mocking the company endpoint, hasPlan will be true for
 * Brian's Pizza (which already has a paid plan in dev) and PlanStep will auto-advance.
 */
async function mockFreeTier(page: Page): Promise<void> {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-id',
        email: TEST_EMAIL,
        companyId: TEST_COMPANY_ID,
        subscriptionTier: 'free',
        role: 'global_admin',
      }),
    });
  });

  await page.route(`**/api/companies/${TEST_COMPANY_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: TEST_COMPANY_ID,
        name: "Brian's Pizza",
        subscriptionTier: 'free',
      }),
    });
  });
}

/**
 * Mocks /api/auth/me and /api/companies/:id to return a paid tier.
 * Used to simulate successful plan activation.
 */
async function mockPaidTier(page: Page, tier: string = 'basic'): Promise<void> {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-id',
        email: TEST_EMAIL,
        companyId: TEST_COMPANY_ID,
        subscriptionTier: tier,
        role: 'global_admin',
      }),
    });
  });

  await page.route(`**/api/companies/${TEST_COMPANY_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: TEST_COMPANY_ID,
        name: "Brian's Pizza",
        subscriptionTier: tier,
      }),
    });
  });
}

/**
 * Mocks the milestone review-step endpoint so advance() doesn't fail.
 */
async function mockMilestoneEndpoints(page: Page): Promise<void> {
  await page.route('**/api/onboarding/milestones/review-step', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
}

test.describe('Onboarding plan step — wizard Step 2', () => {
  test.beforeEach(async ({ page }) => {
    // VITE_SHOW_WEBSITE=true in .env — /?app forces app mode via sessionStorage
    await enableAppMode(page);
    await login(page);
  });

  test('Step 2 plan card is visible when wizard state is at step 2 and company is on free tier', async ({ page }) => {
    // Mock free tier so the PlanStep doesn't auto-advance
    await mockFreeTier(page);

    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);
    await setWizardStep(page, 2);
    await page.reload();
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('wizard-stepper')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('card-step-plan')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('button-choose-plan')).toBeVisible();
    await expect(page.getByTestId('button-check-plan')).toBeVisible();
    await expect(page.getByText('Choose your plan')).toBeVisible();
  });

  test('?planActivated=true triggers polling state then auto-advances to step 3', async ({ page }) => {
    // Company starts as free (so PlanStep renders), then auth/me returns paid
    // so the polling loop detects the plan and calls onContinue()
    let callCount = 0;
    await page.route('**/api/auth/me', async (route) => {
      callCount++;
      // First call (page load) → free, subsequent calls (polling) → paid
      const tier = callCount >= 2 ? 'basic' : 'free';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user-id',
          email: TEST_EMAIL,
          companyId: TEST_COMPANY_ID,
          subscriptionTier: tier,
          role: 'global_admin',
        }),
      });
    });

    await page.route(`**/api/companies/${TEST_COMPANY_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: TEST_COMPANY_ID,
          name: "Brian's Pizza",
          subscriptionTier: 'free',
        }),
      });
    });

    await mockMilestoneEndpoints(page);

    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);
    await setWizardStep(page, 2);

    // Navigate with the Stripe return query param — triggers polling
    await page.goto(`${BASE_URL}/onboarding/setup?planActivated=true`);
    await page.waitForTimeout(800);

    // After polling detects a paid tier, the wizard should advance to step 3
    await expect(
      page.getByTestId('card-step-invoice-upload').or(page.getByTestId('card-step-plan-active'))
    ).toBeVisible({ timeout: 12000 });
  });

  test('?planActivated=true shows polling spinner while waiting for subscription webhook', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/auth/me', async (route) => {
      callCount++;
      // First 3 calls return free, then return paid to simulate webhook propagation delay
      const tier = callCount >= 4 ? 'basic' : 'free';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user-id',
          email: TEST_EMAIL,
          companyId: TEST_COMPANY_ID,
          subscriptionTier: tier,
          role: 'global_admin',
        }),
      });
    });

    await page.route(`**/api/companies/${TEST_COMPANY_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: TEST_COMPANY_ID,
          name: "Brian's Pizza",
          subscriptionTier: 'free',
        }),
      });
    });

    await mockMilestoneEndpoints(page);

    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);
    await setWizardStep(page, 2);

    await page.goto(`${BASE_URL}/onboarding/setup?planActivated=true`);
    await page.waitForTimeout(800);

    // Polling spinner should be visible immediately after landing
    await expect(page.getByTestId('card-step-plan-polling')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Confirming your plan…')).toBeVisible();

    // After polling detects a paid tier, wizard should advance to step 3
    await expect(page.getByTestId('card-step-invoice-upload')).toBeVisible({ timeout: 15000 });
  });

  test('manual "I\'ve selected a plan" button advances to step 3 when API returns paid tier', async ({ page }) => {
    // Company is "free" so plan card renders. After clicking check, auth/me returns paid.
    await mockFreeTier(page);
    await mockMilestoneEndpoints(page);

    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);
    await setWizardStep(page, 2);
    await page.reload();
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('card-step-plan')).toBeVisible({ timeout: 5000 });

    // Now switch mock to return paid tier for the manual check button call
    await page.unroute('**/api/auth/me');
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user-id',
          email: TEST_EMAIL,
          companyId: TEST_COMPANY_ID,
          subscriptionTier: 'pro',
          role: 'global_admin',
        }),
      });
    });

    await page.getByTestId('button-check-plan').click();

    // Should advance to step 3 — invoice upload card
    await expect(page.getByTestId('card-step-invoice-upload')).toBeVisible({ timeout: 8000 });
  });

  test('manual "I\'ve selected a plan" button shows error toast when API still returns free tier', async ({ page }) => {
    // Company stays "free" — user clicked the button without actually selecting a plan
    await mockFreeTier(page);

    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);
    await setWizardStep(page, 2);
    await page.reload();
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('card-step-plan')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('button-check-plan').click();

    // Should show an error toast (no active plan found)
    await expect(page.getByText('No active plan found')).toBeVisible({ timeout: 5000 });

    // Should still be on step 2 (plan card still visible)
    await expect(page.getByTestId('card-step-plan')).toBeVisible();
  });

  test('"View Plans & Pricing" button navigates to /choose-plan with returnTo param', async ({ page }) => {
    await mockFreeTier(page);

    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);
    await setWizardStep(page, 2);
    await page.reload();
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('card-step-plan')).toBeVisible({ timeout: 5000 });

    // Click button and wait for URL change to /choose-plan
    await Promise.all([
      page.waitForURL((url: URL) => url.pathname.includes('/choose-plan'), { timeout: 5000 }),
      page.getByTestId('button-choose-plan').click(),
    ]);

    expect(page.url()).toContain('/choose-plan');
    expect(page.url()).toContain('returnTo');
  });

  test('stepper shows step 2 (Plan) as active when wizard is at step 2', async ({ page }) => {
    await mockFreeTier(page);

    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);
    await setWizardStep(page, 2);
    await page.reload();
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('wizard-stepper')).toBeVisible({ timeout: 5000 });

    // Step 1 indicator (menu_scan) should be visible and marked complete
    await expect(page.getByTestId('step-indicator-menu_scan')).toBeVisible();

    // Step 2 indicator (plan) should be visible and active
    const step2 = page.getByTestId('step-indicator-plan');
    await expect(step2).toBeVisible();
    // Active step has primary text color class
    await expect(step2).toHaveClass(/border-primary/);
  });
});
