/**
 * Tests for GET /api/tfc/variance/top-item
 *
 * Verifies that the endpoint:
 *   1. Rejects unauthenticated requests (401)
 *   2. Returns 400 when storeId is missing
 *   3. Returns 403 when the storeId belongs to another company
 *   4. Returns a valid TopVarianceItem shape (or explicit null) when
 *      called by an authenticated pro-tier manager with 2+ applied counts
 *   5. When data is present, varianceCost > 0 (the card only appears for
 *      positive cost drivers — items with negative variance are excluded)
 *
 * Test data:
 *   Company A – Brian's Pizza   (ad95ecda-74a9-49d7-833b-6d7d2f48efd1)
 *     User:    admin@brians.pizza / test123    (company_admin, pro tier)
 *     Store B: 2c9272ed-8ccc-45f7-ab81-45504a87b7cb  (3 applied counts)
 *     Store A: 2765a568-d72f-46ab-b2f1-5b4f7fc31f5b  (3 applied counts)
 *
 *   Company B – The Breakfast Nook  (bn-company-0001)
 *     User:    ci-staff@breakfastnook.com / ci-pass-nook  (pro tier)
 *     Store:   ci-store-nook-001
 *
 * Cross-company isolation: Company A's session must not be able to query
 * Company B's stores, and vice versa.
 */

import { test, expect, APIRequestContext } from 'playwright/test';

const BASE_URL  = 'http://localhost:5000';

const COMPANY_A_EMAIL    = 'admin@brians.pizza';
const COMPANY_A_PASSWORD = 'test123';

// Store B has 3 applied counts — guaranteed to have enough data for the endpoint
const STORE_B_ID = '2c9272ed-8ccc-45f7-ab81-45504a87b7cb';
const STORE_A_ID = '2765a568-d72f-46ab-b2f1-5b4f7fc31f5b';

const COMPANY_B_EMAIL    = 'ci-staff@breakfastnook.com';
const COMPANY_B_PASSWORD = 'ci-pass-nook';
const COMPANY_B_STORE_ID = 'ci-store-nook-001';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function loginAs(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status(), `Login failed for ${email}`).toBe(200);

  const setCookie = res.headers()['set-cookie'] ?? '';
  const match     = setCookie.match(/session=([^;]+)/);
  expect(match, `No session cookie returned for ${email}`).not.toBeNull();
  return match![1];
}

function authHeader(token: string) {
  return { Cookie: `session=${token}` };
}

// ---------------------------------------------------------------------------
// Shape helper
// ---------------------------------------------------------------------------

interface TopVarianceItem {
  inventoryItemId:   string;
  inventoryItemName: string;
  varianceCost:      number;
  variancePercent:   number;
  currentCountId:    string;
  previousCountId:   string;
}

function assertTopVarianceItemShape(item: TopVarianceItem, label: string) {
  expect(typeof item.inventoryItemId,   `${label}.inventoryItemId should be string`).toBe('string');
  expect(item.inventoryItemId.length,   `${label}.inventoryItemId should be non-empty`).toBeGreaterThan(0);

  expect(typeof item.inventoryItemName, `${label}.inventoryItemName should be string`).toBe('string');
  expect(item.inventoryItemName.length, `${label}.inventoryItemName should be non-empty`).toBeGreaterThan(0);

  expect(typeof item.varianceCost,      `${label}.varianceCost should be number`).toBe('number');
  expect(item.varianceCost,             `${label}.varianceCost should be positive (worst driver)`).toBeGreaterThan(0);

  expect(typeof item.variancePercent,   `${label}.variancePercent should be number`).toBe('number');

  expect(typeof item.currentCountId,    `${label}.currentCountId should be string`).toBe('string');
  expect(item.currentCountId.length,    `${label}.currentCountId should be non-empty`).toBeGreaterThan(0);

  expect(typeof item.previousCountId,   `${label}.previousCountId should be string`).toBe('string');
  expect(item.previousCountId.length,   `${label}.previousCountId should be non-empty`).toBeGreaterThan(0);
}

// =============================================================================
// 1. Unauthenticated access
// =============================================================================

test.describe('Unauthenticated access is rejected', () => {
  test('GET /api/tfc/variance/top-item → 401 without a session cookie', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/tfc/variance/top-item?storeId=${STORE_B_ID}`);
    expect(res.status()).toBe(401);
  });
});

// =============================================================================
// 2. Missing required parameter
// =============================================================================

test.describe('Missing storeId returns 400', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD);
  });

  test('GET /api/tfc/variance/top-item without storeId → 400', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/tfc/variance/top-item`, {
      headers: authHeader(token),
    });
    expect(res.status()).toBe(400);
  });
});

// =============================================================================
// 3. Cross-company isolation — Company A cannot see Company B's variance data
// =============================================================================

