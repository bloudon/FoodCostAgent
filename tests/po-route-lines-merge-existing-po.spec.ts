/**
 * Integration spec: POST /api/purchase-orders/:id/route-lines — merge-into-existing-PO path
 *
 * Verifies path (b) of the route-lines handler: when the target vendor already
 * has an open (pending) PO for the same store, the routed line is MERGED into
 * that existing PO rather than a new PO being created.
 *
 * Specifically this test confirms:
 *   1. The response references a pre-existing destination PO, not a newly created one.
 *   2. The destination PO line's orderedQty is correctly incremented
 *      (existingQty + routedQty) — the mergeOrderedQty / shouldMergeIntoExistingLine
 *      logic in routingService.ts worked end-to-end.
 *   3. No duplicate line is inserted into the destination PO.
 *   4. The source PO line is deleted (caseQuantity = 0 or line absent).
 *
 * Strategy: pre-create a pending PO for the target vendor with a known line qty,
 * then route a source line to that vendor.  To be robust against pre-existing
 * pending POs in the DB, we enumerate all pending POs for the target vendor
 * BEFORE routing and verify the routing returns one of those (not a new one).
 * The pre-created PO is tracked for cleanup regardless.
 *
 * DB fixture lifecycle:
 *   POST   /api/dev/test/po-route-fixture   → seeds inventory item, two vendor items,
 *                                             a pending source PO (vendorA) + one PO line
 *   POST   /api/purchase-orders             → creates the pre-existing pending PO for vendorB
 *                                             with one existing line for vendorItemB (qty = 3)
 *   DELETE /api/dev/test/po-route-fixture/:poId?inventoryItemId=...
 *                                           → full teardown (routing audit-driven cleanup
 *                                             removes dest POs it created; fallback deletes
 *                                             the pre-created one if routing didn't run)
 *
 * Note: PO lines are embedded in the PO detail response:
 *   GET /api/purchase-orders/:id → { ...po, lines: [...] }
 *
 * Credentials:
 *   Email: admin@brians.pizza  /  Password: test123
 */

import { test, expect } from './test-helpers';

const BASE_URL      = 'http://localhost:5000';
const TEST_EMAIL    = 'admin@brians.pizza';
const TEST_PASSWORD = 'test123';

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

interface RouteResponse {
  data?: {
    routedLines:   number;
    affectedPOIds: string[];
    auditIds:      string[];
  };
  error?: string;
}

interface PoSummary {
  id:       string;
  vendorId: string;
  storeId:  string;
  status:   string;
}

interface PoDetailResponse {
  id:      string;
  status:  string;
  storeId: string;
  lines?:  Array<{
    id:           string;
    orderedQty:   number;
    caseQuantity: number | null;
    vendorItemId: string;
  }>;
}

// ---------------------------------------------------------------------------
// Suite: merge-into-existing-PO path
// ---------------------------------------------------------------------------

