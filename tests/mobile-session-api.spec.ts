/**
 * API-level contract tests for the mobile sessions endpoint.
 *
 * These complement the browser-based floor-staff-quick-start-count.spec.ts
 * tests by verifying the backend contract that the "Start New Count" UI flow
 * depends on.
 *
 * Tests:
 *   1. POST /api/mobile/sessions → 401 without auth token
 *   2. GET  /api/mobile/dashboard → 401 without auth token
 *   3. POST /api/mobile/sessions with a valid mobile session creates a session
 *      and returns the expected shape { id, name, storeId, lineCount }
 *   4. GET  /api/mobile/dashboard returns role, userName, stores, activeSessions
 *   5. POST /api/mobile/sessions without storeId → 400 (Bad Request)
 *
 * Test data (dev database):
 *   Email: admin@brians.pizza  /  Password: test123
 *   Company ID: ad95ecda-74a9-49d7-833b-6d7d2f48efd1
 *
 * NOTE on store discovery: session creation uses mobileUserCanAccessStore()
 * which checks explicit user-store assignment records — not role. Admin users
 * see all company stores on the dashboard, but POST /api/mobile/sessions still
 * requires an explicit assignment. We therefore use GET /api/mobile/stores
 * (which returns only explicitly-assigned stores) to discover a safe store ID.
 */

import { test, expect, APIRequestContext } from 'playwright/test';

const BASE_URL = 'http://localhost:5000';

const MOBILE_EMAIL    = 'admin@brians.pizza';
const MOBILE_PASSWORD = 'test123';

async function getMobileToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/mobile/login`, {
    data: { email: MOBILE_EMAIL, password: MOBILE_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status(), 'Mobile login failed').toBe(200);
  const body = await res.json() as { token: string };
  expect(body.token, 'No token returned from mobile login').toBeTruthy();
  return body.token;
}

function bearerHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// =============================================================================
// 1. Unauthenticated requests are rejected
// =============================================================================
test.describe('Mobile sessions endpoint — unauthenticated', () => {
  test('POST /api/mobile/sessions without auth → 401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/mobile/sessions`, {
      data: { storeId: 'any', name: 'test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/mobile/dashboard without auth → 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/mobile/dashboard`);
    expect(res.status()).toBe(401);
  });
});

// =============================================================================
// 2. Authenticated: dashboard returns the expected shape
// =============================================================================
test.describe('GET /api/mobile/dashboard — authenticated', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getMobileToken(request);
  });

  test('returns 200 with role, stores, activeSessions, recentSessions fields', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/mobile/dashboard`, {
      headers: bearerHeader(token),
    });
    expect(res.status()).toBe(200);

    const body = await res.json() as {
      role: string;
      stores: unknown[];
      activeSessions: unknown[];
      recentSessions: unknown[];
      recentScans: unknown[];
    };

    expect(typeof body.role).toBe('string');
    expect(Array.isArray(body.stores)).toBe(true);
    expect(Array.isArray(body.activeSessions)).toBe(true);
    expect(Array.isArray(body.recentSessions)).toBe(true);
    expect(Array.isArray(body.recentScans)).toBe(true);
  });

  test('stores array items have id and name fields', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/mobile/dashboard`, {
      headers: bearerHeader(token),
    });
    expect(res.status()).toBe(200);

    const body = await res.json() as { stores: { id: string; name: string }[] };

    if (body.stores.length > 0) {
      const store = body.stores[0];
      expect(typeof store.id).toBe('string');
      expect(typeof store.name).toBe('string');
    }
  });
});

// =============================================================================
// 3. Authenticated: session creation returns correct shape
// =============================================================================
test.describe('POST /api/mobile/sessions — authenticated', () => {
  let token: string;
  let assignedStoreId: string | null = null;

  test.beforeAll(async ({ request }) => {
    token = await getMobileToken(request);

    // Use GET /api/mobile/stores (not dashboard) to discover stores the user is
    // explicitly assigned to. mobileUserCanAccessStore() checks these same
    // assignment records, so any storeId returned here is guaranteed to pass
    // the server-side access check in POST /api/mobile/sessions.
    const storesRes = await request.get(`${BASE_URL}/api/mobile/stores`, {
      headers: bearerHeader(token),
    });
    if (storesRes.status() === 200) {
      const storesBody = await storesRes.json() as { id: string; name: string }[];
      if (Array.isArray(storesBody) && storesBody.length > 0) {
        assignedStoreId = storesBody[0].id;
      }
    }
  });

  test('creates a session and returns { id, name, storeId, lineCount }', async ({ request }) => {
    if (!assignedStoreId) {
      test.skip();
      return;
    }

    const sessionName = `API Test Count ${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);

    const res = await request.post(`${BASE_URL}/api/mobile/sessions`, {
      data: { storeId: assignedStoreId, name: sessionName, countDate: today },
      headers: {
        'Content-Type': 'application/json',
        ...bearerHeader(token),
      },
    });
    expect([200, 201]).toContain(res.status());

    const body = await res.json() as {
      id: string;
      name: string;
      storeId: string;
      lineCount: number;
    };

    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.name).toBe(sessionName);
    expect(body.storeId).toBe(assignedStoreId);
    expect(typeof body.lineCount).toBe('number');
  });

  test('missing storeId returns 400 (Bad Request)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/mobile/sessions`, {
      data: { name: 'No store' },
      headers: {
        'Content-Type': 'application/json',
        ...bearerHeader(token),
      },
    });
    expect(res.status()).toBe(400);
  });
});
