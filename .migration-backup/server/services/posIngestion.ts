/**
 * POS Ingestion Service
 * Normalizes PosSalesBatch data and writes it into daily_menu_item_sales,
 * then triggers TheoreticalUsageService — identical pipeline to CSV upload.
 *
 * Idempotency model (Square):
 *   One daily_menu_item_sales row is written per (connectionId, orderId, lineItemId).
 *   The partial unique index dmis_pos_line_uniq on those three columns makes every
 *   subsequent sync an upsert — re-ingesting the same order overwrites the existing
 *   row rather than inserting a duplicate.
 *
 *   Return (refund) lines arrive with negative quantities and are stored as-is, so
 *   the net qty_sold across all rows for a (menuItem, date, store) naturally reflects
 *   the post-refund total.
 *
 * Skip-reason taxonomy:
 *   rowsSkipped  — line HAS a catalog_object_id but no FnB menu item mapping.
 *                  Users should edit item mappings to capture these.
 *   adhocItems   — line has NO catalog_object_id; it is a custom/ad hoc item or a
 *                  custom-dollar refund that can never be mapped to a catalog entry.
 *                  Stored in the sync job row so managers can see what was skipped.
 *
 * Modifier handling:
 *   square.ts emits each modifier (with a catalog_object_id) as a separate PosSalesLine.
 *   They flow through the same mapping lookup as regular variation lines — no special
 *   casing required here.
 *
 * Quantity precision:
 *   square.ts already uses parseFloat for quantity; posIngestion stores it as-is (real).
 *   Fractional quantities (e.g. "0.5" for weighed items) are preserved throughout.
 */
import { storage } from "../storage";
import type { PosSalesBatch } from "../integrations/pos/types";
import { TheoreticalUsageService } from "./theoreticalUsage";

export interface IngestBatchOptions {
  companyId: string;
  connectionId: string;
  connectedByUserId: string; // used as uploadedBy in the batch record
}

/**
 * Represents a sale line that could not be attributed to any catalog entry.
 * Persisted in pos_sync_jobs.adhoc_items so managers can review them.
 */
export interface AdhocItem {
  /** Display name of the item as it appeared on the order */
  name: string;
  /** Quantity sold (negative for refunds) */
  quantity: number;
  /** Square order ID — used to cross-reference in Square Dashboard */
  orderId: string;
  /**
   * Why the item is ad hoc:
   *   "no_catalog_id"         — positive sale, no catalog_object_id (open item / ad hoc)
   *   "custom_dollar_refund"  — negative qty refund with no catalog_object_id
   */
  reason: "no_catalog_id" | "custom_dollar_refund";
}

/**
 * Ingest one PosSalesBatch (one location × one business date).
 *
 * Returns:
 *  - rowsIngested  — lines successfully written to daily_menu_item_sales
 *  - rowsSkipped   — lines that had a catalog_object_id but no FnB mapping
 *  - adhocItems    — lines with no catalog_object_id (ad hoc items / custom-dollar refunds)
 */
