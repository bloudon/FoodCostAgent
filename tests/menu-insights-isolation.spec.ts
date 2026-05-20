/**
 * Cross-company isolation tests for GET /api/menu-insights.
 *
 * These tests verify that:
 *   1. Unauthenticated requests are rejected with 401.
 *   2. Company A (Brian's Pizza) only sees its own menu items and ingredient
 *      tokens — never data belonging to Company B (The Breakfast Nook).
 *   3. Company B only sees its own menu items and ingredient tokens — never
 *      data belonging to Company A.
 *
 * Test data (ci-seed.ts fixtures):
 *   Company A – Brian's Pizza         (ad95ecda-74a9-49d7-833b-6d7d2f48efd1)
 *     User:       admin@brians.pizza / test123
 *     Menu item:  ci-menu-brians-001 ("CI Margherita Pizza")
 *     Recipe:     ci-recipe-brians-001 ("CI Margherita Base")
 *     Ingredient: missingItemName = "ci-anchovy-paste"   ← sentinel for A
 *
 *   Company B – The Breakfast Nook    (bn-company-0001)
 *     User:       ci-staff@breakfastnook.com / ci-pass-nook
 *     Menu item:  ci-menu-nook-001 ("CI Eggs Benedict")
 *     Recipe:     ci-recipe-nook-001 ("CI Hollandaise Recipe")
 *     Ingredient: missingItemName = "ci-hollandaise-base"  ← sentinel for B
 *
 * The sentinel strings are intentionally unique CI-only values that will not
 * collide with any real production data, so a cross-company leak is
 * immediately obvious if either sentinel appears in the wrong company's
 * response.
 */

import { test, expect, APIRequestContext } from 'playwright/test';

const BASE_URL = 'http://localhost:5000';

const COMPANY_A_EMAIL    = 'admin@brians.pizza';
const COMPANY_A_PASSWORD = 'test123';
const COMPANY_A_ID       = 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

const COMPANY_B_EMAIL    = 'ci-staff@breakfastnook.com';
const COMPANY_B_PASSWORD = 'ci-pass-nook';
const COMPANY_B_ID       = 'bn-company-0001';

const COMPANY_A_SENTINEL_INGREDIENT = 'ci-anchovy-paste';
const COMPANY_B_SENTINEL_INGREDIENT = 'ci-hollandaise-base';

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
  const match = setCookie.match(/session=([^;]+)/);
  expect(match, `No session cookie returned for ${email}`).not.toBeNull();
  return match![1];
}

function sessionHeader(token: string) {
  return { Cookie: `session=${token}` };
}

// =============================================================================
// 1. Unauthenticated access must be rejected
// =============================================================================