test.describe('PO route-lines — merge into existing open PO for target vendor', () => {
  test(
    'routes a line into an existing pending PO for the target vendor and correctly merges quantities',
    async ({ page }) => {
      // -----------------------------------------------------------------------
      // Step 0: authenticate
      // -----------------------------------------------------------------------
      const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
        data: { email: TEST_EMAIL, password: TEST_PASSWORD },
        headers: { 'Content-Type': 'application/json' },
      });

      if (loginRes.status() !== 200) {
        test.skip(true, `Login failed (${loginRes.status()}) — skipping integration test`);
        return;
      }

      // -----------------------------------------------------------------------
      // Step 1: seed base fixture (source PO for vendorA with one line, orderedQty=5)
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
      const { inventoryItemId, vendorItemBId, vendorBId, poId, poLineId, storeId, unitId } = fixture;

      // Track the pre-created destination PO for cleanup
      let preCreatedDestPoId: string | null = null;

      try {
        // -----------------------------------------------------------------------
        // Step 2: enumerate all current pending POs for vendorB at this store
        //         so we can later verify the routing merged into a pre-existing
        //         one rather than creating a brand-new PO.
        // -----------------------------------------------------------------------
        const allPosRes = await page.request.get(`${BASE_URL}/api/purchase-orders`);
        const allPos = (await allPosRes.json()) as PoSummary[];

        const existingPendingPoIds = new Set(
          allPos
            .filter(
              (p) =>
                p.vendorId === vendorBId &&
                p.storeId  === storeId &&
                p.status   === 'pending',
            )
            .map((p) => p.id),
        );

        // -----------------------------------------------------------------------
        // Step 3: pre-create a pending PO for vendorB at the same store with an
        //         existing line for vendorItemB — orderedQty = 3.
        //         This simulates the "target vendor already has an open PO" scenario.
        //
        // Note: expectedDate is required by the PO insert schema.
        // -----------------------------------------------------------------------
        const nearFutureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const destPoRes = await page.request.post(`${BASE_URL}/api/purchase-orders`, {
          data: {
            vendorId:     vendorBId,
            storeId,
            status:       'pending',
            expectedDate: nearFutureDate,
            lines: [
              {
                vendorItemId: vendorItemBId,
                orderedQty:   3,
                caseQuantity: 3,
                unitId,
                priceEach:    35,
              },
            ],
          },
          headers: { 'Content-Type': 'application/json' },
        });

        expect(
          destPoRes.status(),
          `Pre-created dest PO must return 201, got ${destPoRes.status()}: ${await destPoRes.text()}`,
        ).toBe(201);

        const destPo = await destPoRes.json() as { id: string };
        preCreatedDestPoId = destPo.id;

        // Add our newly-created PO to the set of IDs that are valid merge targets.
        // The route handler picks whichever pending PO appears first in the DB for
        // (companyId, storeId, vendorId) — we accept any of the pre-existing ones.
        existingPendingPoIds.add(preCreatedDestPoId);

        // Snapshot: fetch the dest PO that routing is expected to merge into.
        // Because the route handler picks the first existing pending PO, and there
        // may be pre-existing POs (before our pre-create), we record ALL candidate
        // POs' current line orderedQty for vendorItemBId so we can verify the delta.
        const snapshotByPoId = new Map<string, number>();
        for (const existingPoId of existingPendingPoIds) {
          const r = await page.request.get(`${BASE_URL}/api/purchase-orders/${existingPoId}`);
          if (r.status() === 200) {
            const detail = await r.json() as PoDetailResponse;
            const line = (detail.lines ?? []).find((l) => l.vendorItemId === vendorItemBId);
            snapshotByPoId.set(existingPoId, line?.orderedQty ?? 0);
          }
        }

        // -----------------------------------------------------------------------
        // Step 4: route the source line (orderedQty=5) to vendorItemB
        // -----------------------------------------------------------------------
        const routeRes = await page.request.post(
          `${BASE_URL}/api/purchase-orders/${poId}/route-lines`,
          {
            data: {
              lines: [{ poLineId, targetVendorItemId: vendorItemBId }],
            },
            headers: { 'Content-Type': 'application/json' },
          },
        );

        expect(
          routeRes.status(),
          `Route-lines must return 200, got ${routeRes.status()}: ${await routeRes.text()}`,
        ).toBe(200);

        const routeBody = await routeRes.json() as RouteResponse;

        // -----------------------------------------------------------------------
        // Step 5: assert routing response references a PRE-EXISTING dest PO
        // -----------------------------------------------------------------------
        expect(
          routeBody.data?.routedLines,
          'routedLines must be 1',
        ).toBe(1);

        expect(
          routeBody.data?.affectedPOIds?.length,
          'Exactly one destination PO should be referenced',
        ).toBe(1);

        const destPoId = routeBody.data!.affectedPOIds[0];

        expect(
          existingPendingPoIds.has(destPoId),
          `Destination PO (${destPoId}) must be one of the pre-existing pending POs for vendorB ` +
          `[${[...existingPendingPoIds].join(', ')}] — a new PO must NOT have been created`,
        ).toBe(true);

        // -----------------------------------------------------------------------
        // Step 6: verify merged quantity on the destination PO
        //
        //   orderedQtyBefore = existing line qty recorded in the snapshot
        //   routedQty        = source line orderedQty = 5
        //   Expected after merge: orderedQty = orderedQtyBefore + 5
        // -----------------------------------------------------------------------
        const destPoDetailRes = await page.request.get(
          `${BASE_URL}/api/purchase-orders/${destPoId}`,
        );

        expect(
          destPoDetailRes.status(),
          'GET destination PO detail must return 200',
        ).toBe(200);

        const destPoDetail = await destPoDetailRes.json() as PoDetailResponse;
        const destLines = destPoDetail.lines ?? [];

        // Exactly one line for vendorItemB — no duplicate insertion
        const linesForVendorItemB = destLines.filter((l) => l.vendorItemId === vendorItemBId);
        expect(
          linesForVendorItemB.length,
          'Destination PO must have exactly ONE line for vendorItemB — no duplicate line inserted',
        ).toBe(1);

        const mergedLine = linesForVendorItemB[0];
        const qtyBefore = snapshotByPoId.get(destPoId) ?? 0;
        const expectedQty = qtyBefore + 5;

        expect(
          mergedLine.orderedQty,
          `Merged orderedQty must equal priorQty(${qtyBefore}) + routedQty(5) = ${expectedQty}`,
        ).toBe(expectedQty);

        // caseQuantity is also summed
        // (pre-existing line caseQuantity may differ; we check it increased by 5)
        // Using orderedQty as proxy since fixture sets caseQuantity == orderedQty.
        expect(
          mergedLine.caseQuantity,
          `Merged caseQuantity must equal priorQty(${qtyBefore}) + routedCaseQty(5) = ${expectedQty}`,
        ).toBe(expectedQty);

        // -----------------------------------------------------------------------
        // Step 7: verify source PO line was removed
        // -----------------------------------------------------------------------
        const srcPoDetailRes = await page.request.get(
          `${BASE_URL}/api/purchase-orders/${poId}`,
        );

        if (srcPoDetailRes.status() === 200) {
          const srcPoDetail = await srcPoDetailRes.json() as PoDetailResponse;
          const srcLines = srcPoDetail.lines ?? [];
          const srcLine = srcLines.find((l) => l.id === poLineId);

          if (srcLine) {
            expect(
              srcLine.caseQuantity ?? 0,
              'Routed source PO line must have caseQuantity = 0',
            ).toBe(0);
          }
          // Line absent entirely is also acceptable
        }
      } finally {
        // -----------------------------------------------------------------------
        // Cleanup
        //
        // Run the fixture teardown first.  It reads po_routing_audit to discover
        // which dest PO(s) were created and deletes them.  This handles the case
        // where routing succeeded and the audit references the dest PO.
        //
        // Then delete the pre-created dest PO directly as a belt-and-suspenders
        // fallback (idempotent — harmless if already deleted by the fixture teardown
        // or if it never got used as the merge target).
        // -----------------------------------------------------------------------
        await page.request.delete(
          `${BASE_URL}/api/dev/test/po-route-fixture/${poId}?inventoryItemId=${inventoryItemId}`,
        );

        if (preCreatedDestPoId) {
          // Silently ignore 404 (already cleaned up) or 204/200 (deleted now)
          await page.request.delete(
            `${BASE_URL}/api/purchase-orders/${preCreatedDestPoId}`,
          );
        }
      }
    },
  );
});
