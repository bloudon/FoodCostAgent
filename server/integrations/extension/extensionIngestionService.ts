/**
 * Extension Pilot — Ingestion Service
 *
 * Processes a captured order-guide batch from the browser extension:
 *   1. Idempotency check (syncJobId + batchId)
 *   2. Verify captured supplier matches sync job expectation
 *   3. Match items by (vendorId, vendorSku) — scoped to the FnB vendor
 *   4. Derive prices via recordVendorPrice() — missing/zero prices are NEVER written
 *   5. Ambiguous/multi-UOM items → orderGuideLines needs_review
 *   6. Unmatched items → orderGuideLines needs_review
 *   7. Detect partial capture (capturedRowCount < visibleRowCount)
 *   8. Record diagnostics on extension_ingestion_batches
 */

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
  supplierSku:    string;
  rawDescription: string;
  rawPackSize:    string | null;
  rawCasePrice:   string | null;
  rawUnitPrice:   string | null;
  currency:       string;
  /** ISO date string only when the portal explicitly shows a price-effective date. */
  priceEffective: string | null;
  sourceItemId:   string | null;
}

export interface CaptureCompleteness {
  paginatedPages?:   number;
  /** Stated total from portal UI — null when not exposed. */
  expectedRowCount?: number | null;
  visibleRowCount:   number;
  capturedRowCount:  number;
}

export interface IngestBatchInput {
  syncJobId:    string;
  batchId:      string;
  companyId:    string;
  connectorId:  string;
  extensionVersion:  string;
  parserVersion:     string;
  capturedAt:   string;
  sourceUrl?:   string;
  capturedExternalSupplierId?:    string;
  capturedExternalSupplierName?:  string;
  capturedExternalLocationId?:    string;
  capturedExternalOrderGuideId?:  string;
  captureCompleteness?: CaptureCompleteness;
  items:        CapturedItem[];
}

export interface IngestBatchResult {
  batchDbId:        string;
  orderGuideId:     string;
  itemsSeen:        number;
  itemsMatched:     number;
  itemsUpdated:     number;
  itemsReview:      number;
  itemsRejected:    number;
  processingErrors: number;
  captureWarning:   string | null;
  alreadyProcessed: boolean;
}

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a raw price string into a positive number.
 * Returns null for missing, zero, or unparseable values.
 * Missing prices NEVER become zero-dollar updates.
 */
function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return isFinite(n) && n > 0 ? n : null;
}

/**
 * Detect UOM ambiguity: two or more distinct measurement-family tokens
 * in the pack string (e.g. "6/5 LB / EA", "CS/EA") signal multiple
 * ordering options — send to review rather than silently picking one.
 */
