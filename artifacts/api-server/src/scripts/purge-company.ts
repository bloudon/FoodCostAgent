import { db } from "../db";
import { sql, eq, inArray } from "drizzle-orm";
import * as schema from "@workspace/db";
import * as readline from "readline";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Company Data Purge Script
 *
 * Safely deletes all data associated with a company in dependency order.
 * Proves multi-tenant isolation by ensuring only target company data is removed.
 *
 * Usage:
 *   tsx server/scripts/purge-company.ts <companyId> [--dry-run] [--yes]
 *
 * Options:
 *   --dry-run    Count rows that would be deleted without actually deleting
 *   --yes        Skip confirmation prompt (use with caution!)
 */

interface DeletionEntry {
  name: string;
  count: () => Promise<number>;
  delete: () => Promise<number>;
}

interface DeletionStats {
  tableName: string;
  rowsDeleted: number;
}

async function getStoreIds(executor: any, companyId: string): Promise<string[]> {
  const stores = await executor
    .select({ id: schema.companyStores.id })
    .from(schema.companyStores)
    // @ts-ignore
    .where(eq(schema.companyStores.companyId, companyId));
  // @ts-ignore
  return stores.map(s => s.id);
}

async function getInventoryItemIds(executor: any, companyId: string): Promise<string[]> {
  const items = await executor
    .select({ id: schema.inventoryItems.id })
    .from(schema.inventoryItems)
    // @ts-ignore
    .where(eq(schema.inventoryItems.companyId, companyId));
  // @ts-ignore
  return items.map(i => i.id);
}

async function getVendorIds(executor: any, companyId: string): Promise<string[]> {
  const vendors = await executor
    .select({ id: schema.vendors.id })
    .from(schema.vendors)
    // @ts-ignore
    .where(eq(schema.vendors.companyId, companyId));
  // @ts-ignore
  return vendors.map(v => v.id);
}

async function getRecipeIds(executor: any, companyId: string): Promise<string[]> {
  const recipes = await executor
    .select({ id: schema.recipes.id })
    .from(schema.recipes)
    // @ts-ignore
    .where(eq(schema.recipes.companyId, companyId));
  // @ts-ignore
  return recipes.map(r => r.id);
}

async function getMenuItemIds(executor: any, companyId: string): Promise<string[]> {
  const menuItems = await executor
    .select({ id: schema.menuItems.id })
    .from(schema.menuItems)
    // @ts-ignore
    .where(eq(schema.menuItems.companyId, companyId));
  // @ts-ignore
  return menuItems.map(m => m.id);
}

async function getApiCredentialIds(executor: any, companyId: string): Promise<string[]> {
  const credentials = await executor
    .select({ id: schema.apiCredentials.id })
    .from(schema.apiCredentials)
    // @ts-ignore
    .where(eq(schema.apiCredentials.companyId, companyId));
  // @ts-ignore
  return credentials.map(c => c.id);
}

async function getInventoryCountIds(executor: any, companyId: string): Promise<string[]> {
  const counts = await executor
    .select({ id: schema.inventoryCounts.id })
    .from(schema.inventoryCounts)
    // @ts-ignore
    .where(eq(schema.inventoryCounts.companyId, companyId));
  // @ts-ignore
  return counts.map(c => c.id);
}

async function getInventoryImportBatchIds(executor: any, companyId: string): Promise<string[]> {
  const batches = await executor
    .select({ id: schema.inventoryImportBatches.id })
    .from(schema.inventoryImportBatches)
    // @ts-ignore
    .where(eq(schema.inventoryImportBatches.companyId, companyId));
  // @ts-ignore
  return batches.map(batch => batch.id);
}

async function getPrepItemIds(executor: any, companyId: string): Promise<string[]> {
  const items = await executor
    .select({ id: schema.prepItems.id })
    .from(schema.prepItems)
    // @ts-ignore
    .where(eq(schema.prepItems.companyId, companyId));
  // @ts-ignore
  return items.map(i => i.id);
}

async function getPrepChartRunIds(executor: any, companyId: string): Promise<string[]> {
  const runs = await executor
    .select({ id: schema.prepChartRuns.id })
    .from(schema.prepChartRuns)
    // @ts-ignore
    .where(eq(schema.prepChartRuns.companyId, companyId));
  // @ts-ignore
  return runs.map(r => r.id);
}

async function globalCountByCompany(executor: any, tableName: string, companyId: string): Promise<number> {
  const result = await executor.execute(
    sql`SELECT COUNT(*)::int AS count FROM ${sql.identifier(tableName)} WHERE company_id = ${companyId}`
  );
  const rows = (result as any).rows ?? result;
  return Number((rows as any)[0]?.count ?? 0);
}

