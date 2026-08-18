/**
 * Store-scoped authorization for vendor invoice import batches.
 *
 * Proves that a store-scoped caller (accessible store list limited to one
 * store) cannot list — and therefore cannot select — batches bound to another
 * store in the same company. Cross-store financial metadata (filenames,
 * vendors, totals) must never leak.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { vendorInvoiceImportBatches } from "@workspace/db";
import {
  listVendorInvoiceBatches,
  getBatchDestinationStoreId,
} from "./vendorInvoiceImport";

// Unique suffix so fixtures never collide with real dev-DB rows or other suites.
const SFX = `authz-${Date.now().toString(36)}`;
const COMPANY_ID = `inttest-vii-co-${SFX}`;
const STORE_A = `inttest-vii-storeA-${SFX}`;
const STORE_B = `inttest-vii-storeB-${SFX}`;
const BATCH_A = `inttest-vii-batchA-${SFX}`;
const BATCH_B = `inttest-vii-batchB-${SFX}`;

async function cleanup() {
  await db.delete(vendorInvoiceImportBatches)
    .where(eq(vendorInvoiceImportBatches.companyId, COMPANY_ID));
}

beforeAll(async () => {
  await cleanup();
  const common = {
    companyId: COMPANY_ID,
    sourceSystem: "ORDERLY",
    sourcePropertyId: `prop-${SFX}`,
    sourcePropertyBindingId: `bind-${SFX}`,
    parserVersion: "1.0",
    invoiceCount: 1,
    lineCount: 1,
    totalAmount: 100,
    invoiceTotals: [],
    status: "pending_review",
  };
  await db.insert(vendorInvoiceImportBatches).values([
    {
      ...common,
      id: BATCH_A,
      destinationStoreId: STORE_A,
      fileHash: `hash-A-${SFX}`,
      originalFilename: "store-a-vendor.xlsx",
      vendorNameDetected: "Store A Vendor",
    },
    {
      ...common,
      id: BATCH_B,
      destinationStoreId: STORE_B,
      fileHash: `hash-B-${SFX}`,
      originalFilename: "store-b-vendor.xlsx",
      vendorNameDetected: "Store B Vendor",
    },
  ]);
});

afterAll(cleanup);

describe("vendor invoice import — store-scoped listing", () => {
  it("a store-scoped caller sees only batches for their accessible store", async () => {
    const visible = await listVendorInvoiceBatches(COMPANY_ID, [STORE_A]);
    expect(visible.map((b) => b.id)).toEqual([BATCH_A]);
    // No cross-store metadata leaks through any field of the result.
    expect(JSON.stringify(visible)).not.toContain("Store B Vendor");
    expect(JSON.stringify(visible)).not.toContain("store-b-vendor.xlsx");
  });

  it("a caller with no accessible stores sees nothing", async () => {
    expect(await listVendorInvoiceBatches(COMPANY_ID, [])).toEqual([]);
  });

  it("a company-wide caller sees both batches", async () => {
    const visible = await listVendorInvoiceBatches(COMPANY_ID, [STORE_A, STORE_B]);
    expect(visible.map((b) => b.id).sort()).toEqual([BATCH_A, BATCH_B]);
  });

  it("selecting a batch resolves its destination store for the route-level access check", async () => {
    // The detail routes authorize via canAccessStore(user, destinationStoreId);
    // this proves the inaccessible batch resolves to the OTHER store, so a
    // store-A-scoped user fails the check for batch B.
    expect(await getBatchDestinationStoreId(BATCH_B, COMPANY_ID)).toBe(STORE_B);
    expect(await getBatchDestinationStoreId(BATCH_A, COMPANY_ID)).toBe(STORE_A);
  });
});
