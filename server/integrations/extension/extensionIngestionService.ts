/**
 * Extension Pilot — Ingestion Service
 *
 * Processes a captured order-guide batch from the browser extension:
 *   1. Idempotency check (syncJobId + batchId)
 *   2. Verify captured supplier matches sync job expectation
 *   3. Match items by (vendorId, vendorSku) — scoped to the FnB vendor
 *   4. Derive prices via existing pack parser + recordVendorPrice()
 *   5. Ambiguous/multi-UOM or unmatched → orderGuideLines with needs_review
 *   6. Record diagnostics on extension_ingestion_batches
 */

import crypto from "crypto";
import { db } from "../../db";
import { eq, and, sql } from "drizzle-orm";
import {
  extensionIngestionBatches,
  extensionSyncJobs,
  orderGuides,
  orderGuideLines,
  vendorItems,
} from "../../../shared/schema";
import { recordVendorPrice } from "../../services/vendorPriceService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapturedItem {
  /** Supplier's own SKU for this product */
  supplierSku: string;
  rawDescription: string;
  /** Raw pack-size string from portal, e.g. "6/5 LB" or "25 LB" */
  rawPackSize: string | null;
  /** Raw case price as string from portal — null when not shown */
  rawCasePrice: string | null;
  /** Raw unit price as string from portal — null when not shown */
  rawUnitPrice: string | null;
  /** ISO 4217 currency code, default "USD" */
  currency: string;
  /**
   * ISO date when the supplier stated this price is effective.
   * null when the portal does not display a price-effective date.
   */
  priceEffective: string | null;
  /** sourceItemId from portal when available */
  sourceItemId: string | null;
}

export interface IngestBatchInput {
  syncJobId: string;
  /** Caller-supplied idempotency key — unique per job */
  batchId: string;
  companyId: string;
  connectorId: string;
  extensionVersion?: string;
  parserVersion?: string;
  capturedAt: string; // ISO datetime
  sourceUrl?: string;
  capturedExternalSupplierId?: string;
  capturedExternalSupplierName?: string;
  capturedExternalLocationId?: string;
  capturedExternalOrderGuideId?: string;
  items: CapturedItem[];
}

export interface IngestBatchResult {
  batchDbId: string;
  orderGuideId: string;
  itemsSeen: number;
  itemsMatched: number;
  itemsUpdated: number;
  itemsReview: number;
  itemsRejected: number;
  processingErrors: number;
  alreadyProcessed: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return isNaN(n) || n <= 0 ? null : n;
}

/**
 * Very light UOM ambiguity check.
 * Returns true when the rawPackSize string contains multiple distinct UOM tokens
 * that could be interpreted differently (e.g. "6/5 LB / EA" or "CS/EA").
 * False means the capture is unambiguous enough to price at case level.
 */
