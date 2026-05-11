/**
 * Cross-company isolation tests for inventory count endpoints.
 *
 * These tests verify that:
 *   1. Unauthenticated requests are rejected with 401.
 *   2. A user from Company A (Brian's Pizza) cannot see inventory sessions
 *      belonging to Company B (The Breakfast Nook) via any of the three
 *      endpoints that were fixed in Task #225.
 *
 * Endpoints under test:
 *   GET /api/inventory-counts
 *   GET /api/inventory-counts/:id
 *   GET /api/inventory-counts/:id/previous-lines
 *
 * Test data (dev database):
 *   Company A – Brian's Pizza        (ad95ecda-74a9-49d7-833b-6d7d2f48efd1)
 *     User:  admin@brians.pizza / test123
 *     Count: 5f72014d-2b56-43ad-bc07-1dbf679336c5
 *
 *   Company B – The Breakfast Nook  (bn-company-0001)
 *     Count: dfc5aa03-0055-4b2e-ab88-fb4a11750b12  ← Company A must NOT see this
 */

import { test, expect, APIRequestContext } from 'playwright/test';

const BASE_URL = 'http://localhost:5000';

// ─── Company A (Brian's Pizza) ────────────────────────────────────────────────
const COMPANY_A_EMAIL    = 'admin@brians.pizza';
// dev-DB password verified against the live bcrypt hash via POST /api/auth/login
const COMPANY_A_PASSWORD = 'test123';
const COMPANY_A_ID       = 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
const COMPANY_A_COUNT_ID = '5f72014d-2b56-43ad-bc07-1dbf679336c5';

// ─── Company B (The Breakfast Nook) ──────────────────────────────────────────
const COMPANY_B_COUNT_ID = 'dfc5aa03-0055-4b2e-ab88-fb4a11750b12';

// ─── Helper: log in via the API and return an authenticated request context ──
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

  // Extract the session cookie so we can replay it on subsequent requests.
  const setCookie = res.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/session=([^;]+)/);
  expect(match, 'No session cookie returned from login').not.toBeNull();
  return match![1];
}

// ─── Helper: build a Cookie header from a session token ──────────────────────
function sessionHeader(token: string) {
  return { Cookie: `session=${token}` };
}

// =============================================================================
// 1. Unauthenticated access — all three endpoints must return 401
// =============================================================================
test.describe('Unauthenticated access is rejected', () => {
  test('GET /api/inventory-counts → 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/inventory-counts`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/inventory-counts/:id → 401', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-counts/${COMPANY_B_COUNT_ID}`,
    );
    expect(res.status()).toBe(401);
  });

  test('GET /api/inventory-counts/:id/previous-lines → 401', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-counts/${COMPANY_B_COUNT_ID}/previous-lines`,
    );
    expect(res.status()).toBe(401);
  });
});

// =============================================================================
// 2. Cross-company isolation — Company A cannot see Company B's sessions
// =============================================================================
test.describe('Cross-company isolation (Company A cannot see Company B data)', () => {
  let sessionToken: string;

  test.beforeAll(async ({ request }) => {
    sessionToken = await loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD);
  });

  // ── List endpoint ──────────────────────────────────────────────────────────
  test('GET /api/inventory-counts only returns sessions belonging to the authenticated company', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/inventory-counts`, {
      headers: sessionHeader(sessionToken),
    });

    expect(res.status()).toBe(200);
    const counts = await res.json() as Array<{ id: string; companyId: string }>;

    // Every returned session must belong to Company A.
    for (const count of counts) {
      expect(count.companyId).toBe(COMPANY_A_ID);
    }

    // Company B's count must not appear anywhere in the list.
    const ids = counts.map(c => c.id);
    expect(ids).not.toContain(COMPANY_B_COUNT_ID);
  });

  // ── Single-session endpoint ────────────────────────────────────────────────
  test('GET /api/inventory-counts/:id with a Company B id → 404 for Company A user', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-counts/${COMPANY_B_COUNT_ID}`,
      { headers: sessionHeader(sessionToken) },
    );

    // The server returns 404 (not 403) to avoid leaking whether the session exists.
    expect(res.status()).toBe(404);
  });

  // ── Previous-lines endpoint ────────────────────────────────────────────────
  test('GET /api/inventory-counts/:id/previous-lines with a Company B id → 404 for Company A user', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-counts/${COMPANY_B_COUNT_ID}/previous-lines`,
      { headers: sessionHeader(sessionToken) },
    );

    expect(res.status()).toBe(404);
  });

  // ── Positive control: Company A can access its own sessions ───────────────
  test('GET /api/inventory-counts/:id with a Company A id → 200 for Company A user', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-counts/${COMPANY_A_COUNT_ID}`,
      { headers: sessionHeader(sessionToken) },
    );

    expect(res.status()).toBe(200);
    const body = await res.json() as { id: string; companyId: string };
    expect(body.id).toBe(COMPANY_A_COUNT_ID);
    expect(body.companyId).toBe(COMPANY_A_ID);
  });

  test('GET /api/inventory-counts/:id/previous-lines with a Company A id → 200 for Company A user', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/inventory-counts/${COMPANY_A_COUNT_ID}/previous-lines`,
      { headers: sessionHeader(sessionToken) },
    );

    expect(res.status()).toBe(200);
  });
});
