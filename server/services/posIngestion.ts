/**
 * POS Ingestion Service
 * Normalizes PosSalesBatch data and writes it into daily_menu_item_sales,
 * then triggers TheoreticalUsageService — identical pipeline to CSV upload.
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
 * Idempotent: duplicate lines are skipped via the unique constraint on
 * (company_id, store_id, menu_item_id, sales_date, daypart_id, source_batch_id).
 *
 * Returns { rowsIngested, rowsSkipped } where rowsSkipped counts positive-quantity
 * lines that had no posItemMapping so callers can surface a warning to users.
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

  // 4. Group lines by (variationId) and sum quantities + revenue; count unmapped lines
  const aggregated = new Map<
    string,
    { menuItemId: string; qtySold: number; netSales: number }
  >();

  let rowsSkipped = 0;

  for (const line of batch.lines) {
    if (line.quantity <= 0) continue;

    // Find mapping by variation ID
    const mapping = line.externalVariationId
      ? byVariation.get(line.externalVariationId)
      : undefined;

    if (!mapping?.menuItemId) {
      rowsSkipped++; // unmapped item — count it and skip
      continue;
    }

    const key = mapping.menuItemId;
    if (!aggregated.has(key)) {
      aggregated.set(key, { menuItemId: mapping.menuItemId, qtySold: 0, netSales: 0 });
    }
    const agg = aggregated.get(key)!;
    agg.qtySold += line.quantity;
    // Convert from cents to dollars
    agg.netSales += line.netSalesMoney / 100;
  }

  if (aggregated.size === 0) {
    await storage.updateSalesUploadBatchStatus(batchRecord.id, companyId, "completed", new Date(), 0);
    return { rowsIngested: 0, rowsSkipped };
  }

  // 5. Write daily_menu_item_sales rows
  const salesRecords = await storage.createDailyMenuItemSales(
    Array.from(aggregated.values()).map((a) => ({
      companyId,
      storeId,
      menuItemId: a.menuItemId,
      salesDate,
      daypartId: null,
      qtySold: a.qtySold,
      netSales: a.netSales,
      sourceBatchId: batchRecord.id,
    })),
  );

  // 6. Trigger theoretical usage calculation
  if (salesRecords.length > 0) {
    const tuService = new TheoreticalUsageService();
    try {
      await tuService.calculateTheoreticalUsage({
        companyId,
        storeId,
        salesDate,
        sourceBatchId: batchRecord.id,
        salesData: salesRecords,
      });
      await storage.updateSalesUploadBatchStatus(
        batchRecord.id,
        companyId,
        "completed",
        new Date(),
        salesRecords.length,
      );
    } catch (err: any) {
      console.error("[POS Ingest] TFC calculation error:", err.message);
      await storage.updateSalesUploadBatchStatus(
        batchRecord.id,
        companyId,
        "failed",
        new Date(),
        0,
        salesRecords.length,
        err.message,
      );
    }
  } else {
    await storage.updateSalesUploadBatchStatus(batchRecord.id, companyId, "failed");
  }

  return { rowsIngested: salesRecords.length, rowsSkipped };
}
