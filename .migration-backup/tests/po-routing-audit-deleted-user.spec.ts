/**
 * Integration spec: GET /api/purchase-orders/:id/routing-audit — deleted-user name snapshot
 *
 * Verifies that the routing audit endpoint returns the operator's name that was
 * captured at routing time even after the acting user has been hard-deleted from
 * the database.
 *
 * Scenario:
 *   1. Seed a PO fixture (source PO + line) as the admin user.
 *   2. Create an ephemeral test user via the dev helper endpoint.
 *   3. Switch session: log out admin, log in as the ephemeral user.
 *   4. Route the PO line as the ephemeral user (operatorName snapshot written).
 *   5. Switch session back: log out ephemeral, log in as admin.
 *   6. Hard-delete the ephemeral user via the dev helper endpoint.
 *   7. Fetch GET /api/purchase-orders/:id/routing-audit as the admin user.
 *   8. Assert the audit row still carries the ephemeral user's original name
 *      (not blank, not "Unknown", not "Deleted user").
 *
 * This guards against regressions in the operatorName-snapshot logic inside the
 * route-lines handler — a future change that stops snapshotting the name at
 * write time would cause the audit to fall back to "Deleted user" because the
 * user row is gone entirely.
 *
 * All HTTP calls are made through page.request (cookie-aware, no extra browser
 * binary required) following the same pattern as the other PO route-lines specs.
 *
 * Dev fixture endpoints used:
 *   POST   /api/dev/test/po-route-fixture            → source PO
 *   DELETE /api/dev/test/po-route-fixture/:poId      → teardown
 *   POST   /api/dev/test/ephemeral-user              → temp user
 *   DELETE /api/dev/test/ephemeral-user/:userId      → delete temp user
 *
 * Admin credentials:
 *   Email: admin@brians.pizza  /  Password: test123
 */

import { test, expect } from './test-helpers';

const BASE_URL       = 'http://localhost:5000';
const ADMIN_EMAIL    = 'admin@brians.pizza';
const ADMIN_PASSWORD = 'test123';

interface PoRouteFixture {
  inventoryItemId: string;
  vendorItemAId:   string;
  vendorItemBId:   string;
  vendorAId:       string;
  vendorBId:       string;
  poId:            string;
  poLineId:        string;
  storeId:         string;
  unitId:          string;
}

interface EphemeralUser {
  userId:    string;
  email:     string;
  password:  string;
  firstName: string;
  lastName:  string;
}

interface AuditRow {
  id:            string;
  sourcePoId:    string;
  operatorName:  string | null;
  userId:        string | null;
}

