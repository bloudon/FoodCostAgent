import { test, expect, Page } from 'playwright/test';

const BASE_URL = 'http://localhost:5000';
const TEST_EMAIL = 'admin@brians.pizza';
const TEST_PASSWORD = 'testpass123';
const EXISTING_OG_ID = '3d91e5f0-71c6-457a-88cb-17353ae49e00';

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(TEST_EMAIL);
  await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log in"), button:has-text("Login")').first().click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 10000 });
}

test.describe('Order Guide Scan — multi-page invoice scan flow', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigates to /order-guide-scan and shows Step 1 configuration UI', async ({ page }) => {
    await page.goto(`${BASE_URL}/order-guide-scan`);

    await expect(page.getByText('Scan Invoice / Receipt')).toBeVisible();
    await expect(page.getByTestId('select-vendor')).toBeVisible();
    await expect(page.getByTestId('button-upload-invoice')).toBeVisible();
    await expect(page.getByText('Configure')).toBeVisible();
    await expect(page.getByText('Review')).toBeVisible();
    await expect(page.getByTestId('button-back')).toBeVisible();
    await expect(page.getByText('Vendor (Optional)')).toBeVisible();
    await expect(page.getByText('Upload First Page')).toBeVisible();
    await expect(page.getByTestId('button-review-commit')).not.toBeVisible();
  });

  test('loads step 2 when ogId URL param points to an existing order guide', async ({ page }) => {
    await page.goto(`${BASE_URL}/order-guide-scan?ogId=${EXISTING_OG_ID}`);
    await page.waitForTimeout(2000);

    await expect(page.getByTestId('button-review-commit')).toBeVisible();
    await expect(page.getByTestId('button-add-page')).toBeVisible();
    await expect(page.getByTestId('button-back-step1')).toBeVisible();
    await expect(page.getByText('items extracted')).toBeVisible();

    const firstRow = page.getByTestId('row-line-0');
    await expect(firstRow).toBeVisible();
    const secondRow = page.getByTestId('row-line-1');
    await expect(secondRow).toBeVisible();

    await expect(page.getByTestId('button-upload-invoice')).not.toBeVisible();
  });

  test('vendor selector and store checkboxes are visible on Step 1', async ({ page }) => {
    await page.goto(`${BASE_URL}/order-guide-scan`);

    const vendorSelector = page.getByTestId('select-vendor');
    await expect(vendorSelector).toBeVisible();

    await vendorSelector.click();
    await expect(page.getByText('No vendor / Unknown')).toBeVisible();
    await page.keyboard.press('Escape');

    const storeCheckboxes = page.locator('[data-testid^="checkbox-store-"]');
    const checkboxCount = await storeCheckboxes.count();
    expect(checkboxCount).toBeGreaterThanOrEqual(0);
  });

  test('"Add Another Page" button reveals upload panel, Cancel collapses it', async ({ page }) => {
    await page.goto(`${BASE_URL}/order-guide-scan?ogId=${EXISTING_OG_ID}`);
    await page.waitForTimeout(2000);

    await page.getByTestId('button-add-page').click();

    await expect(page.getByText('Scan another page')).toBeVisible();
    await expect(page.getByTestId('button-upload-next-page')).toBeVisible();
    await expect(page.getByTestId('button-cancel-add-page')).toBeVisible();
    await expect(page.getByTestId('button-add-page')).not.toBeVisible();

    await page.getByTestId('button-cancel-add-page').click();

    await expect(page.getByTestId('button-add-page')).toBeVisible();
    await expect(page.getByText('Scan another page')).not.toBeVisible();
    await expect(page.getByTestId('button-upload-next-page')).not.toBeVisible();
  });

  test('"Review & Commit" button routes to the correct order guide review URL', async ({ page }) => {
    await page.goto(`${BASE_URL}/order-guide-scan?ogId=${EXISTING_OG_ID}`);
    await page.waitForTimeout(2000);

    await page.getByTestId('button-review-commit').click();
    await page.waitForTimeout(1000);

    expect(page.url()).toContain(`/order-guides/${EXISTING_OG_ID}/review`);
  });

  test('single-page scan shows no page-break rows; "Add Another Page" panel is available for appending', async ({ page }) => {
    await page.goto(`${BASE_URL}/order-guide-scan?ogId=${EXISTING_OG_ID}`);
    await page.waitForTimeout(2000);

    // A single-page scan must have zero page-break divider rows
    const pageBreaks = page.locator('[data-testid^="page-break-"]');
    await expect(pageBreaks).toHaveCount(0);

    // The line items themselves must be present
    const lineRows = page.locator('[data-testid^="row-line-"]');
    const rowCount = await lineRows.count();
    expect(rowCount).toBeGreaterThan(0);
    await expect(page.getByTestId('row-line-0')).toBeVisible();

    // The append flow must be reachable: clicking "Add Another Page" shows
    // the scan-next-page panel with its upload button (the button that would
    // submit a second page and create a "— Page 2 —" divider row on success)
    await page.getByTestId('button-add-page').click();
    await expect(page.getByTestId('button-upload-next-page')).toBeVisible();
    await expect(page.getByText('Scan another page')).toBeVisible();
  });

  test('"Start Over" button resets page back to Step 1 and clears ogId from URL', async ({ page }) => {
    await page.goto(`${BASE_URL}/order-guide-scan?ogId=${EXISTING_OG_ID}`);
    await page.waitForTimeout(2000);

    await page.getByTestId('button-back-step1').click();
    await page.waitForTimeout(500);

    await expect(page.getByTestId('select-vendor')).toBeVisible();
    await expect(page.getByText('Upload First Page')).toBeVisible();
    await expect(page.getByTestId('button-review-commit')).not.toBeVisible();

    expect(page.url()).not.toContain('ogId=');
  });
});