async function executePurgeCompanyData(
  companyId: string,
  dryRun: boolean,
  executor: any,
): Promise<DeletionStats[]> {
  // All reads and writes in a destructive purge use this transaction handle.
  // It is intentionally a local immutable binding, never a mutable global.
  const db = executor;
  const countByCompany = (tableName: string, id: string) =>
    globalCountByCompany(db, tableName, id);
  const stats: DeletionStats[] = [];

  console.log(`\n${dryRun ? '🔍 DRY RUN:' : '🗑️  PURGING:'} Company ${companyId}\n`);

  // Fetch related IDs up-front for join-table deletions
  const storeIds = await getStoreIds(db, companyId);
  const inventoryItemIds = await getInventoryItemIds(db, companyId);
  const vendorIds = await getVendorIds(db, companyId);
  const recipeIds = await getRecipeIds(db, companyId);
  const menuItemIds = await getMenuItemIds(db, companyId);
  const apiCredentialIds = await getApiCredentialIds(db, companyId);
  const countIds = await getInventoryCountIds(db, companyId);
  const importBatchIds = await getInventoryImportBatchIds(db, companyId);
  const prepItemIds = await getPrepItemIds(db, companyId);
  const prepChartRunIds = await getPrepChartRunIds(db, companyId);

  console.log(`Found related entities:`);
  console.log(`  - Stores: ${storeIds.length}`);
  console.log(`  - Inventory Items: ${inventoryItemIds.length}`);
  console.log(`  - Vendors: ${vendorIds.length}`);
  console.log(`  - Recipes: ${recipeIds.length}`);
  console.log(`  - Menu Items: ${menuItemIds.length}`);
  console.log(`  - Prep Items: ${prepItemIds.length}`);
  console.log(`\n`);

  const inList = (ids: string[]) =>
    `(${ids.map(id => `'${id.replace(/'/g, "''")}'`).join(',')})`;

  const deletions: DeletionEntry[] = [
    // ── Shelf Scan Sessions (references inventory_counts) ────────────────
    {
      name: "shelf_scan_sessions",
      count: async () => countByCompany("shelf_scan_sessions", companyId),
      delete: async () => {
        const result = await db.delete(schema.shelfScanSessions)
          // @ts-ignore
          .where(eq(schema.shelfScanSessions.companyId, companyId))
          .returning({ id: schema.shelfScanSessions.id });
        return result.length;
      },
    },

    // ── Historical unresolved imports (references inventory_counts) ──────
    {
      name: "historical_session_unresolved_rows",
      count: async () => {
        if (countIds.length === 0) return 0;
        const r = await db.execute(sql`
          SELECT COUNT(*)::int AS c FROM historical_session_unresolved_rows
          WHERE session_id IN ${sql.raw(inList(countIds))}
        `);
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (countIds.length === 0) return 0;
        const result = await db.delete(schema.historicalSessionUnresolvedRows)
          // @ts-ignore
          .where(inArray(schema.historicalSessionUnresolvedRows.sessionId, countIds))
          .returning({ id: schema.historicalSessionUnresolvedRows.id });
        return result.length;
      },
    },

    // ── Inventory Count Entries (child of count_lines) ──────────────────
    {
      name: "inventory_count_entries",
      count: async () => {
        if (countIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM inventory_count_entries
              WHERE inventory_count_line_id IN (
                SELECT id FROM inventory_count_lines
                WHERE inventory_count_id IN ${sql.raw(inList(countIds))}
              )`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (countIds.length === 0) return 0;
        const lines = await db
          .select({ id: schema.inventoryCountLines.id })
          .from(schema.inventoryCountLines)
          // @ts-ignore
          .where(inArray(schema.inventoryCountLines.inventoryCountId, countIds));
        // @ts-ignore
        const lineIds = lines.map(l => l.id);
        if (lineIds.length === 0) return 0;
        const result = await db.delete(schema.inventoryCountEntries)
          // @ts-ignore
          .where(inArray(schema.inventoryCountEntries.inventoryCountLineId, lineIds))
          .returning({ id: schema.inventoryCountEntries.id });
        return result.length;
      },
    },

    // ── Inventory Count Lines ────────────────────────────────────────────
    {
      name: "inventory_count_lines",
      count: async () => {
        if (countIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM inventory_count_lines WHERE inventory_count_id IN ${sql.raw(inList(countIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (countIds.length === 0) return 0;
        const result = await db.delete(schema.inventoryCountLines)
          // @ts-ignore
          .where(inArray(schema.inventoryCountLines.inventoryCountId, countIds))
          .returning({ id: schema.inventoryCountLines.id });
        return result.length;
      },
    },

    // ── Inventory Counts ─────────────────────────────────────────────────
    {
      name: "inventory_counts",
      count: async () => countByCompany("inventory_counts", companyId),
      delete: async () => {
        const result = await db.delete(schema.inventoryCounts)
          // @ts-ignore
          .where(eq(schema.inventoryCounts.companyId, companyId))
          .returning({ id: schema.inventoryCounts.id });
        return result.length;
      },
    },

    // Count sessions can retain source_batch_id, so batches are deleted only
    // after their linked inventory counts have been removed.
    // ── Orderly Import Review Decisions (child of import batches) ─────────
    {
      name: "orderly_import_review_decisions",
      count: async () => {
        if (importBatchIds.length === 0) return 0;
        const r = await db.execute(sql`
          SELECT COUNT(*)::int AS c FROM orderly_import_review_decisions
          WHERE batch_id IN ${sql.raw(inList(importBatchIds))}
        `);
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (importBatchIds.length === 0) return 0;
        const result = await db.delete(schema.orderlyImportReviewDecisions)
          // @ts-ignore
          .where(inArray(schema.orderlyImportReviewDecisions.batchId, importBatchIds))
          .returning({ id: schema.orderlyImportReviewDecisions.id });
        return result.length;
      },
    },

    // ── Orderly Import Approval Jobs (child of import batches) ────────────
    {
      name: "orderly_import_approval_jobs",
      count: async () => {
        if (importBatchIds.length === 0) return 0;
        const r = await db.execute(sql`
          SELECT COUNT(*)::int AS c FROM orderly_import_approval_jobs
          WHERE batch_id IN ${sql.raw(inList(importBatchIds))}
        `);
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (importBatchIds.length === 0) return 0;
        const result = await db.delete(schema.orderlyImportApprovalJobs)
          // @ts-ignore
          .where(inArray(schema.orderlyImportApprovalJobs.batchId, importBatchIds))
          .returning({ id: schema.orderlyImportApprovalJobs.id });
        return result.length;
      },
    },

    // ── Inventory Import Rows (child of import batches) ───────────────────
    {
      name: "inventory_import_rows",
      count: async () => {
        if (importBatchIds.length === 0) return 0;
        const r = await db.execute(sql`
          SELECT COUNT(*)::int AS c FROM inventory_import_rows
          WHERE batch_id IN ${sql.raw(inList(importBatchIds))}
        `);
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (importBatchIds.length === 0) return 0;
        const result = await db.delete(schema.inventoryImportRows)
          // @ts-ignore
          .where(inArray(schema.inventoryImportRows.batchId, importBatchIds))
          .returning({ id: schema.inventoryImportRows.id });
        return result.length;
      },
    },

    // ── Inventory Import Batches ──────────────────────────────────────────
    {
      name: "inventory_import_batches",
      count: async () => countByCompany("inventory_import_batches", companyId),
      delete: async () => {
        const result = await db.delete(schema.inventoryImportBatches)
          // @ts-ignore
          .where(eq(schema.inventoryImportBatches.companyId, companyId))
          .returning({ id: schema.inventoryImportBatches.id });
        return result.length;
      },
    },

    // ── Import Source Property Bindings ───────────────────────────────────
    // Bindings claim a source property globally and reference a company store,
    // so remove them after batches and before the destination stores.
    {
      name: "import_source_property_bindings",
      count: async () => countByCompany("import_source_property_bindings", companyId),
      delete: async () => {
        const result = await db.delete(schema.importSourcePropertyBindings)
          // @ts-ignore
          .where(eq(schema.importSourcePropertyBindings.companyId, companyId))
          .returning({ id: schema.importSourcePropertyBindings.id });
        return result.length;
      },
    },

    // ── POS Sales Lines ──────────────────────────────────────────────────
    {
      name: "pos_sales_lines",
      count: async () => {
        if (storeIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM pos_sales_lines WHERE pos_sales_id IN (SELECT id FROM pos_sales WHERE store_id IN ${sql.raw(inList(storeIds))})`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (storeIds.length === 0) return 0;
        const sales = await db.select({ id: schema.posSales.id })
          .from(schema.posSales)
          // @ts-ignore
          .where(inArray(schema.posSales.storeId, storeIds));
        // @ts-ignore
        const salesIds = sales.map(s => s.id);
        if (salesIds.length === 0) return 0;
        const result = await db.delete(schema.posSalesLines)
          // @ts-ignore
          .where(inArray(schema.posSalesLines.posSalesId, salesIds))
          .returning({ id: schema.posSalesLines.id });
        return result.length;
      },
    },

    // ── POS Sales ────────────────────────────────────────────────────────
    {
      name: "pos_sales",
      count: async () => {
        if (storeIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM pos_sales WHERE store_id IN ${sql.raw(inList(storeIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (storeIds.length === 0) return 0;
        const result = await db.delete(schema.posSales)
          // @ts-ignore
          .where(inArray(schema.posSales.storeId, storeIds))
          .returning({ id: schema.posSales.id });
        return result.length;
      },
    },

    // ── Sales Upload Batches ─────────────────────────────────────────────
    {
      name: "sales_upload_batches",
      count: async () => countByCompany("sales_upload_batches", companyId),
      delete: async () => {
        const result = await db.delete(schema.salesUploadBatches)
          // @ts-ignore
          .where(eq(schema.salesUploadBatches.companyId, companyId))
          .returning({ id: schema.salesUploadBatches.id });
        return result.length;
      },
    },

    // ── Recipe Components ────────────────────────────────────────────────
    {
      name: "recipe_components",
      count: async () => {
        if (recipeIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM recipe_components WHERE recipe_id IN ${sql.raw(inList(recipeIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (recipeIds.length === 0) return 0;
        const result = await db.delete(schema.recipeComponents)
          // @ts-ignore
          .where(inArray(schema.recipeComponents.recipeId, recipeIds))
          .returning({ id: schema.recipeComponents.id });
        return result.length;
      },
    },

    // ── Recipe Versions ──────────────────────────────────────────────────
    {
      name: "recipe_versions",
      count: async () => {
        if (recipeIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM recipe_versions WHERE recipe_id IN ${sql.raw(inList(recipeIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (recipeIds.length === 0) return 0;
        const result = await db.delete(schema.recipeVersions)
          // @ts-ignore
          .where(inArray(schema.recipeVersions.recipeId, recipeIds))
          .returning({ id: schema.recipeVersions.id });
        return result.length;
      },
    },

    // ── Transfer Order Lines ─────────────────────────────────────────────
    {
      name: "transfer_order_lines",
      count: async () => {
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM transfer_order_lines WHERE transfer_order_id IN (SELECT id FROM transfer_orders WHERE company_id = ${companyId})`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        const orders = await db.select({ id: schema.transferOrders.id })
          .from(schema.transferOrders)
          // @ts-ignore
          .where(eq(schema.transferOrders.companyId, companyId));
        // @ts-ignore
        const orderIds = orders.map(o => o.id);
        if (orderIds.length === 0) return 0;
        const result = await db.delete(schema.transferOrderLines)
          // @ts-ignore
          .where(inArray(schema.transferOrderLines.transferOrderId, orderIds))
          .returning({ id: schema.transferOrderLines.id });
        return result.length;
      },
    },

    // ── Transfer Orders ──────────────────────────────────────────────────
    {
      name: "transfer_orders",
      count: async () => countByCompany("transfer_orders", companyId),
      delete: async () => {
        const result = await db.delete(schema.transferOrders)
          // @ts-ignore
          .where(eq(schema.transferOrders.companyId, companyId))
          .returning({ id: schema.transferOrders.id });
        return result.length;
      },
    },

    // ── Transfer Logs ────────────────────────────────────────────────────
    {
      name: "transfer_logs",
      count: async () => countByCompany("transfer_logs", companyId),
      delete: async () => {
        const result = await db.delete(schema.transferLogs)
          // @ts-ignore
          .where(eq(schema.transferLogs.companyId, companyId))
          .returning({ id: schema.transferLogs.id });
        return result.length;
      },
    },

    // ── Waste Logs ───────────────────────────────────────────────────────
    {
      name: "waste_logs",
      count: async () => countByCompany("waste_logs", companyId),
      delete: async () => {
        const result = await db.delete(schema.wasteLogs)
          // @ts-ignore
          .where(eq(schema.wasteLogs.companyId, companyId))
          .returning({ id: schema.wasteLogs.id });
        return result.length;
      },
    },

    // ── Receipt Lines ────────────────────────────────────────────────────
    {
      name: "receipt_lines",
      count: async () => {
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM receipt_lines WHERE receipt_id IN (SELECT id FROM receipts WHERE company_id = ${companyId})`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        const receipts = await db.select({ id: schema.receipts.id })
          .from(schema.receipts)
          // @ts-ignore
          .where(eq(schema.receipts.companyId, companyId));
        // @ts-ignore
        const receiptIds = receipts.map(r => r.id);
        if (receiptIds.length === 0) return 0;
        const result = await db.delete(schema.receiptLines)
          // @ts-ignore
          .where(inArray(schema.receiptLines.receiptId, receiptIds))
          .returning({ id: schema.receiptLines.id });
        return result.length;
      },
    },

    // ── Receipts ─────────────────────────────────────────────────────────
    {
      name: "receipts",
      count: async () => countByCompany("receipts", companyId),
      delete: async () => {
        const result = await db.delete(schema.receipts)
          // @ts-ignore
          .where(eq(schema.receipts.companyId, companyId))
          .returning({ id: schema.receipts.id });
        return result.length;
      },
    },

    // ── PO Lines ─────────────────────────────────────────────────────────
    {
      name: "po_lines",
      count: async () => {
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM po_lines WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE company_id = ${companyId})`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        const pos = await db.select({ id: schema.purchaseOrders.id })
          .from(schema.purchaseOrders)
          // @ts-ignore
          .where(eq(schema.purchaseOrders.companyId, companyId));
        // @ts-ignore
        const poIds = pos.map(p => p.id);
        if (poIds.length === 0) return 0;
        const result = await db.delete(schema.poLines)
          // @ts-ignore
          .where(inArray(schema.poLines.purchaseOrderId, poIds))
          .returning({ id: schema.poLines.id });
        return result.length;
      },
    },

    // ── Purchase Orders ──────────────────────────────────────────────────
    {
      name: "purchase_orders",
      count: async () => countByCompany("purchase_orders", companyId),
      delete: async () => {
        const result = await db.delete(schema.purchaseOrders)
          // @ts-ignore
          .where(eq(schema.purchaseOrders.companyId, companyId))
          .returning({ id: schema.purchaseOrders.id });
        return result.length;
      },
    },

    // ── API Credential Locations ─────────────────────────────────────────
    {
      name: "api_credential_locations",
      count: async () => {
        if (apiCredentialIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM api_credential_locations WHERE api_credential_id IN ${sql.raw(inList(apiCredentialIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (apiCredentialIds.length === 0) return 0;
        const result = await db.delete(schema.apiCredentialLocations)
          // @ts-ignore
          .where(inArray(schema.apiCredentialLocations.apiCredentialId, apiCredentialIds))
          .returning({ id: schema.apiCredentialLocations.id });
        return result.length;
      },
    },

    // ── Store Inventory Items ────────────────────────────────────────────
    {
      name: "store_inventory_items",
      count: async () => countByCompany("store_inventory_items", companyId),
      delete: async () => {
        const result = await db.delete(schema.storeInventoryItems)
          // @ts-ignore
          .where(eq(schema.storeInventoryItems.companyId, companyId))
          .returning({ id: schema.storeInventoryItems.id });
        return result.length;
      },
    },

    // ── Store Menu Items ─────────────────────────────────────────────────
    {
      name: "store_menu_items",
      count: async () => {
        if (menuItemIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM store_menu_items WHERE menu_item_id IN ${sql.raw(inList(menuItemIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (menuItemIds.length === 0) return 0;
        const result = await db.delete(schema.storeMenuItems)
          // @ts-ignore
          .where(inArray(schema.storeMenuItems.menuItemId, menuItemIds))
          .returning({ id: schema.storeMenuItems.id });
        return result.length;
      },
    },

    // ── Store Recipes ────────────────────────────────────────────────────
    {
      name: "store_recipes",
      count: async () => {
        if (recipeIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM store_recipes WHERE recipe_id IN ${sql.raw(inList(recipeIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (recipeIds.length === 0) return 0;
        const result = await db.delete(schema.storeRecipes)
          // @ts-ignore
          .where(inArray(schema.storeRecipes.recipeId, recipeIds))
          .returning({ id: schema.storeRecipes.id });
        return result.length;
      },
    },

    // ── Store Storage Locations ──────────────────────────────────────────
    {
      name: "store_storage_locations",
      count: async () => {
        if (storeIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM store_storage_locations WHERE store_id IN ${sql.raw(inList(storeIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (storeIds.length === 0) return 0;
        const result = await db.delete(schema.storeStorageLocations)
          // @ts-ignore
          .where(inArray(schema.storeStorageLocations.storeId, storeIds))
          .returning({ id: schema.storeStorageLocations.id });
        return result.length;
      },
    },

    // ── Store Vendors ────────────────────────────────────────────────────
    {
      name: "store_vendors",
      count: async () => {
        if (storeIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM store_vendors WHERE store_id IN ${sql.raw(inList(storeIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (storeIds.length === 0) return 0;
        const result = await db.delete(schema.storeVendors)
          // @ts-ignore
          .where(inArray(schema.storeVendors.storeId, storeIds))
          .returning({ id: schema.storeVendors.id });
        return result.length;
      },
    },

    // ── Vendor Items ─────────────────────────────────────────────────────
    {
      name: "vendor_items",
      count: async () => {
        if (vendorIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM vendor_items WHERE vendor_id IN ${sql.raw(inList(vendorIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (vendorIds.length === 0) return 0;
        const result = await db.delete(schema.vendorItems)
          // @ts-ignore
          .where(inArray(schema.vendorItems.vendorId, vendorIds))
          .returning({ id: schema.vendorItems.id });
        return result.length;
      },
    },

    // ── Vendors ──────────────────────────────────────────────────────────
    {
      name: "vendors",
      count: async () => countByCompany("vendors", companyId),
      delete: async () => {
        const result = await db.delete(schema.vendors)
          // @ts-ignore
          .where(eq(schema.vendors.companyId, companyId))
          .returning({ id: schema.vendors.id });
        return result.length;
      },
    },

    // ── Inventory Item Locations ─────────────────────────────────────────
    {
      name: "inventory_item_locations",
      count: async () => {
        if (inventoryItemIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM inventory_item_locations WHERE inventory_item_id IN ${sql.raw(inList(inventoryItemIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (inventoryItemIds.length === 0) return 0;
        const result = await db.delete(schema.inventoryItemLocations)
          // @ts-ignore
          .where(inArray(schema.inventoryItemLocations.inventoryItemId, inventoryItemIds))
          .returning({ id: schema.inventoryItemLocations.id });
        return result.length;
      },
    },

    // ── Inventory Item Price History ─────────────────────────────────────
    {
      name: "inventory_item_price_history",
      count: async () => {
        if (inventoryItemIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM inventory_item_price_history WHERE inventory_item_id IN ${sql.raw(inList(inventoryItemIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (inventoryItemIds.length === 0) return 0;
        const result = await db.delete(schema.inventoryItemPriceHistory)
          // @ts-ignore
          .where(inArray(schema.inventoryItemPriceHistory.inventoryItemId, inventoryItemIds))
          .returning({ id: schema.inventoryItemPriceHistory.id });
        return result.length;
      },
    },

    // ── Inventory Items ──────────────────────────────────────────────────
    {
      name: "inventory_items",
      count: async () => countByCompany("inventory_items", companyId),
      delete: async () => {
        const result = await db.delete(schema.inventoryItems)
          // @ts-ignore
          .where(eq(schema.inventoryItems.companyId, companyId))
          .returning({ id: schema.inventoryItems.id });
        return result.length;
      },
    },

    // ── Menu Item Prep Usages ────────────────────────────────────────────
    {
      name: "menu_item_prep_usages",
      count: async () => countByCompany("menu_item_prep_usages", companyId),
      delete: async () => {
        const result = await db.delete(schema.menuItemPrepUsages)
          // @ts-ignore
          .where(eq(schema.menuItemPrepUsages.companyId, companyId))
          .returning({ id: schema.menuItemPrepUsages.id });
        return result.length;
      },
    },

    // ── Recipes ──────────────────────────────────────────────────────────
    {
      name: "recipes",
      count: async () => countByCompany("recipes", companyId),
      delete: async () => {
        const result = await db.delete(schema.recipes)
          // @ts-ignore
          .where(eq(schema.recipes.companyId, companyId))
          .returning({ id: schema.recipes.id });
        return result.length;
      },
    },

    // ── Menu Items ───────────────────────────────────────────────────────
    {
      name: "menu_items",
      count: async () => countByCompany("menu_items", companyId),
      delete: async () => {
        const result = await db.delete(schema.menuItems)
          // @ts-ignore
          .where(eq(schema.menuItems.companyId, companyId))
          .returning({ id: schema.menuItems.id });
        return result.length;
      },
    },

    // ── Menu Departments ─────────────────────────────────────────────────
    {
      name: "menu_departments",
      count: async () => countByCompany("menu_departments", companyId),
      delete: async () => {
        const result = await db.delete(schema.menuDepartments)
          // @ts-ignore
          .where(eq(schema.menuDepartments.companyId, companyId))
          .returning({ id: schema.menuDepartments.id });
        return result.length;
      },
    },

    // ── Menu Item Sizes (company-specific only) ──────────────────────────
    {
      name: "menu_item_sizes",
      count: async () => countByCompany("menu_item_sizes", companyId),
      delete: async () => {
        const result = await db.delete(schema.menuItemSizes)
          // @ts-ignore
          .where(eq(schema.menuItemSizes.companyId, companyId))
          .returning({ id: schema.menuItemSizes.id });
        return result.length;
      },
    },

    // ── API Credentials ──────────────────────────────────────────────────
    {
      name: "api_credentials",
      count: async () => countByCompany("api_credentials", companyId),
      delete: async () => {
        const result = await db.delete(schema.apiCredentials)
          // @ts-ignore
          .where(eq(schema.apiCredentials.companyId, companyId))
          .returning({ id: schema.apiCredentials.id });
        return result.length;
      },
    },

    // ── Storage Locations ────────────────────────────────────────────────
    {
      name: "storage_locations",
      count: async () => countByCompany("storage_locations", companyId),
      delete: async () => {
        const result = await db.delete(schema.storageLocations)
          // @ts-ignore
          .where(eq(schema.storageLocations.companyId, companyId))
          .returning({ id: schema.storageLocations.id });
        return result.length;
      },
    },

    // ── Categories ───────────────────────────────────────────────────────
    {
      name: "categories",
      count: async () => countByCompany("categories", companyId),
      delete: async () => {
        const result = await db.delete(schema.categories)
          // @ts-ignore
          .where(eq(schema.categories.companyId, companyId))
          .returning({ id: schema.categories.id });
        return result.length;
      },
    },

    // ── Prep Chart Lines ─────────────────────────────────────────────────
    {
      name: "prep_chart_lines",
      count: async () => {
        if (prepChartRunIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM prep_chart_lines WHERE prep_chart_run_id IN ${sql.raw(inList(prepChartRunIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (prepChartRunIds.length === 0) return 0;
        const result = await db.delete(schema.prepChartLines)
          // @ts-ignore
          .where(inArray(schema.prepChartLines.prepChartRunId, prepChartRunIds))
          .returning({ id: schema.prepChartLines.id });
        return result.length;
      },
    },

    // ── Prep Chart Runs ──────────────────────────────────────────────────
    {
      name: "prep_chart_runs",
      count: async () => countByCompany("prep_chart_runs", companyId),
      delete: async () => {
        const result = await db.delete(schema.prepChartRuns)
          // @ts-ignore
          .where(eq(schema.prepChartRuns.companyId, companyId))
          .returning({ id: schema.prepChartRuns.id });
        return result.length;
      },
    },

    // ── Prep Production Records ──────────────────────────────────────────
    {
      name: "prep_production_records",
      count: async () => countByCompany("prep_production_records", companyId),
      delete: async () => {
        const result = await db.delete(schema.prepProductionRecords)
          // @ts-ignore
          .where(eq(schema.prepProductionRecords.companyId, companyId))
          .returning({ id: schema.prepProductionRecords.id });
        return result.length;
      },
    },

    // ── Prep On Hand ─────────────────────────────────────────────────────
    {
      name: "prep_on_hand",
      count: async () => countByCompany("prep_on_hand", companyId),
      delete: async () => {
        const result = await db.delete(schema.prepOnHand)
          // @ts-ignore
          .where(eq(schema.prepOnHand.companyId, companyId))
          .returning({ id: schema.prepOnHand.id });
        return result.length;
      },
    },

    // ── Prep Item Ingredients ────────────────────────────────────────────
    {
      name: "prep_item_ingredients",
      count: async () => {
        if (prepItemIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM prep_item_ingredients WHERE prep_item_id IN ${sql.raw(inList(prepItemIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (prepItemIds.length === 0) return 0;
        const result = await db.delete(schema.prepItemIngredients)
          // @ts-ignore
          .where(inArray(schema.prepItemIngredients.prepItemId, prepItemIds))
          .returning({ id: schema.prepItemIngredients.id });
        return result.length;
      },
    },

    // ── Prep Items ───────────────────────────────────────────────────────
    {
      name: "prep_items",
      count: async () => countByCompany("prep_items", companyId),
      delete: async () => {
        const result = await db.delete(schema.prepItems)
          // @ts-ignore
          .where(eq(schema.prepItems.companyId, companyId))
          .returning({ id: schema.prepItems.id });
        return result.length;
      },
    },

    // ── Stations ─────────────────────────────────────────────────────────
    {
      name: "stations",
      count: async () => countByCompany("stations", companyId),
      delete: async () => {
        const result = await db.delete(schema.stations)
          // @ts-ignore
          .where(eq(schema.stations.companyId, companyId))
          .returning({ id: schema.stations.id });
        return result.length;
      },
    },

    // ── Dayparts ─────────────────────────────────────────────────────────
    {
      name: "dayparts",
      count: async () => countByCompany("dayparts", companyId),
      delete: async () => {
        const result = await db.delete(schema.dayparts)
          // @ts-ignore
          .where(eq(schema.dayparts.companyId, companyId))
          .returning({ id: schema.dayparts.id });
        return result.length;
      },
    },

    // ── Recipe Import Sessions ───────────────────────────────────────────
    {
      name: "recipe_import_sessions",
      count: async () => countByCompany("recipe_import_sessions", companyId),
      delete: async () => {
        const result = await db.delete(schema.recipeImportSessions)
          // @ts-ignore
          .where(eq(schema.recipeImportSessions.companyId, companyId))
          .returning({ id: schema.recipeImportSessions.id });
        return result.length;
      },
    },

    // ── Menu Import Sessions ─────────────────────────────────────────────
    {
      name: "menu_import_sessions",
      count: async () => countByCompany("menu_import_sessions", companyId),
      delete: async () => {
        const result = await db.delete(schema.menuImportSessions)
          // @ts-ignore
          .where(eq(schema.menuImportSessions.companyId, companyId))
          .returning({ id: schema.menuImportSessions.id });
        return result.length;
      },
    },

    // ── Chat Logs (explicit, ON DELETE CASCADE also handles this) ────────
    {
      name: "chat_logs",
      count: async () => countByCompany("chat_logs", companyId),
      delete: async () => {
        const result = await db.delete(schema.chatLogs)
          // @ts-ignore
          .where(eq(schema.chatLogs.companyId, companyId))
          .returning({ id: schema.chatLogs.id });
        return result.length;
      },
    },

    // ── Onboarding Progress ──────────────────────────────────────────────
    {
      name: "onboarding_progress",
      count: async () => countByCompany("onboarding_progress", companyId),
      delete: async () => {
        const result = await db.delete(schema.onboardingProgress)
          // @ts-ignore
          .where(eq(schema.onboardingProgress.companyId, companyId))
          .returning({ id: schema.onboardingProgress.id });
        return result.length;
      },
    },

    // ── Invitations ──────────────────────────────────────────────────────
    {
      name: "invitations",
      count: async () => countByCompany("invitations", companyId),
      delete: async () => {
        const result = await db.delete(schema.invitations)
          // @ts-ignore
          .where(eq(schema.invitations.companyId, companyId))
          .returning({ id: schema.invitations.id });
        return result.length;
      },
    },

    // ── Users ────────────────────────────────────────────────────────────
    // Delete all users belonging to this company. global_admin users have
    // a null company_id and are never matched here.
    {
      name: "users",
      count: async () => countByCompany("users", companyId),
      delete: async () => {
        const result = await db.delete(schema.users)
          // @ts-ignore
          .where(eq(schema.users.companyId, companyId))
          .returning({ id: schema.users.id });
        return result.length;
      },
    },

    // ── User Stores (by this company's store IDs) ────────────────────────
    {
      name: "user_stores",
      count: async () => {
        if (storeIds.length === 0) return 0;
        const r = await db.execute(
          sql`SELECT COUNT(*)::int AS c FROM user_stores WHERE store_id IN ${sql.raw(inList(storeIds))}`
        );
        return Number(((r as any).rows ?? r)[0]?.c ?? 0);
      },
      delete: async () => {
        if (storeIds.length === 0) return 0;
        const result = await db.delete(schema.userStores)
          // @ts-ignore
          .where(inArray(schema.userStores.storeId, storeIds))
          .returning({ id: schema.userStores.id });
        return result.length;
      },
    },

    // ── Company Stores ───────────────────────────────────────────────────
    {
      name: "company_stores",
      count: async () => countByCompany("company_stores", companyId),
      delete: async () => {
        const result = await db.delete(schema.companyStores)
          // @ts-ignore
          .where(eq(schema.companyStores.companyId, companyId))
          .returning({ id: schema.companyStores.id });
        return result.length;
      },
    },

    // ── Company (final) ──────────────────────────────────────────────────
    {
      name: "companies",
      count: async () => 1,
      delete: async () => {
        const result = await db.delete(schema.companies)
          // @ts-ignore
          .where(eq(schema.companies.id, companyId))
          .returning({ id: schema.companies.id });
        return result.length;
      },
    },
  ];

  // Execute deletions (or count for dry-run)
  for (const deletion of deletions) {
    try {
      let rowCount = 0;
      if (dryRun) {
        rowCount = await deletion.count();
      } else {
        rowCount = await deletion.delete();
      }

      stats.push({ tableName: deletion.name, rowsDeleted: rowCount });

      if (rowCount > 0) {
        const icon = dryRun ? '📋' : '✅';
        console.log(`${icon} ${deletion.name}: ${dryRun ? rowCount + ' rows would be deleted' : rowCount + ' rows deleted'}`);
      }
    } catch (error: any) {
      console.error(`❌ Error ${dryRun ? 'counting' : 'deleting from'} ${deletion.name}:`, error.message);
      throw error;
    }
  }

  return stats;
}

/**
 * Purge a company's data. The public signature is kept for script callers.
 * Dry runs use the normal connection and do not open a transaction; destructive
 * purges perform discovery and every deletion in one transaction.
 */
async function purgeCompanyData(
  companyId: string,
  dryRun: boolean = false,
): Promise<DeletionStats[]> {
  if (dryRun) {
    return executePurgeCompanyData(companyId, true, db);
  }

  return db.transaction((tx: any) =>
    executePurgeCompanyData(companyId, false, tx)
  );
}

async function verifyCompanyExists(companyId: string): Promise<boolean> {
  const companies = await db
    .select()
    .from(schema.companies)
    // @ts-ignore
    .where(eq(schema.companies.id, companyId));
  return companies.length > 0;
}

async function getCompanyInfo(companyId: string) {
  const companies = await db
    .select()
    .from(schema.companies)
    // @ts-ignore
    .where(eq(schema.companies.id, companyId));
  return companies[0];
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Company Data Purge Script

Usage:
  tsx server/scripts/purge-company.ts <companyId> [options]

Options:
  --dry-run    Show what would be deleted without actually deleting
  --yes        Skip confirmation prompt (use with caution!)
  --help, -h   Show this help message

Examples:
  # Dry run to see what would be deleted
  tsx server/scripts/purge-company.ts abc-123-def --dry-run

  # Interactive deletion (with confirmation)
  tsx server/scripts/purge-company.ts abc-123-def

  # Auto-confirm deletion (dangerous!)
  tsx server/scripts/purge-company.ts abc-123-def --yes
`);
    process.exit(0);
  }

  const companyId = args[0];
  const dryRun = args.includes('--dry-run');
  const autoConfirm = args.includes('--yes');

  const exists = await verifyCompanyExists(companyId);
  if (!exists) {
    console.error(`❌ Company with ID "${companyId}" not found.`);
    process.exit(1);
  }

  const companyInfo = await getCompanyInfo(companyId);
  console.log(`\n🏢 Company: ${companyInfo.name} (${companyInfo.id})`);

  if (!dryRun && !autoConfirm) {
    console.log(`\n⚠️  WARNING: This will permanently delete ALL data for this company!`);
    console.log(`\nType the company name "${companyInfo.name}" to confirm:`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const confirmation = await new Promise<string>((resolve) => {
      rl.question('> ', (answer: string) => { rl.close(); resolve(answer); });
    });

    if (confirmation.trim() !== companyInfo.name) {
      console.log(`\n❌ Confirmation failed. No data was deleted.`);
      process.exit(1);
    }
  }

  const startTime = Date.now();
  const stats = await purgeCompanyData(companyId, dryRun);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  const totalRows = stats.reduce((sum, s) => sum + s.rowsDeleted, 0);
  const tablesAffected = stats.filter(s => s.rowsDeleted > 0).length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${dryRun ? '📊 DRY RUN SUMMARY' : '✅ PURGE COMPLETE'}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Company: ${companyInfo.name} (${companyId})`);
  console.log(`Tables affected: ${tablesAffected}`);
  console.log(`Total rows ${dryRun ? 'to delete' : 'deleted'}: ${totalRows}`);
  console.log(`Duration: ${duration}s`);
  console.log(`${'='.repeat(60)}\n`);

  if (dryRun) {
    console.log(`ℹ️  This was a dry run. No data was actually deleted.`);
    console.log(`   Remove --dry-run flag to perform actual deletion.\n`);
  }

  process.exit(0);
}

const isMainModule = process.argv[1]
  ? /^purge-company\.(?:[cm]?[jt]s)$/.test(path.basename(process.argv[1]))
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  main().catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

export { purgeCompanyData };
