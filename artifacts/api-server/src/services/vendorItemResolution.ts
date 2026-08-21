/**
 * Shared vendor-item get-or-create (PM-approved identity contract).
 *
 * ALL vendor-item creation paths must go through this function so duplicate
 * handling is identical everywhere. Before this existed, four paths inserted
 * rows with divergent behavior (Orderly importer, manual endpoint, order-guide
 * processor, PO on-the-fly creation) and produced thousands of duplicates.
 *
 * Identity contract (mirrors the partial unique index
 * vendor_items_vendor_item_sku_uniq):
 *
 *  - Real SKU (non-null, non-blank): identity is the RAW
 *    (vendor_id, inventory_item_id, vendor_sku) triple. No trimming or case
 *    normalization is applied — PM held SKU normalization out of scope.
 *    Insert races are settled by the DB index: we insert with
 *    ON CONFLICT DO NOTHING against the partial index and re-select the
 *    winner if our insert was skipped.
 *
 *  - NULL/blank SKU: deliberately unconstrained at the DB level (PM: NULL-SKU
 *    behavior must not be broadened). The shared behavior here preserves what
 *    the PO paths always did: reuse ANY existing row for the
 *    (vendor, inventory item) pair rather than creating a parallel SKU-less
 *    row; only when the pair has no row at all is one created.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { vendorItems, type InsertVendorItem, type VendorItem } from "@workspace/db";

/** Any drizzle handle (db or transaction) that can run the queries below. */
type Executor = typeof db;

export function isRealSku(sku: string | null | undefined): sku is string {
  return sku != null && sku.trim() !== "";
}

export interface VendorItemResolution {
  vendorItem: VendorItem;
  /** true only when this call inserted the row. */
  created: boolean;
}

export class VendorItemPackConflictError extends Error {
  constructor(
    public readonly vendorItemId: string,
    public readonly existingCaseSize: number | null,
    public readonly requestedCaseSize: number | null,
  ) {
    super("A vendor SKU already exists with incompatible pack geometry.");
    this.name = "VendorItemPackConflictError";
  }
}

function assertCompatibleCaseSize(existing: VendorItem, requested: InsertVendorItem): void {
  const existingCaseSize = existing.caseSize;
  const requestedCaseSize = requested.caseSize;
  if (
    typeof existingCaseSize === "number" &&
    typeof requestedCaseSize === "number" &&
    Number.isFinite(existingCaseSize) &&
    Number.isFinite(requestedCaseSize) &&
    Math.abs(existingCaseSize - requestedCaseSize) > Math.max(existingCaseSize, requestedCaseSize) * 0.01
  ) {
    throw new VendorItemPackConflictError(existing.id, existingCaseSize, requestedCaseSize);
  }
}

export async function getOrCreateVendorItem(
  executor: Executor,
  values: InsertVendorItem,
): Promise<VendorItemResolution> {
  const { vendorId, inventoryItemId } = values;
  if (!vendorId || !inventoryItemId) {
    // The identity contract is meaningless without both halves; refuse rather
    // than insert an unresolvable row.
    throw new Error("getOrCreateVendorItem requires vendorId and inventoryItemId");
  }

  if (isRealSku(values.vendorSku)) {
    const identity = and(
      eq(vendorItems.vendorId, vendorId),
      eq(vendorItems.inventoryItemId, inventoryItemId),
      eq(vendorItems.vendorSku, values.vendorSku),
    );
    const [existing] = await executor.select().from(vendorItems).where(identity).limit(1);
    if (existing) {
      assertCompatibleCaseSize(existing, values);
      return { vendorItem: existing, created: false };
    }

    // Targetless ON CONFLICT DO NOTHING: Postgres arbiter inference rejects a
    // drizzle-rendered target for the partial index (42P10). The only other
    // constraint on this table is the primary key (never supplied here), so a
    // skipped insert can only mean the uniqueness index fired — the re-select
    // below then returns the race winner.
    const inserted = await executor
      .insert(vendorItems)
      .values(values)
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) return { vendorItem: inserted[0], created: true };

    // Lost the race — the winner's row is the identity now.
    const [winner] = await executor.select().from(vendorItems).where(identity).limit(1);
    if (!winner) throw new Error("vendor item insert conflicted but no existing row found");
    assertCompatibleCaseSize(winner, values);
    return { vendorItem: winner, created: false };
  }

  // NULL/blank SKU: reuse any row for the (vendor, inventory item) pair.
  const pair = and(
    eq(vendorItems.vendorId, vendorId),
    eq(vendorItems.inventoryItemId, inventoryItemId),
  );
  const [existing] = await executor.select().from(vendorItems).where(pair).limit(1);
  if (existing) {
    assertCompatibleCaseSize(existing, values);
    return { vendorItem: existing, created: false };
  }

  const [created] = await executor.insert(vendorItems).values(values).returning();
  return { vendorItem: created, created: true };
}
