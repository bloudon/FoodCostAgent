/**
 * Automated tests for name-count suspicious banner detection in the order guide review flow.
 *
 * The UI flags lines where the count embedded in the product name differs from the CSV
 * case-size by more than 5×.  That magnitude almost certainly means the two numbers
 * are measuring different things (e.g. the name encodes individual oz while the CSV
 * case-size shows the number of items in the case).
 *
 * Three test suites cover the behaviour by tab (matched / ambiguous / new), plus two
 * suites dedicated to the marker element (`marker-namecount-suspicious-*`) and dismissal.
 *
 * Suspicious ratio definition:
 *   Math.max(nameCount / caseSize, caseSize / nameCount) > 5
 *
 * Key test IDs used:
 *   banner-matched-name-count-suspicious
 *   banner-ambiguous-name-count-suspicious
 *   banner-new-name-count-suspicious
 *   marker-namecount-suspicious-{lineId}   ← sr-only span, checked with toBeAttached()
 *   button-dismiss-name-count-{lineId}
 *   row-product-{lineId}
 *
 * Mocking pattern mirrors tests/order-guide-pack-size-mismatch.spec.ts.
 */

import { test, expect, Page } from 'playwright/test';

const BASE_URL   = 'http://localhost:5000';
const TEST_EMAIL = 'admin@brians.pizza';
const FAKE_OG_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

async function mockReviewPageShell(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-id',
        email: TEST_EMAIL,
        companyId: 'test-company-id',
        companyName: "Brian's Pizza",
        role: 'company_admin',
        firstName: 'Test',
        lastName: 'User',
        active: 1,
        subscriptionTier: 'pro',
      }),
    }),
  );

  await page.route('**/api/stores', (route) => {
    if (!route.request().url().includes('/api/stores/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'store-1', name: "Brian's Main" }]),
      });
    }
    return route.continue();
  });

  await page.route('**/api/onboarding/milestones', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dismissed: true, milestones: [] }),
    }),
  );

  await page.route('**/api/categories', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  await page.route('**/api/vendors', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'vendor-1', name: 'Sysco' }]),
    }),
  );
}

interface LineSeed {
  id: string;
  caseSize?: number | null;
  innerPack?: number | null;
  nameCount?: number | null;
  storedCaseSize?: number | null;
  storedInnerPackSize?: number | null;
}

function buildLine(l: LineSeed, matchStatus: string) {
  return {
    id: l.id,
    vendorSku: `SKU-${l.id}`,
    productName: `Product ${l.id}`,
    packSize: null,
    uom: 'LB',
    caseSize: l.caseSize ?? 6,
    caseSizeRaw: String(l.caseSize ?? 6),
    innerPack: l.innerPack ?? 1,
    price: 10.00,
    priceSource: 'case',
    matchStatus,
    matchedInventoryItemId: matchStatus !== 'new' ? 'inv-item-1' : null,
    matchedInventoryItemName: matchStatus !== 'new' ? 'Test Item' : null,
    matchConfidence: matchStatus !== 'new' ? 0.9 : null,
    storedCaseSize: l.storedCaseSize ?? null,
    storedInnerPackSize: l.storedInnerPackSize ?? null,
    nameCount: l.nameCount ?? null,
  };
}

function buildReviewResponse(opts: {
  matched?: LineSeed[];
  ambiguous?: LineSeed[];
  newItems?: LineSeed[];
}): string {
  const matched  = (opts.matched ?? []).map(l => buildLine(l, 'matched'));
  const ambiguous = (opts.ambiguous ?? []).map(l => buildLine(l, 'ambiguous'));
  const newLines  = (opts.newItems ?? []).map(l => buildLine(l, 'new'));

  return JSON.stringify({
    guide: {
      id: FAKE_OG_ID,
      fileName: 'test-invoice.pdf',
      rowCount: matched.length + ambiguous.length + newLines.length,
      status: 'pending_review',
      vendorId: 'vendor-1',
      source: 'scan',
      detectedVendorName: 'Sysco',
    },
    lines: { matched, ambiguous, new: newLines },
    summary: {
      total: matched.length + ambiguous.length + newLines.length,
      matched: matched.length,
      ambiguous: ambiguous.length,
      new: newLines.length,
    },
  });
}

// ---------------------------------------------------------------------------
// Suite 1: name-count suspicious banner — matched tab visibility
// ---------------------------------------------------------------------------

