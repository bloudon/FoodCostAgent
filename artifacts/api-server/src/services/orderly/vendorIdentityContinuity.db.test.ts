/**
 * Live development DB regression: a reconciled consolidation can commit while
 * retained invoices and financial ledger evidence preserve their original
 * vendor identity.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql as sqlRaw } from "drizzle-orm";
import {
  companies,
  companyStores,
  historicalInvoices,
  vendorDepositLedgerEvents,
  vendors,
} from "@workspace/db";
import { db } from "../../db";
import { applyVendorIdentityMerge } from "./vendorIdentityContinuity";

const SFX = `vendor-identity-${Date.now().toString(36)}`;
const COMPANY = `vi-company-${SFX}`;
const STORE = `vi-store-${SFX}`;
const GFS = `vi-gfs-${SFX}`;
const GORDON = `vi-gordon-${SFX}`;
const BATCH = `vi-batch-${SFX}`;
const GFS_INVOICE = `vi-invoice-gfs-${SFX}`;
const GORDON_INVOICE = `vi-invoice-gordon-${SFX}`;
const LEDGER_EVENT = `vi-ledger-${SFX}`;
const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;

async function cleanup() {
  await db.execute(sqlRaw`
    DELETE FROM vendor_identity_merge_audit
    WHERE company_id = ${COMPANY}
  `).catch(() => {});
  await db.transaction(async (tx: any) => {
    await tx.execute(sqlRaw`SET LOCAL app.allow_deposit_ledger_delete = 'on'`);
    await tx.delete(vendorDepositLedgerEvents)
      .where(eq(vendorDepositLedgerEvents.companyId, COMPANY));
  }).catch(() => {});
  await db.delete(historicalInvoices).where(eq(historicalInvoices.companyId, COMPANY)).catch(() => {});
  await db.delete(vendors).where(eq(vendors.companyId, COMPANY)).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, COMPANY)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, COMPANY)).catch(() => {});
}

beforeAll(async () => {
  if (SKIP) return;
  await cleanup();
  await db.insert(companies).values({
    id: COMPANY,
    name: `Vendor Identity Test ${SFX}`,
    country: "US",
    timezone: "America/New_York",
    preferredUnitSystem: "imperial",
    costingMethod: "last_cost",
    status: "active",
  });
  await db.insert(companyStores).values({
    id: STORE, companyId: COMPANY, code: `VI-${SFX}`.slice(0, 12), name: "Vendor Identity Store", status: "active",
  });
  await db.insert(vendors).values([
    { id: GFS, companyId: COMPANY, name: "GFs Store", orderGuideType: "manual", active: 1, receiveByUnit: 0, requires1099: 0 },
    { id: GORDON, companyId: COMPANY, name: "Gordon Food Service", orderGuideType: "manual", active: 1, receiveByUnit: 0, requires1099: 0 },
  ]);
  await db.insert(historicalInvoices).values([
    {
      id: GFS_INVOICE, companyId: COMPANY, storeId: STORE, vendorId: GFS, importBatchId: BATCH,
      sourceSystem: "ORDERLY", sourcePropertyId: `property-${SFX}`, sourceInvoiceId: `gfs-${SFX}`,
      invoiceNumber: "963139987", invoiceDate: "2026-05-01", invoicePeriod: "2026-05",
      vendorNameSnapshot: "GFs Store", vendorExternalIdSnapshot: "25636",
      sourceSnapshot: { test: "gfs" }, materialHash: `gfs-hash-${SFX}`,
    },
    {
      id: GORDON_INVOICE, companyId: COMPANY, storeId: STORE, vendorId: GORDON, importBatchId: BATCH,
      sourceSystem: "ORDERLY", sourcePropertyId: `property-${SFX}`, sourceInvoiceId: `gordon-${SFX}`,
      invoiceNumber: "963139987", invoiceDate: "2026-05-02", invoicePeriod: "2026-05",
      vendorNameSnapshot: "Gordon Food Service", vendorExternalIdSnapshot: "487",
      sourceSnapshot: { test: "gordon" }, materialHash: `gordon-hash-${SFX}`,
    },
  ]);
  await db.insert(vendorDepositLedgerEvents).values({
    id: LEDGER_EVENT,
    companyId: COMPANY,
    storeId: STORE,
    vendorId: GFS,
    batchId: BATCH,
    sourceSystem: "ORDERLY",
    sourcePropertyId: `property-${SFX}`,
    sourceInvoiceId: `ledger-${SFX}`,
    invoiceNumber: `LEDGER-${SFX}`,
    invoiceDate: "2026-05-03",
    ratePerKeg: 50,
    signedAmount: 50,
    signedKegCount: 1,
    derivation: { test: true },
  });
});

afterAll(async () => {
  if (!SKIP) await cleanup();
});

describe.skipIf(SKIP)("vendor identity consolidation immutable evidence", () => {
  it("commits mutable identity consolidation while retaining invoice and ledger provenance", async () => {
    const result = await applyVendorIdentityMerge({
      companyId: COMPANY,
      survivorVendorId: GORDON,
      loserVendorId: GFS,
      evidenceReportHash: `reviewed-${SFX}`,
      decisionScope: { approvalReference: "development integration test" },
    });
    expect(result.result).toBe("applied");

    const invoices = await db.select({
      id: historicalInvoices.id,
      vendorId: historicalInvoices.vendorId,
      materialHash: historicalInvoices.materialHash,
    }).from(historicalInvoices).where(eq(historicalInvoices.companyId, COMPANY));
    expect(invoices).toEqual(expect.arrayContaining([
      { id: GFS_INVOICE, vendorId: GFS, materialHash: `gfs-hash-${SFX}` },
      { id: GORDON_INVOICE, vendorId: GORDON, materialHash: `gordon-hash-${SFX}` },
    ]));
    const ledger = await db.select({
      id: vendorDepositLedgerEvents.id,
      vendorId: vendorDepositLedgerEvents.vendorId,
      sourceInvoiceId: vendorDepositLedgerEvents.sourceInvoiceId,
      signedAmount: vendorDepositLedgerEvents.signedAmount,
      signedKegCount: vendorDepositLedgerEvents.signedKegCount,
    })
      .from(vendorDepositLedgerEvents)
      .where(eq(vendorDepositLedgerEvents.companyId, COMPANY));
    expect(ledger).toEqual([{
      id: LEDGER_EVENT,
      vendorId: GFS,
      sourceInvoiceId: `ledger-${SFX}`,
      signedAmount: 50,
      signedKegCount: 1,
    }]);

    const loser = await db.select({ active: vendors.active })
      .from(vendors)
      .where(eq(vendors.id, GFS));
    expect(loser).toEqual([{ active: 0 }]);
    const audit = await db.execute(sqlRaw`
      SELECT identity_preservation AS "identityPreservation"
      FROM vendor_identity_merge_audit
      WHERE company_id = ${COMPANY}
        AND survivor_vendor_id = ${GORDON}
        AND loser_vendor_id = ${GFS}
    `);
    expect((audit as any).rows?.[0]?.identityPreservation ?? (audit as any)[0]?.identityPreservation)
      .toMatchObject({
        immutableEvidence: {
          "historical_invoices.vendor_id": 1,
          "vendor_deposit_ledger_events.vendor_id": 1,
        },
      });
  });
});