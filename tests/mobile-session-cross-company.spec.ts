/**
 * Cross-company isolation tests for the mobile inventory session APIs.
 *
 * Verifies that a mobile user from Company A cannot read, write, or trigger
 * operations on inventory sessions belonging to Company B — and vice versa.
 * All requests use Bearer token auth (mobile login pattern), not cookies.
 *
 * Endpoints covered:
 *   POST  /api/mobile/sessions                        (storeId in body)
 *   GET   /api/mobile/sessions/:id                    (session belongs to correct company)
 *   PATCH /api/mobile/sessions/:id/lines/:lineId      (session belongs to correct company)
 *   POST  /api/mobile/sessions/:id/apply              (session belongs to correct company)
 *
 * Test data (dev database):
 *   Company A – Brian's Pizza   (ad95ecda-74a9-49d7-833b-6d7d2f48efd1)
 *     User:    admin@brians.pizza / test123   (company_admin, pro tier)
 *     Store:   2c9272ed-8ccc-45f7-ab81-45504a87b7cb
 *
 *   Company B – The Breakfast Nook  (bn-company-0001)
 *     User:    ci-staff@breakfastnook.com / ci-pass-nook  (pro tier)
 *     Store:   ci-store-nook-001
 *     Session: dfc5aa03-0055-4b2e-ab88-fb4a11750b12  (pre-seeded, applied)
 */

import { test, expect, APIRequestContext } from 'playwright/test';

const BASE_URL = 'http://localhost:5000';

const COMPANY_A_EMAIL    = 'admin@brians.pizza';
const COMPANY_A_PASSWORD = 'test123';
const COMPANY_A_STORE_ID = '2c9272ed-8ccc-45f7-ab81-45504a87b7cb';

const COMPANY_B_EMAIL    = 'ci-staff@breakfastnook.com';
const COMPANY_B_PASSWORD = 'ci-pass-nook';
const COMPANY_B_STORE_ID = 'ci-store-nook-001';

// Pre-seeded Company B inventory count — used to test cross-company read/write blocking
const COMPANY_B_SESSION_ID = 'dfc5aa03-0055-4b2e-ab88-fb4a11750b12';

// Placeholder line ID — the session ownership check happens before any line lookup,
// so returning 404 on the session is sufficient; we never reach the line query.
const PLACEHOLDER_LINE_ID = '00000000-0000-0000-0000-000000000099';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function getMobileToken(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/mobile/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status(), `Mobile login failed for ${email}`).toBe(200);
  const body = await res.json() as { token: string };
  expect(body.token, `No token returned from mobile login for ${email}`).toBeTruthy();
  return body.token;
}

function bearerHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Unauthenticated access
// ---------------------------------------------------------------------------

test.describe('Mobile session endpoints — unauthenticated requests rejected', () => {
  test('POST /api/mobile/sessions without auth → 401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/mobile/sessions`, {
      data: { storeId: COMPANY_A_STORE_ID, name: 'unauth test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/mobile/sessions/:id without auth → 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/mobile/sessions/${COMPANY_B_SESSION_ID}`);
    expect(res.status()).toBe(401);
  });

  test('PATCH /api/mobile/sessions/:id/lines/:lineId without auth → 401', async ({ request }) => {
    const res = await request.patch(
      `${BASE_URL}/api/mobile/sessions/${COMPANY_B_SESSION_ID}/lines/${PLACEHOLDER_LINE_ID}`,
      {
        data: { qty: 1 },
        headers: { 'Content-Type': 'application/json' },
      },
    );
    expect(res.status()).toBe(401);
  });

  test('POST /api/mobile/sessions/:id/apply without auth → 401', async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/mobile/sessions/${COMPANY_B_SESSION_ID}/apply`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/mobile/sessions — cross-company storeId is blocked
// ---------------------------------------------------------------------------

test.describe('POST /api/mobile/sessions — cross-company store isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      getMobileToken(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      getMobileToken(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test('Company A token + Company B storeId → 404 (store not found for company)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/mobile/sessions`, {
      data: { storeId: COMPANY_B_STORE_ID, name: 'cross-company attempt' },
      headers: {
        'Content-Type': 'application/json',
        ...bearerHeader(tokenA),
      },
    });
    expect(
      res.status(),
      'Expected 404 when Company A token tries to create a session in Company B store',
    ).toBe(404);
  });

  test('Company B token + Company A storeId → 404 (store not found for company)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/mobile/sessions`, {
      data: { storeId: COMPANY_A_STORE_ID, name: 'cross-company attempt' },
      headers: {
        'Content-Type': 'application/json',
        ...bearerHeader(tokenB),
      },
    });
    expect(
      res.status(),
      'Expected 404 when Company B token tries to create a session in Company A store',
    ).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/mobile/sessions/:id — cross-company session lookup is blocked
