/**
 * Automated tests for pack size mismatch detection in the order guide review flow.
 *
 * These tests cover three distinct layers:
 *
 * Suite 1 — `hasPackSizeMismatch` helper logic (UI, mocked API)
 *   Verifies the amber warning icon (`icon-packsize-mismatch-*`) and section banner
 *   (`banner-matched-pack-size-mismatch`, `banner-ambiguous-pack-size-mismatch`)
 *   appear or hide correctly for each scenario:
 *     • caseSize mismatch → icon + banner shown
 *     • innerPack mismatch only → icon + banner shown
 *     • caseSize + innerPack both changed → icon + banner shown
 *     • sizes are identical → no icon, no banner
 *     • storedCaseSize is null (new item, no prior vendor record) → no icon
 *     • floating-point values within ±0.001 tolerance → no mismatch
 *     • floating-point values just outside tolerance → mismatch shown
 *
 * Suite 2 — Mismatch banner in the Ambiguous tab (mocked API)
 *   Ensures the ambiguous-tab banner appears when an ambiguous line has a mismatch.
 *
 * Suite 3 — `GET /api/order-guides/:id/review` endpoint contract (API-level)
 *   • 401 when called without a session
 *   • 404 for a non-existent guide ID
 *   • 200 with the correct storedCaseSize / storedInnerPackSize fields when the
 *     logged-in company owns an order guide (uses EXISTING_OG_ID from dev DB)
 *
 * Prerequisites (dev database):
 *   Email: admin@brians.pizza  /  Password: test123
 *   Order guide ID: 3d91e5f0-71c6-457a-88cb-17353ae49e00 (must exist in dev DB)
 */

import { test, expect, mockReviewPageShell, type Page, type APIRequestContext } from './test-helpers';

const BASE_URL        = 'http://localhost:5000';
const TEST_EMAIL      = 'admin@brians.pizza';
const TEST_PASSWORD   = 'test123';
const FAKE_OG_ID      = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const EXISTING_OG_ID  = '3d91e5f0-71c6-457a-88cb-17353ae49e00';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function loginCookie(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status(), 'Login should succeed').toBe(200);
}

/**
 * Builds a minimal ReviewData payload for the mock API.
 * `matched` and `ambiguous` are arrays of partial OrderGuideLine objects;
 * only the fields relevant to pack size mismatch are required.
 */
