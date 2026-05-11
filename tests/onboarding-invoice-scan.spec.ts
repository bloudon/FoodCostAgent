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
 * Mocks both the file-upload endpoint and the invoice-scan API so the full
 * "click upload → get review table" flow can run without real storage or GPT calls.
 *
 * Flow inside ObjectUploader:
 *   1. POST /api/objects/upload  → { objectPath: "test/mock-invoice.jpg" }
 *   2. onUploadComplete("test/mock-invoice.jpg") is called
 *   3. handleUpload() calls POST /api/onboarding/invoice-scan
 *   4. We return the mock scan result → UI transitions to review card
 */
async function mockInvoiceScanFlow(
  page: Page,
  items: object[],
  vendorName: string | null = 'Test Vendor Co',
): Promise<void> {
  // Mock the Replit object storage upload step
  await page.route('**/api/objects/upload', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ objectPath: 'test/mock-invoice.jpg' }),
    });
  });

  // Mock the AI invoice scan step
  await page.route('**/api/onboarding/invoice-scan', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ vendorName, items }),
    });
  });
}

test.describe('Onboarding invoice scan — wizard Step 3', () => {
  test.beforeEach(async ({ page }) => {
    // VITE_SHOW_WEBSITE=true in .env — /?app forces app mode via sessionStorage
    await enableAppMode(page);
    await login(page);
  });

  test('navigating to /onboarding/setup renders the wizard stepper without crashing', async ({ page }) => {
    await page.evaluate(
      ({ companyId }: { companyId: string }) => { localStorage.setItem('selectedCompanyId', companyId); },
      { companyId: TEST_COMPANY_ID }
    );

    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(2000);

    // The wizard stepper should be visible
    await expect(page.getByTestId('wizard-stepper')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('step-indicator-menu_scan')).toBeVisible();
    await expect(page.getByTestId('step-indicator-invoice_scan')).toBeVisible();
    await expect(page.getByTestId('step-indicator-recipes')).toBeVisible();
  });

  test('Step 3 upload card is visible when wizard state is at step 3', async ({ page }) => {
    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);

    await setWizardStep(page, 3);
    await page.reload();
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('wizard-stepper')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('card-step-invoice-upload')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('button-upload-invoice')).toBeVisible();
    await expect(page.getByText('Upload a vendor invoice')).toBeVisible();
  });

  test('review table renders without crashing when API returns case-price fallback items', async ({ page }) => {
    await mockInvoiceScanFlow(page, [
      {
        name: 'Sliced Bacon 15/18 Count',
        unitPrice: 34.99,
        casePrice: 34.99,
        priceSource: 'case',
        unit: 'cs',
        categoryHint: 'Proteins',
        matchedItemId: null,
        matchedItemName: null,
        matchConfidence: 'none',
      },
      {
        name: 'Mozzarella Cheese 5 Lb',
        unitPrice: 4.5,
        casePrice: 22.5,
        priceSource: 'unit',
        unit: 'lb',
        categoryHint: 'Dairy',
        matchedItemId: null,
        matchedItemName: null,
        matchConfidence: 'none',
      },
      {
        name: 'Unknown Unlisted Item',
        unitPrice: 0,
        casePrice: null,
        priceSource: 'zero',
        unit: null,
        categoryHint: null,
        matchedItemId: null,
        matchedItemName: null,
        matchConfidence: 'none',
      },
    ]);

    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);

    await setWizardStep(page, 3);
    await page.reload();
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('card-step-invoice-upload')).toBeVisible({ timeout: 5000 });

    // Intercept the file chooser so we can provide a dummy file without blocking
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId('button-upload-invoice').click(),
    ]);
    await fileChooser.setFiles({
      name: 'test-invoice.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    });

    // The review table should appear (the route intercepts bypass real AI call)
    await expect(page.getByTestId('card-step-invoice-review')).toBeVisible({ timeout: 10000 });

    // All item names should render without crashing
    await expect(page.getByText('Sliced Bacon 15/18 Count')).toBeVisible();
    await expect(page.getByText('Mozzarella Cheese 5 Lb')).toBeVisible();
    await expect(page.getByText('Unknown Unlisted Item')).toBeVisible();

    // The 'case price' badge should appear for the case-only item
    await expect(page.getByText('case price')).toBeVisible();

    // The Apply button should be present
    await expect(page.getByTestId('button-apply-invoice')).toBeVisible();

    // All 3 action selectors should be rendered
    const actionSelectors = page.locator('[data-testid^="select-action-"]');
    await expect(actionSelectors).toHaveCount(3);
  });

  test('review table — default actions: zero-price → skip, case-only → create', async ({ page }) => {
    await mockInvoiceScanFlow(page, [
      {
        name: 'Bacon Case Only',
        unitPrice: 34.99,
        casePrice: 34.99,
        priceSource: 'case',
        unit: 'cs',
        categoryHint: 'Proteins',
        matchedItemId: null,
        matchedItemName: null,
        matchConfidence: 'none',
      },
      {
        name: 'No Price Item',
        unitPrice: 0,
        casePrice: null,
        priceSource: 'zero',
        unit: null,
        categoryHint: null,
        matchedItemId: null,
        matchedItemName: null,
        matchConfidence: 'none',
      },
    ], null);

    await page.goto(`${BASE_URL}/onboarding/setup`);
    await page.waitForTimeout(1000);

    await setWizardStep(page, 3);
    await page.reload();
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('card-step-invoice-upload')).toBeVisible({ timeout: 5000 });

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId('button-upload-invoice').click(),
    ]);
    await fileChooser.setFiles({
      name: 'test-invoice.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    });

    await expect(page.getByTestId('card-step-invoice-review')).toBeVisible({ timeout: 10000 });

    // case-only item with no match → should default to 'create'
    const selector0 = page.getByTestId('select-action-0');
    await expect(selector0).toHaveValue('create');

    // zero-price item → should default to 'skip'
    const selector1 = page.getByTestId('select-action-1');
    await expect(selector1).toHaveValue('skip');
  });
});