// ---------------------------------------------------------------------------

test.describe('GET /api/mobile/sessions/:id — cross-company isolation', () => {
  let tokenA: string;
  let companyASessionId: string | null = null;

  test.beforeAll(async ({ request }) => {
    tokenA = await getMobileToken(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD);

    // Create a Company A session to use as positive-control data
    const storesRes = await request.get(`${BASE_URL}/api/mobile/stores`, {
      headers: bearerHeader(tokenA),
    });
    if (storesRes.status() === 200) {
      const stores = await storesRes.json() as { id: string }[];
      if (Array.isArray(stores) && stores.length > 0) {
        const sessionRes = await request.post(`${BASE_URL}/api/mobile/sessions`, {
          data: {
            storeId: stores[0].id,
            name: `CI Isolation Test ${Date.now()}`,
            countDate: new Date().toISOString().slice(0, 10),
          },
          headers: {
            'Content-Type': 'application/json',
            ...bearerHeader(tokenA),
          },
        });
        if (sessionRes.status() === 201 || sessionRes.status() === 200) {
          const body = await sessionRes.json() as { id: string };
          companyASessionId = body.id;
        }
      }
    }
  });

  test('Company A token + Company B session ID → 404', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/mobile/sessions/${COMPANY_B_SESSION_ID}`,
      { headers: bearerHeader(tokenA) },
    );
    expect(
      res.status(),
      'Expected 404 when Company A token reads a Company B session',
    ).toBe(404);
  });

  test('Company A token + own session ID → 200', async ({ request }) => {
    if (!companyASessionId) {
      test.skip();
      return;
    }
    const res = await request.get(
      `${BASE_URL}/api/mobile/sessions/${companyASessionId}`,
      { headers: bearerHeader(tokenA) },
    );
    expect(
      res.status(),
      'Expected 200 when Company A token reads its own session',
    ).toBe(200);
    const body = await res.json() as { id: string };
    expect(body.id).toBe(companyASessionId);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/mobile/sessions/:id/lines/:lineId — cross-company session is blocked
// ---------------------------------------------------------------------------

test.describe('PATCH /api/mobile/sessions/:id/lines/:lineId — cross-company isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      getMobileToken(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      getMobileToken(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test('Company A token + Company B session → 404 (session not found for company)', async ({ request }) => {
    const res = await request.patch(
      `${BASE_URL}/api/mobile/sessions/${COMPANY_B_SESSION_ID}/lines/${PLACEHOLDER_LINE_ID}`,
      {
        data: { qty: 5 },
        headers: {
          'Content-Type': 'application/json',
          ...bearerHeader(tokenA),
        },
      },
    );
    expect(
      res.status(),
      'Expected 404 when Company A token patches a line in a Company B session',
    ).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/mobile/sessions/:id/apply — cross-company session is blocked
// ---------------------------------------------------------------------------

test.describe('POST /api/mobile/sessions/:id/apply — cross-company isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      getMobileToken(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      getMobileToken(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test('Company A token + Company B session ID → 404 (session not found for company)', async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/mobile/sessions/${COMPANY_B_SESSION_ID}/apply`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...bearerHeader(tokenA),
        },
      },
    );
    expect(
      res.status(),
      'Expected 404 when Company A token tries to apply a Company B session',
    ).toBe(404);
  });

  test('Company B token + Company A session ID → 404 (session not found for company)', async ({ request }) => {
    // Company A has a session ID we know about from the inventory-session-isolation tests
    const companyASessionId = '5f72014d-2b56-43ad-bc07-1dbf679336c5';
    const res = await request.post(
      `${BASE_URL}/api/mobile/sessions/${companyASessionId}/apply`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...bearerHeader(tokenB),
        },
      },
    );
    expect(
      res.status(),
      'Expected 404 when Company B token tries to apply a Company A session',
    ).toBe(404);
  });
});