test.describe('name-count suspicious banner — matched tab', () => {
  test.beforeEach(async ({ page }) => {
    await mockReviewPageShell(page);
  });

  test('shows matched banner when nameCount / caseSize ratio exceeds 5×', async ({ page }) => {
    // nameCount=16, caseSize=2 → ratio = 8 > 5 → suspicious
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'nc-1', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-name-count-suspicious')).toBeVisible({ timeout: 8000 });
  });

  test('shows matched banner when caseSize / nameCount ratio exceeds 5× (inverted)', async ({ page }) => {
    // caseSize=30, nameCount=5 → ratio = 6 > 5 → suspicious
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'nc-2', caseSize: 30, nameCount: 5 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-name-count-suspicious')).toBeVisible({ timeout: 8000 });
  });

  test('hides matched banner when ratio is at the boundary (exactly 5× — not strictly greater)', async ({ page }) => {
    // nameCount=10, caseSize=2 → ratio = 5 — NOT > 5, so NOT suspicious
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'nc-3', caseSize: 2, nameCount: 10 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-name-count-suspicious')).not.toBeVisible({ timeout: 8000 });
  });

  test('hides matched banner when nameCount is null', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'nc-4', caseSize: 6, nameCount: null }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-name-count-suspicious')).not.toBeVisible({ timeout: 8000 });
  });

  test('hides matched banner when ratio is below 5× (clearly not suspicious)', async ({ page }) => {
    // nameCount=6, caseSize=3 → ratio = 2 → not suspicious
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'nc-5', caseSize: 3, nameCount: 6 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-name-count-suspicious')).not.toBeVisible({ timeout: 8000 });
  });

  test('banner uses singular "item has" when exactly 1 suspicious matched line', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'nc-6', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    const banner = page.getByTestId('banner-matched-name-count-suspicious');
    await expect(banner).toBeVisible({ timeout: 8000 });
    await expect(banner).toContainText('1 item has');
  });

  test('banner uses plural "items have" and correct count when multiple suspicious matched lines', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [
            { id: 'nc-7a', caseSize: 2, nameCount: 16 },  // suspicious
            { id: 'nc-7b', caseSize: 2, nameCount: 20 },  // suspicious
            { id: 'nc-7c', caseSize: 6, nameCount: 6 },   // not suspicious (ratio = 1)
          ],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    const banner = page.getByTestId('banner-matched-name-count-suspicious');
    await expect(banner).toBeVisible({ timeout: 8000 });
    await expect(banner).toContainText('2 items have');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: marker elements — present on flagged rows, absent on clean rows
// ---------------------------------------------------------------------------

test.describe('name-count marker elements — matched tab', () => {
  test.beforeEach(async ({ page }) => {
    await mockReviewPageShell(page);
  });

  test('marker is attached to the DOM on a suspicious row', async ({ page }) => {
    // The marker is sr-only (visually hidden) but must exist in the DOM as the scroll target.
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'mk-1', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-name-count-suspicious')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('marker-namecount-suspicious-mk-1')).toBeAttached();
  });

  test('marker is not in the DOM on a non-suspicious row', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'mk-2', caseSize: 6, nameCount: null }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    // Wait for the table to render
    await expect(page.getByTestId('row-product-mk-2')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('marker-namecount-suspicious-mk-2')).not.toBeAttached();
  });

  test('markers are present only on suspicious rows in a mixed list', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [
            { id: 'mk-3a', caseSize: 2, nameCount: 16 },  // suspicious → marker expected
            { id: 'mk-3b', caseSize: 6, nameCount: 6 },   // not suspicious → no marker
            { id: 'mk-3c', caseSize: 2, nameCount: 20 },  // suspicious → marker expected
          ],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-name-count-suspicious')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('marker-namecount-suspicious-mk-3a')).toBeAttached();
    await expect(page.getByTestId('marker-namecount-suspicious-mk-3b')).not.toBeAttached();
    await expect(page.getByTestId('marker-namecount-suspicious-mk-3c')).toBeAttached();
  });

  test('clicking the banner leaves the marker in the DOM (it is the scroll target)', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'mk-4', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    const banner = page.getByTestId('banner-matched-name-count-suspicious');
    await expect(banner).toBeVisible({ timeout: 8000 });

    // Clicking the banner triggers scroll-to behaviour but must NOT remove the marker.
    await banner.click();

    await expect(page.getByTestId('marker-namecount-suspicious-mk-4')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: dismissal removes the marker and updates the banner — matched tab
// ---------------------------------------------------------------------------

test.describe('name-count dismissal — matched tab', () => {
  test.beforeEach(async ({ page }) => {
    await mockReviewPageShell(page);
  });

  test('dismissing the hint removes the marker from the DOM', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'dm-1', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-name-count-suspicious')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('marker-namecount-suspicious-dm-1')).toBeAttached();

    await page.getByTestId('button-dismiss-name-count-dm-1').click();

    await expect(page.getByTestId('marker-namecount-suspicious-dm-1')).not.toBeAttached();
  });

  test('dismissing the only suspicious item hides the banner', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'dm-2', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-name-count-suspicious')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('button-dismiss-name-count-dm-2').click();

    await expect(page.getByTestId('banner-matched-name-count-suspicious')).not.toBeVisible();
  });

  test('dismissing one of two suspicious items decreases banner count to 1 and removes only that marker', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [
            { id: 'dm-3a', caseSize: 2, nameCount: 16 },
            { id: 'dm-3b', caseSize: 2, nameCount: 20 },
          ],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    const banner = page.getByTestId('banner-matched-name-count-suspicious');
    await expect(banner).toBeVisible({ timeout: 8000 });
    await expect(banner).toContainText('2 items have');

    await page.getByTestId('button-dismiss-name-count-dm-3a').click();

    // Banner now shows 1 item
    await expect(banner).toContainText('1 item has');
    // First marker gone; second marker still present
    await expect(page.getByTestId('marker-namecount-suspicious-dm-3a')).not.toBeAttached();
    await expect(page.getByTestId('marker-namecount-suspicious-dm-3b')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: name-count suspicious banner — ambiguous tab
// ---------------------------------------------------------------------------

test.describe('name-count suspicious banner — ambiguous tab', () => {
  test.beforeEach(async ({ page }) => {
    await mockReviewPageShell(page);
  });

  test('shows ambiguous banner when an ambiguous line has a suspicious ratio', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          ambiguous: [{ id: 'amb-nc-1', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /needs review/i }).click();

    await expect(page.getByTestId('banner-ambiguous-name-count-suspicious')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('marker-namecount-suspicious-amb-nc-1')).toBeAttached();
  });

  test('hides ambiguous banner when no ambiguous lines are suspicious', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          ambiguous: [{ id: 'amb-nc-2', caseSize: 6, nameCount: null }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /needs review/i }).click();

    await expect(page.getByTestId('banner-ambiguous-name-count-suspicious')).not.toBeVisible({ timeout: 8000 });
  });

  test('dismissing hint on ambiguous line removes marker and hides banner', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          ambiguous: [{ id: 'amb-nc-3', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /needs review/i }).click();

    await expect(page.getByTestId('banner-ambiguous-name-count-suspicious')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('button-dismiss-name-count-amb-nc-3').click();

    await expect(page.getByTestId('marker-namecount-suspicious-amb-nc-3')).not.toBeAttached();
    await expect(page.getByTestId('banner-ambiguous-name-count-suspicious')).not.toBeVisible();
  });

  test('clicking the ambiguous banner leaves the marker in the DOM', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          ambiguous: [{ id: 'amb-nc-4', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /needs review/i }).click();

    const banner = page.getByTestId('banner-ambiguous-name-count-suspicious');
    await expect(banner).toBeVisible({ timeout: 8000 });

    await banner.click();

    await expect(page.getByTestId('marker-namecount-suspicious-amb-nc-4')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: name-count suspicious banner — new items tab
// ---------------------------------------------------------------------------

test.describe('name-count suspicious banner — new items tab', () => {
  test.beforeEach(async ({ page }) => {
    await mockReviewPageShell(page);
  });

  test('shows new items banner when a new line has a suspicious ratio', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          newItems: [{ id: 'new-nc-1', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /new items/i }).click();

    await expect(page.getByTestId('banner-new-name-count-suspicious')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('marker-namecount-suspicious-new-nc-1')).toBeAttached();
  });

  test('hides new items banner when no new lines are suspicious', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          newItems: [{ id: 'new-nc-2', caseSize: 6, nameCount: null }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /new items/i }).click();

    await expect(page.getByTestId('banner-new-name-count-suspicious')).not.toBeVisible({ timeout: 8000 });
  });

  test('clicking the new items banner leaves the marker in the DOM as the scroll target', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          newItems: [{ id: 'new-nc-3', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /new items/i }).click();

    const banner = page.getByTestId('banner-new-name-count-suspicious');
    await expect(banner).toBeVisible({ timeout: 8000 });

    await banner.click();

    await expect(page.getByTestId('marker-namecount-suspicious-new-nc-3')).toBeAttached();
  });

  test('dismissing a new item hint removes marker and hides the banner', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          newItems: [{ id: 'new-nc-4', caseSize: 2, nameCount: 16 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /new items/i }).click();

    await expect(page.getByTestId('banner-new-name-count-suspicious')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('button-dismiss-name-count-new-nc-4').click();

    await expect(page.getByTestId('marker-namecount-suspicious-new-nc-4')).not.toBeAttached();
    await expect(page.getByTestId('banner-new-name-count-suspicious')).not.toBeVisible();
  });
});