function buildReviewResponse(opts: {
  matched?: Array<{
    id: string;
    caseSize?: number | null;
    innerPack?: number | null;
    storedCaseSize?: number | null;
    storedInnerPackSize?: number | null;
    matchedInventoryItemId?: string | null;
  }>;
  ambiguous?: Array<{
    id: string;
    caseSize?: number | null;
    innerPack?: number | null;
    storedCaseSize?: number | null;
    storedInnerPackSize?: number | null;
    matchedInventoryItemId?: string | null;
  }>;
  newItems?: Array<{ id: string }>;
}): string {
  const makeLine = (l: {
    id: string;
    caseSize?: number | null;
    innerPack?: number | null;
    storedCaseSize?: number | null;
    storedInnerPackSize?: number | null;
    matchedInventoryItemId?: string | null;
    matchStatus?: string;
  }) => ({
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
    matchStatus: l.matchStatus ?? 'matched',
    matchedInventoryItemId: l.matchedInventoryItemId ?? 'inv-item-1',
    matchedInventoryItemName: 'Test Item',
    matchConfidence: 0.9,
    storedCaseSize: l.storedCaseSize ?? null,
    storedInnerPackSize: l.storedInnerPackSize ?? null,
  });

  const matched = (opts.matched ?? []).map(l => makeLine({ ...l, matchStatus: 'matched' }));
  const ambiguous = (opts.ambiguous ?? []).map(l => makeLine({ ...l, matchStatus: 'ambiguous' }));
  const newLines = (opts.newItems ?? []).map(l => ({
    id: l.id,
    vendorSku: `SKU-${l.id}`,
    productName: `Product ${l.id}`,
    packSize: null,
    uom: 'LB',
    caseSize: 6,
    caseSizeRaw: '6',
    innerPack: 1,
    price: 10.00,
    priceSource: 'case',
    matchStatus: 'new',
    matchedInventoryItemId: null,
    matchedInventoryItemName: null,
    matchConfidence: null,
    storedCaseSize: null,
    storedInnerPackSize: null,
  }));

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
// Suite 1: hasPackSizeMismatch helper — matched-tab scenarios (mocked UI)
// ---------------------------------------------------------------------------

test.describe('hasPackSizeMismatch — matched tab scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await mockReviewPageShell(page);
  });

  test('shows mismatch icon and banner when caseSize differs from stored value', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'line-1', caseSize: 6, storedCaseSize: 4, storedInnerPackSize: null }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-pack-size-mismatch')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-line-1')).toBeVisible();
  });

  test('shows mismatch icon and banner when only innerPack differs from stored value', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'line-2', caseSize: 6, innerPack: 5, storedCaseSize: 6, storedInnerPackSize: 3 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-pack-size-mismatch')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-line-2')).toBeVisible();
  });

  test('shows mismatch icon and banner when both caseSize and innerPack have changed', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'line-3', caseSize: 12, innerPack: 6, storedCaseSize: 6, storedInnerPackSize: 3 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-pack-size-mismatch')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-line-3')).toBeVisible();
  });

  test('hides mismatch icon and banner when imported sizes match stored sizes exactly', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'line-4', caseSize: 6, innerPack: 1, storedCaseSize: 6, storedInnerPackSize: 1 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-pack-size-mismatch')).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-line-4')).not.toBeVisible();
  });

  test('hides mismatch icon when storedCaseSize is null (no prior vendor item record)', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'line-5', caseSize: 6, storedCaseSize: null, storedInnerPackSize: null }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-pack-size-mismatch')).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-line-5')).not.toBeVisible();
  });

  test('hides mismatch icon when values are within the 0.001 floating-point tolerance', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          // 6.0 vs 6.0005 is within ±0.001 → should NOT trigger mismatch
          matched: [{ id: 'line-6', caseSize: 6.0005, innerPack: 1, storedCaseSize: 6.0, storedInnerPackSize: 1 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-pack-size-mismatch')).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-line-6')).not.toBeVisible();
  });

  test('shows mismatch icon when values differ by more than the 0.001 floating-point tolerance', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          // 6.0 vs 6.002 exceeds ±0.001 → must trigger mismatch
          matched: [{ id: 'line-7', caseSize: 6.002, innerPack: 1, storedCaseSize: 6.0, storedInnerPackSize: 1 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-pack-size-mismatch')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-line-7')).toBeVisible();
  });

  test('treats null storedInnerPackSize as 1 when comparing against imported innerPack of 1 (no mismatch)', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          // storedInnerPackSize null → defaults to 1; imported innerPack 1 → equal, no mismatch
          matched: [{ id: 'line-8', caseSize: 6, innerPack: 1, storedCaseSize: 6, storedInnerPackSize: null }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    await expect(page.getByTestId('banner-matched-pack-size-mismatch')).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-line-8')).not.toBeVisible();
  });

  test('mismatch banner counts correctly when multiple matched lines have mismatches', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [
            { id: 'line-9a', caseSize: 6, storedCaseSize: 4, storedInnerPackSize: null },
            { id: 'line-9b', caseSize: 12, storedCaseSize: 6, storedInnerPackSize: null },
            { id: 'line-9c', caseSize: 6, storedCaseSize: 6, storedInnerPackSize: 1 },
          ],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    const banner = page.getByTestId('banner-matched-pack-size-mismatch');
    await expect(banner).toBeVisible({ timeout: 8000 });
    // Two of the three lines have mismatches
    await expect(banner).toContainText('2 pack size changes');
    await expect(page.getByTestId('icon-packsize-mismatch-line-9a')).toBeVisible();
    await expect(page.getByTestId('icon-packsize-mismatch-line-9b')).toBeVisible();
    await expect(page.getByTestId('icon-packsize-mismatch-line-9c')).not.toBeVisible();
  });

  test('banner uses singular "change" when exactly one mismatch is detected', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          matched: [{ id: 'line-10', caseSize: 6, storedCaseSize: 4, storedInnerPackSize: null }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);

    const banner = page.getByTestId('banner-matched-pack-size-mismatch');
    await expect(banner).toBeVisible({ timeout: 8000 });
    await expect(banner).toContainText('1 pack size change detected');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: hasPackSizeMismatch — ambiguous tab scenarios (mocked UI)
// ---------------------------------------------------------------------------

test.describe('hasPackSizeMismatch — ambiguous tab scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await mockReviewPageShell(page);
  });

  test('shows ambiguous-tab mismatch banner when an ambiguous line has a size change', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          ambiguous: [{ id: 'amb-1', caseSize: 12, innerPack: 1, storedCaseSize: 6, storedInnerPackSize: null }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    // Switch to ambiguous tab
    await page.getByRole('tab', { name: /needs review/i }).click();

    await expect(page.getByTestId('banner-ambiguous-pack-size-mismatch')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-amb-1')).toBeVisible();
  });

  test('hides ambiguous-tab mismatch banner when ambiguous line sizes are identical', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          ambiguous: [{ id: 'amb-2', caseSize: 6, innerPack: 1, storedCaseSize: 6, storedInnerPackSize: 1 }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /needs review/i }).click();

    await expect(page.getByTestId('banner-ambiguous-pack-size-mismatch')).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-amb-2')).not.toBeVisible();
  });

  test('hides ambiguous-tab mismatch banner when no prior vendor item exists (null stored sizes)', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          ambiguous: [{ id: 'amb-3', caseSize: 6, innerPack: 1, storedCaseSize: null, storedInnerPackSize: null }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /needs review/i }).click();

    await expect(page.getByTestId('banner-ambiguous-pack-size-mismatch')).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-amb-3')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: New-item lines never show mismatch (mocked UI)
// ---------------------------------------------------------------------------