function isAmbiguousUom(rawPackSize: string | null): boolean {
  if (!rawPackSize) return false;
  const s      = rawPackSize.toUpperCase();
  const tokens = ["LB", "OZ", "KG", "GAL", "QT", "L ", "ML", "EA", "CT", "CS"];
  const found  = tokens.filter((u) => new RegExp(`\\b${u.trim()}\\b`).test(s));
  return found.length > 2;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function ingestExtensionBatch(
  input: IngestBatchInput
): Promise<IngestBatchResult> {
  const capturedAt = new Date(input.capturedAt);

  // ── 1. Idempotency ────────────────────────────────────────────────────────
  const [existing] = await db
    .select()
    .from(extensionIngestionBatches)
    .where(
      and(
        eq(extensionIngestionBatches.syncJobId, input.syncJobId),
        eq(extensionIngestionBatches.batchId,   input.batchId)
      )
    )
    .limit(1);

  if (existing && existing.status !== "processing") {
    return {
      batchDbId:        existing.id,
      orderGuideId:     "",
      itemsSeen:        existing.itemsSeen,
      itemsMatched:     existing.itemsMatched,
      itemsUpdated:     existing.itemsUpdated,
      itemsReview:      existing.itemsReview,
      itemsRejected:    existing.itemsRejected,
      processingErrors: existing.processingErrors,
      captureWarning:   existing.captureWarning,
      alreadyProcessed: true,
    };
  }

  // ── 2. Load sync job ─────────────────────────────────────────────────────
  const [job] = await db
    .select()
    .from(extensionSyncJobs)
    .where(eq(extensionSyncJobs.id, input.syncJobId))
    .limit(1);

  if (!job) throw new Error(`Sync job not found: ${input.syncJobId}`);

  // ── 3. Verify captured supplier matches job expectation ──────────────────
  if (
    job.externalSupplierId &&
    input.capturedExternalSupplierId &&
    job.externalSupplierId !== input.capturedExternalSupplierId
  ) {
    throw new Error(
      `Supplier mismatch: job expects ${job.externalSupplierId}, captured ${input.capturedExternalSupplierId}`
    );
  }

  // Verify location when both sides specify it
  if (
    job.externalLocationId &&
    input.capturedExternalLocationId &&
    job.externalLocationId !== input.capturedExternalLocationId
  ) {
    throw new Error(
      `Location mismatch: job expects ${job.externalLocationId}, captured ${input.capturedExternalLocationId}`
    );
  }

  // ── 4. Detect partial capture ────────────────────────────────────────────
  const cc = input.captureCompleteness;
  const captureWarning =
    cc && cc.capturedRowCount < cc.visibleRowCount ? "PARTIAL_CAPTURE" : null;

  // ── 5. Create / reuse batch diagnostics row ──────────────────────────────
  let batchRow = existing;
  if (!batchRow) {
    const [inserted] = await db
      .insert(extensionIngestionBatches)
      .values({
        syncJobId:                    input.syncJobId,
        batchId:                      input.batchId,
        companyId:                    input.companyId,
        connectorId:                  input.connectorId,
        extensionVersion:             input.extensionVersion,
        parserVersion:                input.parserVersion,
        capturedAt,
        sourceUrl:                    input.sourceUrl                    ?? null,
        capturedExternalSupplierId:   input.capturedExternalSupplierId   ?? null,
        capturedExternalSupplierName: input.capturedExternalSupplierName ?? null,
        capturedExternalLocationId:   input.capturedExternalLocationId   ?? null,
        capturedExternalOrderGuideId: input.capturedExternalOrderGuideId ?? null,
        itemsSeen:        input.items.length,
        paginatedPages:   cc?.paginatedPages   ?? null,
        expectedRowCount: cc?.expectedRowCount ?? null,
        visibleRowCount:  cc?.visibleRowCount  ?? null,
        capturedRowCount: cc?.capturedRowCount ?? null,
        captureWarning,
        status:           "processing",
      })
      .returning();
    batchRow = inserted;
  }

  // ── 6. Create order guide record for this capture ────────────────────────
  const [guide] = await db
    .insert(orderGuides)
    .values({
      companyId:                    input.companyId,
      vendorId:                     job.vendorId ?? null,
      vendorKey:                    input.connectorId,
      source:                       "browser_extension",
      rowCount:                     input.items.length,
      status:                       "approved",
      approvedAt:                   new Date(),
      transport:                    "browser_extension",
      syncJobId:                    input.syncJobId,
      customerSupplierConnectionId: job.customerSupplierConnectionId ?? null,
      externalSupplierId:           input.capturedExternalSupplierId   ?? null,
      externalSupplierName:         input.capturedExternalSupplierName ?? null,
      externalLocationId:           input.capturedExternalLocationId   ?? null,
      externalOrderGuideId:         input.capturedExternalOrderGuideId ?? null,
    })
    .returning();

  // ── 7. Load vendor items scoped to this FnB vendor ───────────────────────
  const allVendorItems = job.vendorId
    ? await db.select().from(vendorItems).where(eq(vendorItems.vendorId, job.vendorId))
    : [];

  const skuMap = new Map<string, typeof allVendorItems[number]>();
  for (const vi of allVendorItems) {
    if (vi.vendorSku) skuMap.set(vi.vendorSku.trim().toLowerCase(), vi);
  }

  // ── 8. Process items ─────────────────────────────────────────────────────
  let matched = 0, updated = 0, review = 0, rejected = 0, errors = 0;

  for (const item of input.items) {
    try {
      const casePrice = parsePrice(item.rawCasePrice);
      const unitPrice = parsePrice(item.rawUnitPrice);

      // No usable price — reject. Never write a zero-dollar update.
      if (casePrice === null && unitPrice === null) {
        rejected++;
        await db.insert(orderGuideLines).values({
          orderGuideId: guide.id,
          vendorSku:    item.supplierSku,
          productName:  item.rawDescription,
          packSize:     item.rawPackSize ?? "",
          price:        null,
          matchStatus:  "user_rejected",
        });
        continue;
      }

      // Ambiguous UOM → review regardless of match status
      if (isAmbiguousUom(item.rawPackSize)) {
        review++;
        await db.insert(orderGuideLines).values({
          orderGuideId: guide.id,
          vendorSku:    item.supplierSku,
          productName:  item.rawDescription,
          packSize:     item.rawPackSize ?? "",
          price:        casePrice ?? unitPrice,
          priceSource:  casePrice !== null ? "case" : "unit",
          matchStatus:  "needs_review",
        });
        continue;
      }

      const vi = skuMap.get(item.supplierSku.trim().toLowerCase());

      if (!vi) {
        review++;
        await db.insert(orderGuideLines).values({
          orderGuideId: guide.id,
          vendorSku:    item.supplierSku,
          productName:  item.rawDescription,
          packSize:     item.rawPackSize ?? "",
          price:        casePrice ?? unitPrice,
          priceSource:  casePrice !== null ? "case" : "unit",
          matchStatus:  "needs_review",
        });
        continue;
      }

      matched++;

      const hasCasePrice = casePrice !== null;
      const price        = hasCasePrice ? casePrice! : unitPrice!;
      const priceBasis: "case" | "unit" = hasCasePrice ? "case" : "unit";

      await recordVendorPrice({
        vendorItemId:    vi.id,
        inventoryItemId: vi.inventoryItemId,
        companyId:       input.companyId,
        priceBasis,
        price,
        caseSize:        vi.caseSize    ?? 1,
        innerPackSize:   vi.innerPackSize ?? undefined,
        packUom:         vi.packUom      ?? undefined,
        source:          "connector",
        representsActualPurchase: false,
        referenceId:     input.syncJobId,
      });

      // Stamp priceTransport on the vendor_item for provenance display
      await db
        .update(vendorItems)
        .set({ priceTransport: "browser_extension" } as any)
        .where(eq(vendorItems.id, vi.id));

      updated++;

      await db.insert(orderGuideLines).values({
        orderGuideId:          guide.id,
        vendorSku:             item.supplierSku,
        productName:           item.rawDescription,
        packSize:              item.rawPackSize ?? "",
        price,
        priceSource:           priceBasis,
        matchStatus:           "auto_matched",
        matchedInventoryItemId: vi.inventoryItemId,
        matchConfidence:       100,
      });
    } catch (err) {
      errors++;
      console.error(`[ExtensionIngest] SKU ${item.supplierSku}:`, err);
    }
  }

  // ── 9. Finalise batch diagnostics ────────────────────────────────────────
  await db
    .update(extensionIngestionBatches)
    .set({
      itemsMatched:     matched,
      itemsUpdated:     updated,
      itemsReview:      review,
      itemsRejected:    rejected,
      processingErrors: errors,
      captureWarning,
      status:           "complete",
      processedAt:      new Date(),
    })
    .where(eq(extensionIngestionBatches.id, batchRow.id));

  await db
    .update(orderGuides)
    .set({ rowCount: input.items.length })
    .where(eq(orderGuides.id, guide.id));

  return {
    batchDbId:        batchRow.id,
    orderGuideId:     guide.id,
    itemsSeen:        input.items.length,
    itemsMatched:     matched,
    itemsUpdated:     updated,
    itemsReview:      review,
    itemsRejected:    rejected,
    processingErrors: errors,
    captureWarning,
    alreadyProcessed: false,
  };
}