test.describe('PO routing-audit — operator name survives user deletion', () => {
  test(
    'audit row still shows the original operator name after the acting user is deleted',
    async ({ page }) => {
      // -----------------------------------------------------------------------
      // Step 0: authenticate as admin
      // -----------------------------------------------------------------------
      const adminLogin = await page.request.post(`${BASE_URL}/api/auth/login`, {
        data:    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        headers: { 'Content-Type': 'application/json' },
      });

      if (adminLogin.status() !== 200) {
        test.skip(true, `Admin login failed (${adminLogin.status()}) — skipping`);
        return;
      }

      // -----------------------------------------------------------------------
      // Step 1: seed PO fixture as admin
      // -----------------------------------------------------------------------
      const seedRes = await page.request.post(`${BASE_URL}/api/dev/test/po-route-fixture`, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (seedRes.status() === 404 || seedRes.status() === 401) {
        test.skip(true, 'Dev seed helper not available — skipping');
        return;
      }
      if (seedRes.status() === 422) {
        const body = await seedRes.json() as { error: string };
        test.skip(true, `Seed precondition not met: ${body.error} — skipping`);
        return;
      }

      expect(
        seedRes.status(),
        `Seed must return 200, got ${seedRes.status()}: ${await seedRes.text()}`,
      ).toBe(200);

      const fixture = await seedRes.json() as PoRouteFixture;
      const { inventoryItemId, vendorItemBId, poId, poLineId } = fixture;

      // -----------------------------------------------------------------------
      // Step 2: create an ephemeral test user (still as admin)
      // -----------------------------------------------------------------------
      const ephRes = await page.request.post(`${BASE_URL}/api/dev/test/ephemeral-user`, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (ephRes.status() === 404) {
        await page.request.delete(
          `${BASE_URL}/api/dev/test/po-route-fixture/${poId}?inventoryItemId=${inventoryItemId}`,
        );
        test.skip(true, 'Ephemeral-user dev helper not available — skipping');
        return;
      }

      expect(
        ephRes.status(),
        `Ephemeral user creation must return 200, got ${ephRes.status()}: ${await ephRes.text()}`,
      ).toBe(200);

      const ephUser = await ephRes.json() as EphemeralUser;
      const expectedName = `${ephUser.firstName} ${ephUser.lastName}`;

      try {
        // -----------------------------------------------------------------------
        // Step 3: switch to ephemeral user — log out admin, log in as ephemeral
        // -----------------------------------------------------------------------
        await page.request.post(`${BASE_URL}/api/auth/logout`, {
          headers: { 'Content-Type': 'application/json' },
        });

        const ephLogin = await page.request.post(`${BASE_URL}/api/auth/login`, {
          data:    { email: ephUser.email, password: ephUser.password },
          headers: { 'Content-Type': 'application/json' },
        });

        expect(
          ephLogin.status(),
          `Ephemeral user login must return 200, got ${ephLogin.status()}: ${await ephLogin.text()}`,
        ).toBe(200);

        // -----------------------------------------------------------------------
        // Step 4: route the PO line as the ephemeral user
        // -----------------------------------------------------------------------
        const routeRes = await page.request.post(
          `${BASE_URL}/api/purchase-orders/${poId}/route-lines`,
          {
            data:    { lines: [{ poLineId, targetVendorItemId: vendorItemBId }] },
            headers: { 'Content-Type': 'application/json' },
          },
        );

        expect(
          routeRes.status(),
          `Route-lines must return 200, got ${routeRes.status()}: ${await routeRes.text()}`,
        ).toBe(200);

        const routeBody = await routeRes.json() as { data?: { routedLines: number } };
        expect(routeBody.data?.routedLines, 'routedLines must be 1').toBe(1);

        // -----------------------------------------------------------------------
        // Step 5: switch back to admin — log out ephemeral, log in as admin
        // -----------------------------------------------------------------------
        await page.request.post(`${BASE_URL}/api/auth/logout`, {
          headers: { 'Content-Type': 'application/json' },
        });

        const adminReLogin = await page.request.post(`${BASE_URL}/api/auth/login`, {
          data:    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
          headers: { 'Content-Type': 'application/json' },
        });

        expect(
          adminReLogin.status(),
          `Admin re-login must return 200, got ${adminReLogin.status()}`,
        ).toBe(200);

        // -----------------------------------------------------------------------
        // Step 6: hard-delete the ephemeral user
        // -----------------------------------------------------------------------
        const delRes = await page.request.delete(
          `${BASE_URL}/api/dev/test/ephemeral-user/${ephUser.userId}`,
        );

        expect(
          delRes.status(),
          `Ephemeral user DELETE must return 200, got ${delRes.status()}: ${await delRes.text()}`,
        ).toBe(200);

        // -----------------------------------------------------------------------
        // Step 7: fetch routing-audit as admin — user row is now gone from DB
        // -----------------------------------------------------------------------
        const auditRes = await page.request.get(
          `${BASE_URL}/api/purchase-orders/${poId}/routing-audit`,
        );

        expect(
          auditRes.status(),
          `routing-audit must return 200, got ${auditRes.status()}: ${await auditRes.text()}`,
        ).toBe(200);

        const auditBody = await auditRes.json() as { data?: AuditRow[] };
        const rows = auditBody.data ?? [];

        expect(rows.length, 'At least one audit row must exist for this PO').toBeGreaterThanOrEqual(1);

        const outboundRow = rows.find((r) => r.sourcePoId === poId);
        expect(outboundRow, 'An outbound audit row must exist for the source PO').toBeTruthy();

        // -----------------------------------------------------------------------
        // Step 8: assert name is the stored snapshot, not a fallback
        // -----------------------------------------------------------------------
        expect(
          outboundRow!.operatorName,
          `operatorName must be the snapshotted name "${expectedName}" but got: "${outboundRow!.operatorName}". ` +
          'The route-lines handler must snapshot the operator name at write time so deleted users do not break history.',
        ).toBe(expectedName);

        expect(
          outboundRow!.operatorName,
          'operatorName must not fall back to "Deleted user" (the snapshot should prevent that)',
        ).not.toBe('Deleted user');

        expect(
          outboundRow!.operatorName,
          'operatorName must not fall back to "Unknown"',
        ).not.toBe('Unknown');

        expect(
          outboundRow!.operatorName,
          'operatorName must not be null or empty string',
        ).toBeTruthy();
      } finally {
        // Always try to restore admin session and clean up seeded data
        await page.request.post(`${BASE_URL}/api/auth/logout`, {
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});

        await page.request.post(`${BASE_URL}/api/auth/login`, {
          data:    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});

        await page.request.delete(
          `${BASE_URL}/api/dev/test/po-route-fixture/${poId}?inventoryItemId=${inventoryItemId}`,
        ).catch(() => {});

        // In case Step 6 didn't run (early failure), attempt user cleanup
        await page.request.delete(
          `${BASE_URL}/api/dev/test/ephemeral-user/${ephUser.userId}`,
        ).catch(() => {});
      }
    },
  );
});
