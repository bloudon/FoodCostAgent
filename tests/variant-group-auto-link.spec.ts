/**
 * Integration tests for the variant group auto-linking feature in the
 * POST /api/onboarding/menu-scan/:sessionId/approve endpoint.
 *
 * After the DB transaction that creates menu items, the endpoint groups
 * items by their `variantGroupKey` field and sets parent/child
 * relationships (parentMenuItemId) for groups that share the same key.
 *
 * Tests cover:
 *   1. Auth/validation — 401, 400, 404 without touching the real logic
 *   2. No variantGroupKey → zero groups linked, no spurious parent/child links
 *   3. Empty string variantGroupKey → treated as "no key", zero groups linked
 *   4. Two items sharing the same variantGroupKey → one group linked, first item
 *      becomes the parent, second gets parentMenuItemId set to the first
 *   5. Three items sharing the same variantGroupKey → one group linked (first
 *      item is parent, two children)
 *   6. Two separate variant groups → two groups linked
 *   7. Only one item per variantGroupKey (no partner) → zero groups linked
 *   8. Mixed: some items with keys, some without → only keyed items linked
 *
 * Prerequisites (dev database):
 *   Email: admin@brians.pizza  /  Password: test123
 *
 * The dev-only POST /api/dev/test/menu-import-session helper is used to
 * seed a pending session record without requiring a real AI scan.  It also
 * returns a valid storeId for the company so the approve endpoint has a
 * store to assign items to.
 */

import { test, expect, APIRequestContext } from 'playwright/test';

const BASE_URL      = 'http://localhost:5000';
const TEST_EMAIL    = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function loginCookie(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status(), 'Web login should succeed').toBe(200);
}

/**
 * Creates a pending menu import session via the dev-only test helper.
 * Returns both the sessionId and a resolved storeId for the company.
 * Skips the test gracefully if the helper endpoint is unavailable
 * (i.e. the server is running in production mode).
 */