test.describe('hasPackSizeMismatch — new item lines', () => {
  test.beforeEach(async ({ page }) => {
    await mockReviewPageShell(page);
  });

  test('new item lines always have null storedCaseSize and never show a mismatch icon', async ({ page }) => {
    await page.route(`**/api/order-guides/${FAKE_OG_ID}/review`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: buildReviewResponse({
          newItems: [{ id: 'new-1' }, { id: 'new-2' }],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/order-guides/${FAKE_OG_ID}/review`);
    await page.getByRole('tab', { name: /new items/i }).click();

    // No mismatch icons should exist for new-item lines
    await expect(page.getByTestId('icon-packsize-mismatch-new-1')).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('icon-packsize-mismatch-new-2')).not.toBeVisible();
    // No mismatch banners on matched or ambiguous tabs either
    await expect(page.getByTestId('banner-matched-pack-size-mismatch')).not.toBeVisible();
    await expect(page.getByTestId('banner-ambiguous-pack-size-mismatch')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: GET /api/order-guides/:id/review — endpoint contract (API-level)
// ---------------------------------------------------------------------------

test.describe('GET /api/order-guides/:id/review — endpoint contract', () => {
  test('returns 401 when called without a session', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/order-guides/${FAKE_OG_ID}/review`);
    expect(res.status(), 'Unauthenticated request must return 401').toBe(401);
  });

  test('returns 404 for a non-existent guide ID when authenticated', async ({ request }) => {
    const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    if (loginRes.status() !== 200) {
      test.skip(true, 'Could not log in as test user — skipping auth-required test');
      return;
    }

    const res = await request.get(`${BASE_URL}/api/order-guides/${FAKE_OG_ID}/review`);
    expect(res.status(), `Expected 404 for unknown guide, got ${res.status()}`).toBe(404);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('Order guide not found');
  });

  test('returns 200 with storedCaseSize and storedInnerPackSize fields for a real guide', async ({ request }) => {
    const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    if (loginRes.status() !== 200) {
      test.skip(true, 'Could not log in as test user — skipping integration test');
      return;
    }

    const res = await request.get(`${BASE_URL}/api/order-guides/${EXISTING_OG_ID}/review`);
    if (res.status() === 404) {
      test.skip(true, `Order guide ${EXISTING_OG_ID} not found in dev DB — skipping integration test`);
      return;
    }

    expect(res.status(), `Expected 200, got ${res.status()}`).toBe(200);

    type LineShape = {
      id: string;
      storedCaseSize: number | null;
      storedInnerPackSize: number | null;
      matchStatus: string;
    };
    type ReviewShape = {
      guide: { id: string; vendorId: string | null };
      lines: { matched: LineShape[]; ambiguous: LineShape[]; new: LineShape[] };
      summary: { total: number; matched: number; ambiguous: number; new: number };
    };

    const body = await res.json() as ReviewShape;

    expect(body.guide, 'Response must include a guide object').toBeDefined();
    expect(body.lines, 'Response must include a lines object').toBeDefined();
    expect(body.summary, 'Response must include a summary object').toBeDefined();

    // Every line (matched, ambiguous, new) must expose storedCaseSize and storedInnerPackSize,
    // even if they are null.  Missing fields would break the hasPackSizeMismatch helper.
    const allLines: LineShape[] = [
      ...body.lines.matched,
      ...body.lines.ambiguous,
      ...body.lines.new,
    ];

    expect(allLines.length, 'Guide must have at least one line for field-shape verification').toBeGreaterThan(0);

    for (const line of allLines) {
      expect(
        Object.prototype.hasOwnProperty.call(line, 'storedCaseSize'),
        `Line ${line.id} must have storedCaseSize field`,
      ).toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(line, 'storedInnerPackSize'),
        `Line ${line.id} must have storedInnerPackSize field`,
      ).toBe(true);
    }
  });

  test('storedCaseSize is null for matched lines when the guide has no vendor assigned', async ({ request }) => {
    const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    if (loginRes.status() !== 200) {
      test.skip(true, 'Could not log in as test user — skipping integration test');
      return;
    }

    const res = await request.get(`${BASE_URL}/api/order-guides/${EXISTING_OG_ID}/review`);
    if (res.status() !== 200) {
      test.skip(true, 'Could not fetch order guide — skipping vendor-null test');
      return;
    }

    type ReviewShape = {
      guide: { vendorId: string | null };
      lines: {
        matched: Array<{ id: string; storedCaseSize: number | null }>;
      };
    };

    const body = await res.json() as ReviewShape;

    // When no vendor is assigned to the guide, storedCaseSize must be null on every
    // matched line — the processor must not compare against vendor items of the wrong vendor.
    if (body.guide.vendorId === null && body.lines.matched.length > 0) {
      for (const line of body.lines.matched) {
        expect(
          line.storedCaseSize,
          `storedCaseSize must be null for matched line ${line.id} when guide has no vendor`,
        ).toBeNull();
      }
    } else {
      // Guide has a vendor assigned — this particular contract test doesn't apply.
      test.skip(true, 'Dev guide has a vendor assigned; null-vendor contract test is not applicable here');
    }
  });
});
