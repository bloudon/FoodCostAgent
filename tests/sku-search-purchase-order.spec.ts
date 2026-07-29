/**
 * Regression guard: SKU search in the purchase-order detail item picker.
 *
 * The misc-grocery item picker filters `inventoryItems` client-side against
 * `item.pluSku`.  If `pluSku` is ever renamed or the filter condition is
 * removed, users would get no results when they type a SKU — and these tests
 * would fail before that code ships.
 *
 * Strategy: mock every API route the page touches, navigate to /purchase-orders/new,
 * pick the "Misc Grocery" vendor (which switches the picker to inventory-items mode),
 * then exercise the search box with SKU strings.
 */

import { test, expect } from './test-helpers';

const BASE_URL = 'http://localhost:5000';

const STORE_ID  = 'store-sku-po-test';
const VENDOR_ID = 'vendor-misc-grocery-test';

const ITEMS = [
  { id: 'item-tomato',  name: 'Tomato Roma',        pluSku: 'TOM-001', unitId: 'u1', unitName: 'each', pricePerUnit: 1.5,  categoryId: null, categoryName: null },
  { id: 'item-cheese',  name: 'Cheese Mozzarella',   pluSku: 'CHZ-999', unitId: 'u2', unitName: 'lb',   pricePerUnit: 4.0,  categoryId: null, categoryName: null },
  { id: 'item-nosku',   name: 'Salt Fine',            pluSku: null,      unitId: 'u3', unitName: 'kg',   pricePerUnit: 0.8,  categoryId: null, categoryName: null },
];

test.describe('Purchase order detail — SKU search in Misc Grocery item picker', () => {
  test.beforeEach(async ({ page }) => {
    // --- Auth ---
    await page.route('**/api/auth/me', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user',
          email: 'admin@brians.pizza',
          companyId: 'test-company',
          companyName: "Brian's Pizza",
          role: 'company_admin',
          firstName: 'Test',
          lastName: 'User',
          active: 1,
          subscriptionTier: 'pro',
        }),
      })
    );

    // --- Onboarding (global query consumed by layout) ---
    await page.route('**/api/onboarding/milestones', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dismissed: true, milestones: [] }) })
    );

    // --- Stores (useAccessibleStores → /api/stores/accessible) ---
    await page.route('**/api/stores/accessible', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: STORE_ID, name: "Brian's Main", companyId: 'test-company',
          address: null, city: null, state: null, zip: null,
          phone: null, tccLocationId: null, status: 'active',
        }]),
      })
    );

    // --- /api/stores (some sub-routes may be called; let the non-sub route return the same list) ---
    await page.route('**/api/stores', route => {
      if (route.request().url().includes('/api/stores/')) return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: STORE_ID, name: "Brian's Main" }]),
      });
    });

    // --- Vendors ---
    await page.route('**/api/vendors', route => {
      if (route.request().url().includes('/api/vendors/')) return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: VENDOR_ID, name: 'Misc Grocery',
          accountNumber: null, phone: null, website: null,
        }]),
      });
    });

    // --- Categories ---
    await page.route('**/api/categories', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    // --- Inventory items for Misc Grocery mode ---
    await page.route(`**/api/inventory-items**`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ITEMS),
      })
    );

    // --- Receipts / usage (enabled once store is known) ---
    await page.route('**/api/receipts**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await page.route(`**/api/stores/${STORE_ID}/usage`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
  });

  test('typing a PLU/SKU surfaces only the matching item', async ({ page }) => {
    await page.goto(`${BASE_URL}/purchase-orders/new`);

    // With a single store the page auto-selects it; wait for the vendor select to become interactive.
    const vendorSelect = page.getByTestId('select-vendor');
    await expect(vendorSelect).toBeEnabled({ timeout: 8000 });

    // Open the vendor dropdown and pick "Misc Grocery"
    await vendorSelect.click();
    await page.getByRole('option', { name: 'Misc Grocery' }).click();

    // The search input appears once a vendor is selected
    const searchInput = page.getByTestId('input-search-items');
    await expect(searchInput).toBeVisible({ timeout: 8000 });

    // All three items should initially be visible
    await expect(page.getByText('Tomato Roma')).toBeVisible();
    await expect(page.getByText('Cheese Mozzarella')).toBeVisible();
    await expect(page.getByText('Salt Fine')).toBeVisible();

    // Type the SKU for Tomato Roma
    await searchInput.fill('TOM-001');

    // Tomato Roma must appear; the others must not
    await expect(page.getByText('Tomato Roma')).toBeVisible();
    await expect(page.getByText('Cheese Mozzarella')).not.toBeVisible();
    await expect(page.getByText('Salt Fine')).not.toBeVisible();
  });

  test('clearing the SKU search restores all items', async ({ page }) => {
    await page.goto(`${BASE_URL}/purchase-orders/new`);

    const vendorSelect = page.getByTestId('select-vendor');
    await expect(vendorSelect).toBeEnabled({ timeout: 8000 });
    await vendorSelect.click();
    await page.getByRole('option', { name: 'Misc Grocery' }).click();

    const searchInput = page.getByTestId('input-search-items');
    await expect(searchInput).toBeVisible({ timeout: 8000 });

    // Filter to one item, then clear
    await searchInput.fill('CHZ-999');
    await expect(page.getByText('Cheese Mozzarella')).toBeVisible();
    await expect(page.getByText('Tomato Roma')).not.toBeVisible();

    await searchInput.fill('');

    // All items restored
    await expect(page.getByText('Tomato Roma')).toBeVisible();
    await expect(page.getByText('Cheese Mozzarella')).toBeVisible();
    await expect(page.getByText('Salt Fine')).toBeVisible();
  });

  test('name search still works alongside SKU search', async ({ page }) => {
    await page.goto(`${BASE_URL}/purchase-orders/new`);

    const vendorSelect = page.getByTestId('select-vendor');
    await expect(vendorSelect).toBeEnabled({ timeout: 8000 });
    await vendorSelect.click();
    await page.getByRole('option', { name: 'Misc Grocery' }).click();

    const searchInput = page.getByTestId('input-search-items');
    await expect(searchInput).toBeVisible({ timeout: 8000 });

    // Search by name fragment instead of SKU
    await searchInput.fill('cheese');

    await expect(page.getByText('Cheese Mozzarella')).toBeVisible();
    await expect(page.getByText('Tomato Roma')).not.toBeVisible();
    await expect(page.getByText('Salt Fine')).not.toBeVisible();
  });

  test('item without a pluSku is still findable by name when SKU is not the search term', async ({ page }) => {
    await page.goto(`${BASE_URL}/purchase-orders/new`);

    const vendorSelect = page.getByTestId('select-vendor');
    await expect(vendorSelect).toBeEnabled({ timeout: 8000 });
    await vendorSelect.click();
    await page.getByRole('option', { name: 'Misc Grocery' }).click();

    const searchInput = page.getByTestId('input-search-items');
    await expect(searchInput).toBeVisible({ timeout: 8000 });

    // Salt Fine has no pluSku; searching by name should still work
    await searchInput.fill('salt');

    await expect(page.getByText('Salt Fine')).toBeVisible();
    await expect(page.getByText('Tomato Roma')).not.toBeVisible();
    await expect(page.getByText('Cheese Mozzarella')).not.toBeVisible();
  });
});
