/**
 * Cross-company store isolation tests for manager-accessible data endpoints.
 *
 * Each endpoint under test accepts a storeId parameter (query string, path,
 * or request body) and must return 403 when an authenticated manager from
 * Company A supplies a storeId that belongs to Company B — and vice-versa.
 *
 * Endpoints covered:
 *   GET  /api/inventory-items?store_id=X
 *   GET  /api/dashboard/reorder-list?storeId=X
 *   GET  /api/inventory-items/estimated-on-hand?storeId=X
 *   GET  /api/inventory-count-lines?storeId=X
 *   GET  /api/stores/:storeId/usage
 *
 * Test data:
 *   Company A – Brian's Pizza   (ad95ecda-74a9-49d7-833b-6d7d2f48efd1)
 *     User:    admin@brians.pizza / test123  (company_admin, pro tier)
 *     Store B: 2c9272ed-8ccc-45f7-ab81-45504a87b7cb
 *     Store A: 2765a568-d72f-46ab-b2f1-5b4f7fc31f5b
 *
 *   Company B – The Breakfast Nook  (bn-company-0001)
 *     User:    ci-staff@breakfastnook.com / ci-pass-nook  (pro tier)
 *     Store:   ci-store-nook-001
 */

import { test, expect, APIRequestContext } from 'playwright/test';

const BASE_URL = 'http://localhost:5000';

const COMPANY_A_EMAIL    = 'admin@brians.pizza';
const COMPANY_A_PASSWORD = 'test123';
const COMPANY_A_STORE_ID = '2c9272ed-8ccc-45f7-ab81-45504a87b7cb';

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
// GET /api/inventory-items?store_id=X
// ---------------------------------------------------------------------------

test.describe('GET /api/inventory-items — cross-company isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      loginAs(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test('Company A session querying Company B store → 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-items?store_id=${COMPANY_B_STORE_ID}`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status(), 'Expected 403 for cross-company storeId on /api/inventory-items').toBe(403);
  });

  test('Company B session querying Company A store → 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-items?store_id=${COMPANY_A_STORE_ID}`,
      { headers: authHeader(tokenB) },
    );
    expect(res.status(), 'Expected 403 for cross-company storeId on /api/inventory-items').toBe(403);
  });

  test('Company A session querying own store → 200', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-items?store_id=${COMPANY_A_STORE_ID}`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status(), 'Expected 200 for own storeId on /api/inventory-items').toBe(200);
  });

  test('Unauthenticated request → 401', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-items?store_id=${COMPANY_A_STORE_ID}`,
    );
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/reorder-list?storeId=X
// ---------------------------------------------------------------------------

test.describe('GET /api/dashboard/reorder-list — cross-company isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      loginAs(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test('Company A session querying Company B store → 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/dashboard/reorder-list?storeId=${COMPANY_B_STORE_ID}`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status(), 'Expected 403 for cross-company storeId on /api/dashboard/reorder-list').toBe(403);
  });

  test('Company B session querying Company A store → 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/dashboard/reorder-list?storeId=${COMPANY_A_STORE_ID}`,
      { headers: authHeader(tokenB) },
    );
    expect(res.status(), 'Expected 403 for cross-company storeId on /api/dashboard/reorder-list').toBe(403);
  });

  test('Company A session querying own store → 200', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/dashboard/reorder-list?storeId=${COMPANY_A_STORE_ID}`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status(), 'Expected 200 for own storeId on /api/dashboard/reorder-list').toBe(200);
  });

  test('Missing storeId → 400', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/dashboard/reorder-list`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status()).toBe(400);
  });

  test('Unauthenticated request → 401', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/dashboard/reorder-list?storeId=${COMPANY_A_STORE_ID}`,
    );
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/inventory-items/estimated-on-hand?storeId=X
// ---------------------------------------------------------------------------

test.describe('GET /api/inventory-items/estimated-on-hand — cross-company isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      loginAs(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test('Company A session querying Company B store → 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-items/estimated-on-hand?storeId=${COMPANY_B_STORE_ID}`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status(), 'Expected 403 for cross-company storeId on estimated-on-hand').toBe(403);
  });

  test('Company B session querying Company A store → 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-items/estimated-on-hand?storeId=${COMPANY_A_STORE_ID}`,
      { headers: authHeader(tokenB) },
    );
    expect(res.status(), 'Expected 403 for cross-company storeId on estimated-on-hand').toBe(403);
  });

  test('Company A session querying own store → 200', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-items/estimated-on-hand?storeId=${COMPANY_A_STORE_ID}`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status(), 'Expected 200 for own storeId on estimated-on-hand').toBe(200);
  });

  test('Missing storeId → 400', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-items/estimated-on-hand`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status()).toBe(400);
  });

  test('Unauthenticated request → 401', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-items/estimated-on-hand?storeId=${COMPANY_A_STORE_ID}`,
    );
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/inventory-count-lines?storeId=X
// ---------------------------------------------------------------------------

test.describe('GET /api/inventory-count-lines — cross-company isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      loginAs(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test('Company A session querying Company B store → 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-count-lines?storeId=${COMPANY_B_STORE_ID}`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status(), 'Expected 403 for cross-company storeId on /api/inventory-count-lines').toBe(403);
  });

  test('Company B session querying Company A store → 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-count-lines?storeId=${COMPANY_A_STORE_ID}`,
      { headers: authHeader(tokenB) },
    );
    expect(res.status(), 'Expected 403 for cross-company storeId on /api/inventory-count-lines').toBe(403);
  });

  test('Company A session querying own store → 200', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-count-lines?storeId=${COMPANY_A_STORE_ID}`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status(), 'Expected 200 for own storeId on /api/inventory-count-lines').toBe(200);
  });

  test('Missing storeId → 400', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-count-lines`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status()).toBe(400);
  });

  test('Unauthenticated request → 401', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-count-lines?storeId=${COMPANY_A_STORE_ID}`,
    );
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/usage
// ---------------------------------------------------------------------------

test.describe('GET /api/stores/:storeId/usage — cross-company isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      loginAs(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test('Company A session querying Company B store → 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/stores/${COMPANY_B_STORE_ID}/usage`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status(), 'Expected 403 for cross-company storeId on /api/stores/:id/usage').toBe(403);
  });

  test('Company B session querying Company A store → 403', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/stores/${COMPANY_A_STORE_ID}/usage`,
      { headers: authHeader(tokenB) },
    );
    expect(res.status(), 'Expected 403 for cross-company storeId on /api/stores/:id/usage').toBe(403);
  });

  test('Company A session querying own store → 200', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/stores/${COMPANY_A_STORE_ID}/usage`,
      { headers: authHeader(tokenA) },
    );
    expect(res.status(), 'Expected 200 for own storeId on /api/stores/:id/usage').toBe(200);
  });

  test('Unauthenticated request → 401', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/stores/${COMPANY_A_STORE_ID}/usage`,
    );
    expect(res.status()).toBe(401);
  });
});
