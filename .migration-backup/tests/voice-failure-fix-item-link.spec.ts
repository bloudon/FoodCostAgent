/**
 * Playwright tests for the "Fix item name" link on unresolved voice failure rows.
 *
 * Flow under test:
 *   1. Open the waste-entry page as a manager-role user.
 *   2. Expand the Voice Interpretation Failures panel.
 *   3. Click the "Fix item name" link on an unresolved row.
 *   4. Verify the inventory-item create form opens with the `name` field
 *      pre-filled to the exact spoken item string from the failure row.
 *
 * Test IDs used:
 *   link-fix-item-{i}   — anchors on each unresolved row
 *   input-name          — name field on the create form
 *   text-create-title   — heading on the create form (confirms page loaded)
 */

import { test, expect } from './test-helpers';

const BASE_URL = 'http://localhost:5000';

/** Minimal shell stubs shared by every test in this file. */
async function mockWasteEntryShell(page: Parameters<typeof test>[1] extends { page: infer P } ? P : never) {
  // Auth – store_manager role satisfies canSeeVoiceFailures
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-id',
        email: 'manager@example.com',
        companyId: 'test-company-id',
        companyName: 'Test Co',
        role: 'store_manager',
        firstName: 'Test',
        lastName: 'Manager',
        active: 1,
        subscriptionPlan: 'platform',
      }),
    }),
  );

  // Accessible stores (used by useAccessibleStores hook in waste-entry)
  await page.route('**/api/stores/accessible', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'store-1', name: 'Main Street', companyId: 'test-company-id' }]),
    }),
  );

  // Catch-all for other /api/stores requests that inventory-item-create may fire
  await page.route('**/api/stores', (route) => {
    if (!route.request().url().includes('/api/stores/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'store-1', name: 'Main Street' }]),
      });
    }
    return route.continue();
  });

  // Onboarding milestones (prevents banner errors)
  await page.route('**/api/onboarding/milestones', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dismissed: true, milestones: [] }),
    }),
  );

  // Categories (used in waste-entry and create form)
  await page.route('**/api/categories', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // Units (used in waste-entry and create form)
  await page.route('**/api/units*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // Waste logs (empty — we just need the page to render)
  await page.route('**/api/waste*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // System preferences (used by inventory-item-create)
  await page.route('**/api/system-preferences', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ unitSystem: 'imperial' }),
    }),
  );

  // Storage locations (used by inventory-item-create)
  await page.route('**/api/storage-locations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'loc-1', name: 'Walk-in Cooler', sortOrder: 1 }]),
    }),
  );

  // Inventory items (used by inventory-item-create)
  await page.route('**/api/inventory-items*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

// ---------------------------------------------------------------------------
// Suite: Fix item name link — basic navigation and pre-fill
// ---------------------------------------------------------------------------

test.describe('Fix item name link from voice failures panel', () => {
  test('clicking the link opens the create form with the spoken item name pre-filled', async ({ page }) => {
    await mockWasteEntryShell(page);

    const spokenItem = 'Chicken Thighs';

    await page.route('**/api/reports/voice-interpret-failures*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          days: 30,
          rows: [
            {
              spoken_item: spokenItem,
              resolution_status: 'unresolved',
              occurrences: 3,
              avg_score: 0,
              last_seen_at: '2026-07-28T10:00:00Z',
              matched_item_id: null,
            },
          ],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/waste`);

    // The panel header must be visible before we try to click it
    await expect(
      page.getByText('Voice Interpretation Failures'),
    ).toBeVisible({ timeout: 8000 });

    // Expand the failures panel
    await page.getByText('Voice Interpretation Failures').click();

    // Wait for the unresolved row to appear
    await expect(page.getByTestId('link-fix-item-0')).toBeVisible({ timeout: 8000 });

    // Verify the link text and href before clicking
    const link = page.getByTestId('link-fix-item-0');
    await expect(link).toContainText('Fix item name');
    const href = await link.getAttribute('href');
    expect(href).toContain('/inventory-items/new');
    expect(href).toContain(encodeURIComponent(spokenItem));

    // Click the link — navigates within the SPA
    await link.click();

    // The create form heading should appear
    await expect(page.getByTestId('text-create-title')).toBeVisible({ timeout: 8000 });

    // The name field must be pre-filled with the spoken item
    await expect(page.getByTestId('input-name')).toHaveValue(spokenItem);
  });

  test('name is URL-decoded correctly when the spoken item contains special characters', async ({ page }) => {
    await mockWasteEntryShell(page);

    const spokenItem = 'Jalapeño & Cheese Mix';

    await page.route('**/api/reports/voice-interpret-failures*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          days: 30,
          rows: [
            {
              spoken_item: spokenItem,
              resolution_status: 'unresolved',
              occurrences: 1,
              avg_score: 0,
              last_seen_at: '2026-07-28T10:00:00Z',
              matched_item_id: null,
            },
          ],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/waste`);

    await expect(
      page.getByText('Voice Interpretation Failures'),
    ).toBeVisible({ timeout: 8000 });

    await page.getByText('Voice Interpretation Failures').click();

    await expect(page.getByTestId('link-fix-item-0')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('link-fix-item-0').click();

    await expect(page.getByTestId('text-create-title')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('input-name')).toHaveValue(spokenItem);
  });

  test('correct row link is used when there are multiple unresolved rows', async ({ page }) => {
    await mockWasteEntryShell(page);

    const firstItem = 'Beef Brisket';
    const secondItem = 'Pork Shoulder';

    await page.route('**/api/reports/voice-interpret-failures*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          days: 30,
          rows: [
            {
              spoken_item: firstItem,
              resolution_status: 'unresolved',
              occurrences: 5,
              avg_score: 0,
              last_seen_at: '2026-07-28T10:00:00Z',
              matched_item_id: null,
            },
            {
              spoken_item: secondItem,
              resolution_status: 'unresolved',
              occurrences: 2,
              avg_score: 0,
              last_seen_at: '2026-07-27T09:00:00Z',
              matched_item_id: null,
            },
          ],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/waste`);

    await expect(
      page.getByText('Voice Interpretation Failures'),
    ).toBeVisible({ timeout: 8000 });

    await page.getByText('Voice Interpretation Failures').click();

    // Both links must be present
    await expect(page.getByTestId('link-fix-item-0')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('link-fix-item-1')).toBeVisible({ timeout: 8000 });

    // Click the second row's link
    await page.getByTestId('link-fix-item-1').click();

    await expect(page.getByTestId('text-create-title')).toBeVisible({ timeout: 8000 });
    // Must be pre-filled with the SECOND row's spoken item, not the first
    await expect(page.getByTestId('input-name')).toHaveValue(secondItem);
  });
});