test.describe('Cross-company isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      loginAs(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test('Company A session querying Company B store returns 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/tfc/variance/top-item?storeId=${COMPANY_B_STORE_ID}`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status()).toBe(403);
  });

  test('Company B session querying Company A store returns 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/tfc/variance/top-item?storeId=${STORE_B_ID}`,
      { headers: authHeader(tokenB) },
    );
    expect(res.status()).toBe(403);
  });
});

// =============================================================================
// 4. Happy path — valid response shape when data exists
// =============================================================================

test.describe('Happy path — authenticated pro-tier manager', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD);
  });

  test('returns 200 for Store B (3 applied counts)', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/tfc/variance/top-item?storeId=${STORE_B_ID}`,
      { headers: authHeader(token) },
    );
    expect(res.status(), 'Expected 200 from top-item endpoint').toBe(200);
  });

  test('returns null or a valid TopVarianceItem shape for Store B', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/tfc/variance/top-item?storeId=${STORE_B_ID}`,
      { headers: authHeader(token) },
    );
    expect(res.status()).toBe(200);

    const body = await res.json() as TopVarianceItem | null;

    // The endpoint returns null when there is no positive-variance driver
    // (fewer than 2 applied counts, or all items are within expected usage).
    // Both null and a valid shape are acceptable — the UI handles both cases.
    if (body !== null) {
      assertTopVarianceItemShape(body, 'Store B top-item');
    }
  });

  test('returns null or a valid TopVarianceItem shape for Store A', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/tfc/variance/top-item?storeId=${STORE_A_ID}`,
      { headers: authHeader(token) },
    );
    expect(res.status()).toBe(200);

    const body = await res.json() as TopVarianceItem | null;

    if (body !== null) {
      assertTopVarianceItemShape(body, 'Store A top-item');
    }
  });

  test('varianceCost is strictly positive when a top item is returned', async ({ request }) => {
    // The Analyze landing card only renders when showTfc && topItem — so if
    // topItem is non-null, varianceCost must be > 0 (the item is an over-usage
    // driver, not a savings item). This is the core invariant that prevents a
    // zero-dollar card from silently appearing and misleading managers.
    const res = await request.get(
      `${BASE_URL}/api/tfc/variance/top-item?storeId=${STORE_B_ID}`,
      { headers: authHeader(token) },
    );
    expect(res.status()).toBe(200);

    const body = await res.json() as TopVarianceItem | null;

    if (body !== null) {
      expect(
        body.varianceCost,
        'Returned top-item varianceCost must be positive — the endpoint filters out negative/zero variance items',
      ).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// 5. Cross-store consistency for Company A
// =============================================================================

test.describe('Company A — both stores return consistent shapes', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD);
  });

  test('Store A and Store B both return 200 concurrently', async ({ request }) => {
    const [resA, resB] = await Promise.all([
      request.get(`${BASE_URL}/api/tfc/variance/top-item?storeId=${STORE_A_ID}`, {
        headers: authHeader(token),
      }),
      request.get(`${BASE_URL}/api/tfc/variance/top-item?storeId=${STORE_B_ID}`, {
        headers: authHeader(token),
      }),
    ]);

    expect(resA.status(), 'Store A should return 200').toBe(200);
    expect(resB.status(), 'Store B should return 200').toBe(200);

    const bodyA = await resA.json() as TopVarianceItem | null;
    const bodyB = await resB.json() as TopVarianceItem | null;

    // If data exists, shapes must be valid
    if (bodyA !== null) assertTopVarianceItemShape(bodyA, 'Store A concurrent');
    if (bodyB !== null) assertTopVarianceItemShape(bodyB, 'Store B concurrent');
  });

  test('Store A and Store B top items (if present) reference different count IDs', async ({ request }) => {
    // Store-scoping: the two stores run separate inventory count cycles so
    // their top items must reference completely separate count IDs.
    const [resA, resB] = await Promise.all([
      request.get(`${BASE_URL}/api/tfc/variance/top-item?storeId=${STORE_A_ID}`, {
        headers: authHeader(token),
      }),
      request.get(`${BASE_URL}/api/tfc/variance/top-item?storeId=${STORE_B_ID}`, {
        headers: authHeader(token),
      }),
    ]);

    const bodyA = await resA.json() as TopVarianceItem | null;
    const bodyB = await resB.json() as TopVarianceItem | null;

    // Only run the assertion when both stores have a non-null top item
    if (bodyA !== null && bodyB !== null) {
      expect(
        bodyA.currentCountId,
        'Store A and Store B must reference separate inventory count cycles',
      ).not.toBe(bodyB.currentCountId);

      expect(
        bodyA.previousCountId,
        'Store A and Store B must reference separate inventory count cycles',
      ).not.toBe(bodyB.previousCountId);
    }
  });
});