function isAmbiguousUom(rawPackSize: string | null): boolean {
  if (!rawPackSize) return false;
  const cleaned = rawPackSize.toUpperCase();
  const uomTokens = ["LB", "OZ", "KG", "GAL", "QT", "L", "ML", "EA", "CT", "CS"];
  const found = uomTokens.filter((u) => new RegExp(`\\b${u}\\b`).test(cleaned));
  return found.length > 2;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function ingestExtensionBatch(
  input: IngestBatchInput
): Promise<IngestBatchResult> {
  const capturedAt = new Date(input.capturedAt);

  // ── 1. Idempotency — check for existing batch with same (syncJobId, batchId) ──
  const [existing] = await db
    .select()
    .from(extensionIngestionBatches)
    .where(
      and(
        eq(extensionIngestionBatches.syncJobId, input.syncJobId),
        eq(extensionIngestionBatches.batchId, input.batchId)
      )
    )
    .limit(1);

  if (existing && existing.status !== "processing") {
    return {
      batchDbId: existing.id,
      orderGuideId: "",
      itemsSeen: existing.itemsSeen,
      itemsMatched: existing.itemsMatched,
      itemsUpdated: existing.itemsUpdated,
      itemsReview: existing.itemsReview,
      itemsRejected: existing.itemsRejected,
      processingErrors: existing.processingErrors,
      alreadyProcessed: true,
    };
  }

  // ── 2. Load sync job for context ────────────────────────────────────────────
  const [job] = await db
    .select()
    .from(extensionSyncJobs)
    .where(eq(extensionSyncJobs.id, input.syncJobId))
    .limit(1);

  if (!job) throw new Error(`Sync job not found: ${input.syncJobId}`);

  // ── 3. Verify captured supplier matches the sync job expectation ─────────────
  if (
    job.externalSupplierId &&
    input.capturedExternalSupplierId &&
    job.externalSupplierId !== input.capturedExternalSupplierId
  ) {
    throw new Error(
      `Supplier mismatch: job expects ${job.externalSupplierId}, got ${input.capturedExternalSupplierId}`
    );
  }

  // ── 4. Create (or reuse) the batch diagnostics row ──────────────────────────
  let batchRow = existing;
  if (!batchRow) {
    const [inserted] = await db
      .insert(extensionIngestionBatches)
      .values({
        syncJobId: input.syncJobId,
        batchId: input.batchId,
        companyId: input.companyId,
        connectorId: input.connectorId,
        extensionVersion: input.extensionVersion ?? null,
        parserVersion: input.parserVersion ?? null,
        capturedAt,
        sourceUrl: input.sourceUrl ?? null,
        capturedExternalSupplierId: input.capturedExternalSupplierId ?? null,
        capturedExternalSupplierName: input.capturedExternalSupplierName ?? null,
        capturedExternalLocationId: input.capturedExternalLocationId ?? null,
        capturedExternalOrderGuideId: input.capturedExternalOrderGuideId ?? null,
        itemsSeen: input.items.length,
        status: "processing",
      })
      .returning();
    batchRow = inserted;
  }

  // ── 5. Create an order guide record for this capture ────────────────────────
  const vendorKey = input.connectorId;
  const [guide] = await db
    .insert(orderGuides)
    .values({
      companyId: input.companyId,
      vendorId: job.vendorId ?? null,
      vendorKey,
      source: "browser_extension",
      rowCount: input.items.length,
      status: "approved",
      approvedAt: new Date(),
      transport: "browser_extension",
      syncJobId: input.syncJobId,
      customerSupplierConnectionId: job.customerSupplierConnectionId ?? null,
      externalSupplierId: input.capturedExternalSupplierId ?? null,
      externalSupplierName: input.capturedExternalSupplierName ?? null,
      externalLocationId: input.capturedExternalLocationId ?? null,
      externalOrderGuideId: input.capturedExternalOrderGuideId ?? null,
    })
    .returning();

  // ── 6. Load all vendor items for this vendor (scoped to the FnB vendor) ─────
  const allVendorItems = job.vendorId
    ? await db
        .select()
        .from(vendorItems)
        .where(eq(vendorItems.vendorId, job.vendorId))
    : [];

  const skuMap = new Map<string, typeof allVendorItems[number]>();
  for (const vi of allVendorItems) {
    if (vi.vendorSku) skuMap.set(vi.vendorSku.trim().toLowerCase(), vi);
  }

  // ── 7. Process each captured item ────────────────────────────────────────────
  let matched = 0;
  let updated = 0;
  let review = 0;
  let rejected = 0;
  let errors = 0;

  for (const item of input.items) {
    try {
      const casePrice = parsePrice(item.rawCasePrice);
      const unitPrice = parsePrice(item.rawUnitPrice);

      // No usable price at all → reject
      if (casePrice === null && unitPrice === null) {
        rejected++;
        await db.insert(orderGuideLines).values({
          orderGuideId: guide.id,
          vendorSku: item.supplierSku,
          productName: item.rawDescription,
          packSize: item.rawPackSize ?? "",
          price: null,
          matchStatus: "user_rejected",
        });
        continue;
      }

      // Ambiguous UOM → send to review regardless of match
      if (isAmbiguousUom(item.rawPackSize)) {
        review++;
        await db.insert(orderGuideLines).values({
          orderGuideId: guide.id,
          vendorSku: item.supplierSku,
          productName: item.rawDescription,
          packSize: item.rawPackSize ?? "",
          price: casePrice ?? unitPrice ?? null,
          priceSource: casePrice !== null ? "case" : "unit",
          matchStatus: "needs_review",
        });
        continue;
      }

      // SKU match
      const vi = skuMap.get(item.supplierSku.trim().toLowerCase());

      if (!vi) {
        // Unmatched → review
        review++;
        await db.insert(orderGuideLines).values({
          orderGuideId: guide.id,
          vendorSku: item.supplierSku,
          productName: item.rawDescription,
          packSize: item.rawPackSize ?? "",
          price: casePrice ?? unitPrice ?? null,
          priceSource: casePrice !== null ? "case" : "unit",
          matchStatus: "needs_review",
        });
        continue;
      }

      matched++;

      // Determine price basis
      const hasCasePrice = casePrice !== null;
      const price = hasCasePrice ? casePrice! : unitPrice!;
      const priceBasis: "case" | "unit" = hasCasePrice ? "case" : "unit";

      // Record price through shared write gate
      await recordVendorPrice({
        vendorItemId: vi.id,
        inventoryItemId: vi.inventoryItemId,
        companyId: input.companyId,
        priceBasis,
        price,
        caseSize: vi.caseSize ?? 1,
        innerPackSize: vi.innerPackSize ?? undefined,
        packUom: vi.packUom ?? undefined,
        source: "connector",
        representsActualPurchase: false,
        referenceId: input.syncJobId,
      });

      // Also stamp priceTransport on the vendor_item
      await db
        .update(vendorItems)
        .set({ priceTransport: "browser_extension" } as any)
        .where(eq(vendorItems.id, vi.id));

      updated++;

      // Write a matched order guide line for the review record
      await db.insert(orderGuideLines).values({
        orderGuideId: guide.id,
        vendorSku: item.supplierSku,
        productName: item.rawDescription,
        packSize: item.rawPackSize ?? "",
        price,
        priceSource: priceBasis,
        matchStatus: "auto_matched",
        matchedInventoryItemId: vi.inventoryItemId,
        matchConfidence: 100,
      });
    } catch (err) {
      errors++;
      console.error(`[ExtensionIngest] Error processing SKU ${item.supplierSku}:`, err);
    }
  }

  // ── 8. Finalise diagnostics row ──────────────────────────────────────────────
  await db
    .update(extensionIngestionBatches)
    .set({
      itemsMatched: matched,
      itemsUpdated: updated,
      itemsReview: review,
      itemsRejected: rejected,
      processingErrors: errors,
      status: "complete",
      processedAt: new Date(),
    })
    .where(eq(extensionIngestionBatches.id, batchRow.id));

  // ── 9. Update order guide row count to actuals ───────────────────────────────
  await db
    .update(orderGuides)
    .set({ rowCount: input.items.length })
    .where(eq(orderGuides.id, guide.id));

  return {
    batchDbId: batchRow.id,
    orderGuideId: guide.id,
    itemsSeen: input.items.length,
    itemsMatched: matched,
    itemsUpdated: updated,
    itemsReview: review,
    itemsRejected: rejected,
    processingErrors: errors,
    alreadyProcessed: false,
  };
}
