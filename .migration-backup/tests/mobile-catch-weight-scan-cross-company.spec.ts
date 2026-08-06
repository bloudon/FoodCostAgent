/**
 * Cross-company isolation tests for POST /api/mobile/catch-weight-scan.
 *
 * Verifies that a mobile user from Company A cannot submit a catch-weight scan
 * attributed to a Company B store — and vice versa.
 * All requests use Bearer token auth (mobile login pattern), not cookies.
 *
 * The storeId field in the multipart body is optional; when provided the
 * server validates that the authenticated user is assigned to that store
 * (which implicitly enforces company isolation — users are never assigned
 * to stores from another company).
 *
 * Endpoints covered:
 *   POST /api/mobile/catch-weight-scan  (storeId in multipart form body)
 *
 * Test data (dev database):
 *   Company A – Brian's Pizza   (ad95ecda-74a9-49d7-833b-6d7d2f48efd1)
 *     User:    admin@brians.pizza / test123   (company_admin, pro tier)
 *     Store:   2c9272ed-8ccc-45f7-ab81-45504a87b7cb
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

/**
 * Minimal 1×1 JPEG (JFIF, ~152 bytes).
 * Magic bytes FF D8 FF pass the server-side MIME detection check so the
 * upload is accepted and proceeds to the storeId validation step.
 */
const MINIMAL_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0xfb, 0xd1, 0x40, 0x1f, 0xff, 0xd9,
]);

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

test.describe('POST /api/mobile/catch-weight-scan — unauthenticated request rejected', () => {
  test('no Bearer token → 401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/mobile/catch-weight-scan`, {
      multipart: {
        image: {
          name: 'label.jpg',
          mimeType: 'image/jpeg',
          buffer: MINIMAL_JPEG,
        },
        storeId: COMPANY_A_STORE_ID,
      },
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Cross-company storeId isolation
// ---------------------------------------------------------------------------

test.describe('POST /api/mobile/catch-weight-scan — cross-company store isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeAll(async ({ request }) => {
    [tokenA, tokenB] = await Promise.all([
      getMobileToken(request, COMPANY_A_EMAIL, COMPANY_A_PASSWORD),
      getMobileToken(request, COMPANY_B_EMAIL, COMPANY_B_PASSWORD),
    ]);
  });

  test(
    'Company A token + Company B storeId → 403 (store not accessible)',
    async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/mobile/catch-weight-scan`, {
        headers: bearerHeader(tokenA),
        multipart: {
          image: {
            name: 'label.jpg',
            mimeType: 'image/jpeg',
            buffer: MINIMAL_JPEG,
          },
          storeId: COMPANY_B_STORE_ID,
        },
      });
      expect(
        res.status(),
        'Expected 403 when Company A token submits a catch-weight scan attributed to a Company B store',
      ).toBe(403);
    },
  );

  test(
    'Company B token + Company A storeId → 403 (store not accessible)',
    async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/mobile/catch-weight-scan`, {
        headers: bearerHeader(tokenB),
        multipart: {
          image: {
            name: 'label.jpg',
            mimeType: 'image/jpeg',
            buffer: MINIMAL_JPEG,
          },
          storeId: COMPANY_A_STORE_ID,
        },
      });
      expect(
        res.status(),
        'Expected 403 when Company B token submits a catch-weight scan attributed to a Company A store',
      ).toBe(403);
    },
  );

  test(
    'Company A token + own-company storeId → not a company-ownership 403',
    async ({ request }) => {
      // Discover a store that Company A's admin is assigned to
      const storesRes = await request.get(`${BASE_URL}/api/mobile/stores`, {
        headers: bearerHeader(tokenA),
      });
      if (storesRes.status() !== 200) {
        test.skip();
        return;
      }
      const stores = await storesRes.json() as { id: string }[];
      if (!Array.isArray(stores) || stores.length === 0) {
        test.skip();
        return;
      }
      const ownStoreId = stores[0].id;

      const res = await request.post(`${BASE_URL}/api/mobile/catch-weight-scan`, {
        headers: bearerHeader(tokenA),
        multipart: {
          image: {
            name: 'label.jpg',
            mimeType: 'image/jpeg',
            buffer: MINIMAL_JPEG,
          },
          storeId: ownStoreId,
        },
      });

      // 200 (scan succeeded), 400 (unreadable barcode/image), 422, or 500 (AI/image error)
      // are all acceptable — they prove the store ownership check passed.
      // A 403 here would indicate the company-ownership guard incorrectly blocked
      // the user from their own company's store.
      expect(
        res.status(),
        'Company A token with own-company storeId must not receive a 403 company-ownership error',
      ).not.toBe(403);
    },
  );
});
