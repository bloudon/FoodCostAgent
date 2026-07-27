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
 *   Custom-dollar refunds have no catalog_object_id → no variationId mapping → they
 *   are detected by the negative-qty + no-variationId condition and counted in
 *   rowsSkipped with a log note.
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
 * Ingest one PosSalesBatch (one location × one business date).
 *
 * Returns { rowsIngested, rowsSkipped } where rowsSkipped counts lines that
 * could not be mapped to a menu item — including custom-dollar refunds.
 */
export async function ingestSalesBatch(
  batch: PosSalesBatch,
  opts: IngestBatchOptions,
): Promise<{ rowsIngested: number; rowsSkipped: number }> {
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
    return { rowsIngested: 0, rowsSkipped: 0 };
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

  for (const line of batch.lines) {
    // Skip zero-quantity lines (fully voided before close)
    if (line.quantity === 0) continue;

    // Custom-dollar refund: negative qty with no variationId → cannot attribute
    // to a menu item.  Count in rowsSkipped and emit a note to the job log.
    if (line.quantity < 0 && !line.externalVariationId) {
      rowsSkipped++;
      console.log(
        `[POS Ingest] Skipping custom-dollar refund on order ${line.externalOrderId}` +
        ` (no catalog_object_id — cannot map to menu item)`,
      );
      continue;
    }

    // Positive qty with no variationId → unrecognised item type, skip
    const mapping = line.externalVariationId
      ? byVariation.get(line.externalVariationId)
      : undefined;

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
      qtySold: line.quantity,          // negative for refund lines
      netSales: line.netSalesMoney / 100, // negative for refund lines
      sourceBatchId: batchRecord.id,
      connectionId,
      externalOrderId: line.externalOrderId,
      externalLineItemId: line.externalLineId,
    });
  }

  if (salesRecords.length === 0) {
    await storage.updateSalesUploadBatchStatus(batchRecord.id, companyId, "completed", new Date(), 0);
    return { rowsIngested: 0, rowsSkipped };
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

  return { rowsIngested: upserted.length, rowsSkipped };
}