export async function ingestSalesBatch(
  batch: PosSalesBatch,
  opts: IngestBatchOptions,
): Promise<{ rowsIngested: number; rowsSkipped: number; adhocItems: AdhocItem[] }> {
  const { companyId, connectionId, connectedByUserId } = opts;

  // 1. Find the store mapped to this location
  const locationMappings = await storage.getPosLocationMappings(connectionId);
  const locationMapping = locationMappings.find(
    (m) => m.externalLocationId === batch.locationId,
  );
  if (!locationMapping?.storeId) {
    console.warn(
      `[POS Ingest] No store mapped for location ${batch.locationId} on connection ${connectionId} — skipping`,
    );
    return { rowsIngested: 0, rowsSkipped: 0, adhocItems: [] };
  }
  const storeId = locationMapping.storeId;

  // 2. Load item mappings for this connection
  const itemMappings = await storage.getPosItemMappings(connectionId);
  const byVariation = new Map(itemMappings.map((m) => [m.externalVariationId, m]));

  // 3. Create a batch record (mirrors CSV upload batches for consistency)
  const [salesYear, salesMonth, salesDay] = batch.businessDate.split("-").map(Number);
  const salesDate = new Date(Date.UTC(salesYear, salesMonth - 1, salesDay));

  const batchRecord = await storage.createSalesUploadBatch({
    companyId,
    storeId,
    uploadedBy: connectedByUserId,
    salesDate,
    fileName: `square_sync_${batch.businessDate}_loc${batch.locationId.slice(-6)}`,
    status: "processing",
  });

  // 4. Build per-line records — no aggregation.
  //    Each POS order line (including refund/return lines) becomes its own row,
  //    identified by (connectionId, externalOrderId, externalLineItemId).
  const salesRecords: Parameters<typeof storage.upsertPosDailyMenuItemSales>[0] = [];
  let rowsSkipped = 0;
  const adhocItems: AdhocItem[] = [];

  for (const line of batch.lines) {
    // Skip zero-quantity lines (fully voided before close)
    if (line.quantity === 0) continue;

    // ── Ad hoc / custom-dollar: no catalog_object_id ────────────────────────
    // These cannot be mapped to a FnB menu item regardless of mappings.
    // Capture them in adhocItems for the sync job log instead of silently
    // dropping them in the generic rowsSkipped counter.
    if (!line.externalVariationId) {
      const reason: AdhocItem["reason"] =
        line.quantity < 0 ? "custom_dollar_refund" : "no_catalog_id";
      adhocItems.push({
        name: line.itemName,
        quantity: line.quantity,
        orderId: line.externalOrderId,
        reason,
      });
      if (reason === "custom_dollar_refund") {
        console.log(
          `[POS Ingest] Custom-dollar refund on order ${line.externalOrderId}` +
          ` (no catalog_object_id — recorded as ad hoc)`,
        );
      } else {
        console.log(
          `[POS Ingest] Ad hoc item "${line.itemName}" on order ${line.externalOrderId}` +
          ` (no catalog_object_id — recorded as ad hoc)`,
        );
      }
      continue;
    }

    // ── Has catalog ID but no FnB mapping ───────────────────────────────────
    // Counted in rowsSkipped so users know to update item mappings.
    const mapping = byVariation.get(line.externalVariationId);
    if (!mapping?.menuItemId) {
      rowsSkipped++;
      continue;
    }

    salesRecords.push({
      companyId,
      storeId,
      menuItemId: mapping.menuItemId,
      salesDate,
      daypartId: null,
      qtySold: line.quantity,          // negative for refund lines; fractional for weighed items
      netSales: line.netSalesMoney / 100, // negative for refund lines
      sourceBatchId: batchRecord.id,
      connectionId,
      externalOrderId: line.externalOrderId,
      externalLineItemId: line.externalLineId,
    });
  }

  if (salesRecords.length === 0) {
    await storage.updateSalesUploadBatchStatus(batchRecord.id, companyId, "completed", new Date(), 0);
    return { rowsIngested: 0, rowsSkipped, adhocItems };
  }

  // 5. Upsert — ON CONFLICT (connectionId, externalOrderId, externalLineItemId) DO UPDATE
  //    Re-ingesting the same order overwrites the existing row; refund rows get their own
  //    unique (orderId, return-line-uid) key so they never collide with the original sale.
  const upserted = await storage.upsertPosDailyMenuItemSales(salesRecords);

  // 6. Trigger theoretical usage calculation
  if (upserted.length > 0) {
    const tuService = new TheoreticalUsageService();
    try {
      await tuService.calculateTheoreticalUsage({
        companyId,
        storeId,
        salesDate,
        sourceBatchId: batchRecord.id,
        salesData: upserted,
      });
      await storage.updateSalesUploadBatchStatus(
        batchRecord.id,
        companyId,
        "completed",
        new Date(),
        upserted.length,
      );
    } catch (err: any) {
      console.error("[POS Ingest] TFC calculation error:", err.message);
      await storage.updateSalesUploadBatchStatus(
        batchRecord.id,
        companyId,
        "failed",
        new Date(),
        0,
        upserted.length,
        err.message,
      );
    }
  } else {
    await storage.updateSalesUploadBatchStatus(batchRecord.id, companyId, "failed");
  }

  return { rowsIngested: upserted.length, rowsSkipped, adhocItems };
}