async function seedPendingSession(
  request: APIRequestContext,
): Promise<{ sessionId: string; storeId: string | null }> {
  const res = await request.post(`${BASE_URL}/api/dev/test/menu-import-session`, {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status() === 404 || res.status() === 401) {
    test.skip(true, 'Dev test helper endpoint not available — server may be in production mode or auth is missing');
    return { sessionId: '', storeId: null };
  }
  expect(res.status(), `Dev session seed should succeed, got ${res.status()}`).toBe(200);
  const body = await res.json() as { sessionId: string; storeId: string | null };
  expect(body.sessionId, 'Seed must return a sessionId').toBeTruthy();
  return body;
}

/**
 * Calls the approve endpoint and returns the parsed response body.
 */
async function approveSession(
  request: APIRequestContext,
  sessionId: string,
  items: object[],
  storeId?: string | null,
): Promise<{
  menuItemsCreated: number;
  menuItemIds: string[];
  recipesSeeded: number;
  variantGroupsLinked: number;
}> {
  const res = await request.post(
    `${BASE_URL}/api/onboarding/menu-scan/${sessionId}/approve`,
    {
      data: {
        items,
        ...(storeId ? { storeId } : {}),
      },
      headers: { 'Content-Type': 'application/json' },
    },
  );
  expect(
    res.status(),
    `Approve should return 200, got ${res.status()}: ${await res.text()}`,
  ).toBe(200);
  return res.json();
}

/**
 * Returns a unique item name to avoid collisions with existing menu items
 * across repeated test runs.
 */
function uniqueName(base: string): string {
  return `${base}-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Suite 1: Auth and request validation (no session required)
// ---------------------------------------------------------------------------

test.describe('POST .../approve — auth & validation', () => {
  const FAKE_SESSION_ID = '00000000-0000-0000-0000-000000000000';

  test('401 when not authenticated', async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/onboarding/menu-scan/${FAKE_SESSION_ID}/approve`,
      {
        data: { items: [] },
        headers: { 'Content-Type': 'application/json' },
      },
    );
    expect(res.status()).toBe(401);
  });

  test('400 when request body is missing items array', async ({ request }) => {
    await loginCookie(request);
    const res = await request.post(
      `${BASE_URL}/api/onboarding/menu-scan/${FAKE_SESSION_ID}/approve`,
      {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      },
    );
    expect(res.status()).toBe(400);
  });

  test('400 when items array contains an item with no name', async ({ request }) => {
    await loginCookie(request);
    const res = await request.post(
      `${BASE_URL}/api/onboarding/menu-scan/${FAKE_SESSION_ID}/approve`,
      {
        data: { items: [{ name: '', department: 'Entrees' }] },
        headers: { 'Content-Type': 'application/json' },
      },
    );
    expect(res.status()).toBe(400);
  });

  test('404 when sessionId does not exist', async ({ request }) => {
    await loginCookie(request);
    const res = await request.post(
      `${BASE_URL}/api/onboarding/menu-scan/${FAKE_SESSION_ID}/approve`,
      {
        data: { items: [{ name: 'Burger', department: 'Entrees' }] },
        headers: { 'Content-Type': 'application/json' },
      },
    );
    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Auto-linking integration tests
// ---------------------------------------------------------------------------

test.describe('Variant group auto-linking — integration', () => {
  test.beforeEach(async ({ request }) => {
    await loginCookie(request);
  });

  // -------------------------------------------------------------------------
  // T1: No variantGroupKey → zero groups linked
  // -------------------------------------------------------------------------
  test('items with no variantGroupKey field → variantGroupsLinked is 0', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Margherita'), department: 'Pizza', price: 12.99 },
      { name: uniqueName('Pepperoni'),  department: 'Pizza', price: 14.99 },
    ], storeId);

    expect(body.variantGroupsLinked).toBe(0);
    expect(body.menuItemsCreated).toBe(2);
    expect(body.menuItemIds).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // T2: All empty string variantGroupKey → zero groups linked
  // -------------------------------------------------------------------------
  test('items with empty string variantGroupKey → variantGroupsLinked is 0', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Caesar Salad'), department: 'Salads', variantGroupKey: '' },
      { name: uniqueName('Greek Salad'),  department: 'Salads', variantGroupKey: '' },
    ], storeId);

    expect(body.variantGroupsLinked).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T3: Two items with the same variantGroupKey → one group linked
  //     First item becomes parent, second gets parentMenuItemId set.
  // -------------------------------------------------------------------------
  test('two items sharing variantGroupKey → variantGroupsLinked is 1 and child is linked to parent', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    const groupKey = `vg-two-${Date.now()}`;

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Burger Small'), department: 'Burgers', variantGroupKey: groupKey, price: 9.99 },
      { name: uniqueName('Burger Large'), department: 'Burgers', variantGroupKey: groupKey, price: 12.99 },
    ], storeId);

    expect(body.variantGroupsLinked).toBe(1);
    expect(body.menuItemsCreated).toBe(2);

    // Both IDs are in the top-level list (created as top-level items before
    // the post-transaction linking step assigns parent/child relationships).
    expect(body.menuItemIds).toHaveLength(2);
    const [parentId] = body.menuItemIds;

    // Verify DB: the parent should now have the second item as a variant child.
    const variantsRes = await request.get(`${BASE_URL}/api/menu-items/${parentId}/variants`);
    expect(variantsRes.status()).toBe(200);
    const variants = await variantsRes.json() as { id: string; parentMenuItemId: string | null }[];
    expect(variants.length).toBeGreaterThanOrEqual(1);
    for (const v of variants) {
      expect(v.parentMenuItemId).toBe(parentId);
    }
  });

  // -------------------------------------------------------------------------
  // T4: Three items sharing the same variantGroupKey → one group linked
  // -------------------------------------------------------------------------
  test('three items sharing variantGroupKey → variantGroupsLinked is 1 and two children linked', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    const groupKey = `vg-three-${Date.now()}`;

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Steak Small'),  department: 'Mains', variantGroupKey: groupKey },
      { name: uniqueName('Steak Medium'), department: 'Mains', variantGroupKey: groupKey },
      { name: uniqueName('Steak Large'),  department: 'Mains', variantGroupKey: groupKey },
    ], storeId);

    expect(body.variantGroupsLinked).toBe(1);
    expect(body.menuItemsCreated).toBe(3);

    const [parentId] = body.menuItemIds;
    const variantsRes = await request.get(`${BASE_URL}/api/menu-items/${parentId}/variants`);
    expect(variantsRes.status()).toBe(200);
    const variants = await variantsRes.json() as { id: string }[];
    expect(variants.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // T5: Two separate variant groups → two groups linked
  // -------------------------------------------------------------------------
  test('two distinct variantGroupKeys → variantGroupsLinked is 2', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    const groupA = `vg-a-${Date.now()}`;
    const groupB = `vg-b-${Date.now()}`;

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Wing Small'), department: 'Starters', variantGroupKey: groupA },
      { name: uniqueName('Wing Large'), department: 'Starters', variantGroupKey: groupA },
      { name: uniqueName('Rib Small'),  department: 'Mains',    variantGroupKey: groupB },
      { name: uniqueName('Rib Large'),  department: 'Mains',    variantGroupKey: groupB },
    ], storeId);

    expect(body.variantGroupsLinked).toBe(2);
    expect(body.menuItemsCreated).toBe(4);
  });

  // -------------------------------------------------------------------------
  // T6: Only one item per variantGroupKey → no linking (need at least 2)
  // -------------------------------------------------------------------------
  test('single item per variantGroupKey with no partner → variantGroupsLinked is 0', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Soup'),  department: 'Starters', variantGroupKey: `vg-solo-a-${Date.now()}` },
      { name: uniqueName('Pasta'), department: 'Mains',    variantGroupKey: `vg-solo-b-${Date.now()}` },
    ], storeId);

    expect(body.variantGroupsLinked).toBe(0);
    expect(body.menuItemsCreated).toBe(2);
    // No parent/child linkage — all items remain independent top-level entries
    expect(body.menuItemIds).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // T7: Mixed — some items have a shared key, some have no key
  //     Only the keyed pair should be linked; unkeyed items untouched.
  // -------------------------------------------------------------------------
  test('mixed items: keyed pair + unkeyed items → variantGroupsLinked is 1', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);
    const groupKey = `vg-mixed-${Date.now()}`;

    const body = await approveSession(request, sessionId, [
      { name: uniqueName('Lemonade Small'), department: 'Drinks', variantGroupKey: groupKey },
      { name: uniqueName('Lemonade Large'), department: 'Drinks', variantGroupKey: groupKey },
      { name: uniqueName('Water'),          department: 'Drinks' },
      { name: uniqueName('Juice'),          department: 'Drinks', variantGroupKey: '' },
    ], storeId);

    expect(body.variantGroupsLinked).toBe(1);
    expect(body.menuItemsCreated).toBe(4);
  });

  // -------------------------------------------------------------------------
  // T8: Response shape — approve always returns variantGroupsLinked field
  // -------------------------------------------------------------------------
  test('response always includes variantGroupsLinked even when no items are submitted', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);

    const body = await approveSession(request, sessionId, [], storeId);

    expect(typeof body.variantGroupsLinked).toBe('number');
    expect(body.variantGroupsLinked).toBe(0);
    expect(typeof body.menuItemsCreated).toBe('number');
    expect(Array.isArray(body.menuItemIds)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T9: 409 when attempting to re-approve an already-approved session
  // -------------------------------------------------------------------------
  test('409 when session has already been approved', async ({ request }) => {
    const { sessionId, storeId } = await seedPendingSession(request);

    // First approve — should succeed
    await approveSession(request, sessionId, [
      { name: uniqueName('First Approve Item'), department: 'Test' },
    ], storeId);

    // Second approve of the same session — must be rejected
    const res = await request.post(
      `${BASE_URL}/api/onboarding/menu-scan/${sessionId}/approve`,
      {
        data: {
          items: [{ name: uniqueName('Second Approve Item'), department: 'Test' }],
          ...(storeId ? { storeId } : {}),
        },
        headers: { 'Content-Type': 'application/json' },
      },
    );
    expect(res.status()).toBe(409);
  });
});