test.describe('Unauthenticated access is rejected', () => {
  test('GET /api/menu-insights → 401 without a session cookie', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/menu-insights`);
    expect(res.status()).toBe(401);
  });
});

// =============================================================================
// 2. Company A isolation — sees only its own data
// =============================================================================

test.describe('Company A (Brian\'s Pizza) — data isolation', () => {
  let tokenA: string;

  test.beforeAll(async ({ request }) => {
    tokenA = await loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD);
  });

  test('returns 200 with the expected response shape', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/menu-insights`, {
      headers: sessionHeader(tokenA),
    });

    expect(res.status()).toBe(200);

    const body = await res.json() as {
      totalMenuItems: number;
      departmentBreakdown: { name: string; count: number }[];
      avgSellingPrice: number | null;
      uniqueIngredientCount: number;
      ingredients: { name: string; classification: string; recipeCount: number }[];
    };

    expect(typeof body.totalMenuItems).toBe('number');
    expect(Array.isArray(body.departmentBreakdown)).toBe(true);
    expect(Array.isArray(body.ingredients)).toBe(true);
    expect(typeof body.uniqueIngredientCount).toBe('number');
  });

  test('menu items count is scoped to Company A (not 0 — CI fixture exists)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/menu-insights`, {
      headers: sessionHeader(tokenA),
    });
    expect(res.status()).toBe(200);

    const body = await res.json() as { totalMenuItems: number };
    expect(body.totalMenuItems).toBeGreaterThan(0);
  });

  test('ingredient list includes the Company A sentinel but NOT the Company B sentinel', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/menu-insights`, {
      headers: sessionHeader(tokenA),
    });
    expect(res.status()).toBe(200);

    const body = await res.json() as {
      ingredients: { name: string }[];
    };

    const names = body.ingredients.map((i) => i.name.toLowerCase());

    expect(
      names,
      'Company A\'s own CI sentinel ingredient must appear in its insights',
    ).toContain(COMPANY_A_SENTINEL_INGREDIENT);

    expect(
      names,
      'Company B\'s sentinel ingredient must NOT appear in Company A\'s insights',
    ).not.toContain(COMPANY_B_SENTINEL_INGREDIENT);
  });
});

// =============================================================================
// 3. Company B isolation — sees only its own data
// =============================================================================

test.describe('Company B (The Breakfast Nook) — data isolation', () => {
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    tokenB = await loginAs(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD);
  });

  test('returns 200 with the expected response shape', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/menu-insights`, {
      headers: sessionHeader(tokenB),
    });

    expect(res.status()).toBe(200);

    const body = await res.json() as {
      totalMenuItems: number;
      departmentBreakdown: { name: string; count: number }[];
      avgSellingPrice: number | null;
      uniqueIngredientCount: number;
      ingredients: { name: string; classification: string; recipeCount: number }[];
    };

    expect(typeof body.totalMenuItems).toBe('number');
    expect(Array.isArray(body.departmentBreakdown)).toBe(true);
    expect(Array.isArray(body.ingredients)).toBe(true);
    expect(typeof body.uniqueIngredientCount).toBe('number');
  });

  test('menu items count is scoped to Company B (not 0 — CI fixture exists)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/menu-insights`, {
      headers: sessionHeader(tokenB),
    });
    expect(res.status()).toBe(200);

    const body = await res.json() as { totalMenuItems: number };
    expect(body.totalMenuItems).toBeGreaterThan(0);
  });

  test('ingredient list includes the Company B sentinel but NOT the Company A sentinel', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/menu-insights`, {
      headers: sessionHeader(tokenB),
    });
    expect(res.status()).toBe(200);

    const body = await res.json() as {
      ingredients: { name: string }[];
    };

    const names = body.ingredients.map((i) => i.name.toLowerCase());

    expect(
      names,
      'Company B\'s own CI sentinel ingredient must appear in its insights',
    ).toContain(COMPANY_B_SENTINEL_INGREDIENT);

    expect(
      names,
      'Company A\'s sentinel ingredient must NOT appear in Company B\'s insights',
    ).not.toContain(COMPANY_A_SENTINEL_INGREDIENT);
  });
});

// =============================================================================
// 4. Bidirectional cross-company check (both sessions active simultaneously)
// =============================================================================

test.describe('Bidirectional cross-company scoping', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      loginAs(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      loginAs(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test('Company A and Company B see disjoint ingredient sets for their CI sentinel values', async ({ request }) => {
    const [resA, resB] = await Promise.all([
      request.get(`${BASE_URL}/api/menu-insights`, { headers: sessionHeader(tokenA) }),
      request.get(`${BASE_URL}/api/menu-insights`, { headers: sessionHeader(tokenB) }),
    ]);

    expect(resA.status()).toBe(200);
    expect(resB.status()).toBe(200);

    const bodyA = await resA.json() as { ingredients: { name: string }[] };
    const bodyB = await resB.json() as { ingredients: { name: string }[] };

    const namesA = bodyA.ingredients.map((i) => i.name.toLowerCase());
    const namesB = bodyB.ingredients.map((i) => i.name.toLowerCase());

    expect(namesA).toContain(COMPANY_A_SENTINEL_INGREDIENT);
    expect(namesA).not.toContain(COMPANY_B_SENTINEL_INGREDIENT);

    expect(namesB).toContain(COMPANY_B_SENTINEL_INGREDIENT);
    expect(namesB).not.toContain(COMPANY_A_SENTINEL_INGREDIENT);
  });

  test('each company\'s uniqueIngredientCount reflects only its own scoped recipes', async ({ request }) => {
    const [resA, resB] = await Promise.all([
      request.get(`${BASE_URL}/api/menu-insights`, { headers: sessionHeader(tokenA) }),
      request.get(`${BASE_URL}/api/menu-insights`, { headers: sessionHeader(tokenB) }),
    ]);

    expect(resA.status()).toBe(200);
    expect(resB.status()).toBe(200);

    const bodyA = await resA.json() as {
      uniqueIngredientCount: number;
      ingredients: { name: string }[];
    };
    const bodyB = await resB.json() as {
      uniqueIngredientCount: number;
      ingredients: { name: string }[];
    };

    // Each company must have at least the one CI sentinel ingredient seeded for it.
    expect(bodyA.uniqueIngredientCount).toBeGreaterThan(0);
    expect(bodyB.uniqueIngredientCount).toBeGreaterThan(0);

    // The uniqueIngredientCount must be consistent with the returned array length.
    expect(bodyA.uniqueIngredientCount).toBe(bodyA.ingredients.length);
    expect(bodyB.uniqueIngredientCount).toBe(bodyB.ingredients.length);

    // Neither company's ingredient array should contain the other's sentinel —
    // this is a direct scoping check independent of total counts.
    const namesA = bodyA.ingredients.map((i) => i.name.toLowerCase());
    const namesB = bodyB.ingredients.map((i) => i.name.toLowerCase());

    expect(namesA).not.toContain(COMPANY_B_SENTINEL_INGREDIENT);
    expect(namesB).not.toContain(COMPANY_A_SENTINEL_INGREDIENT);
  });
});
