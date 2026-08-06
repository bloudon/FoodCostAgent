import { db } from "../db";
import { sql, eq, inArray } from "drizzle-orm";
import * as schema from "../../shared/schema";
import * as readline from "readline";

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

async function getStoreIds(companyId: string): Promise<string[]> {
  const stores = await db
    .select({ id: schema.companyStores.id })
    .from(schema.companyStores)
    .where(eq(schema.companyStores.companyId, companyId));
  return stores.map(s => s.id);
}

async function getInventoryItemIds(companyId: string): Promise<string[]> {
  const items = await db
    .select({ id: schema.inventoryItems.id })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.companyId, companyId));
  return items.map(i => i.id);
}

async function getVendorIds(companyId: string): Promise<string[]> {
  const vendors = await db
    .select({ id: schema.vendors.id })
    .from(schema.vendors)
    .where(eq(schema.vendors.companyId, companyId));
  return vendors.map(v => v.id);
}

async function getRecipeIds(companyId: string): Promise<string[]> {
  const recipes = await db
    .select({ id: schema.recipes.id })
    .from(schema.recipes)
    .where(eq(schema.recipes.companyId, companyId));
  return recipes.map(r => r.id);
}

async function getMenuItemIds(companyId: string): Promise<string[]> {
  const menuItems = await db
    .select({ id: schema.menuItems.id })
    .from(schema.menuItems)
    .where(eq(schema.menuItems.companyId, companyId));
  return menuItems.map(m => m.id);
}

async function getApiCredentialIds(companyId: string): Promise<string[]> {
  const credentials = await db
    .select({ id: schema.apiCredentials.id })
    .from(schema.apiCredentials)
    .where(eq(schema.apiCredentials.companyId, companyId));
  return credentials.map(c => c.id);
}

async function getInventoryCountIds(companyId: string): Promise<string[]> {
  const counts = await db
    .select({ id: schema.inventoryCounts.id })
    .from(schema.inventoryCounts)
    .where(eq(schema.inventoryCounts.companyId, companyId));
  return counts.map(c => c.id);
}

async function getPrepItemIds(companyId: string): Promise<string[]> {
  const items = await db
    .select({ id: schema.prepItems.id })
    .from(schema.prepItems)
    .where(eq(schema.prepItems.companyId, companyId));
  return items.map(i => i.id);
}

async function getPrepChartRunIds(companyId: string): Promise<string[]> {
  const runs = await db
    .select({ id: schema.prepChartRuns.id })
    .from(schema.prepChartRuns)
    .where(eq(schema.prepChartRuns.companyId, companyId));
  return runs.map(r => r.id);
}

async function countByCompany(tableName: string, companyId: string): Promise<number> {
  const result = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM ${sql.identifier(tableName)} WHERE company_id = ${companyId}`
  );
  const rows = (result as any).rows ?? result;
  return Number((rows as any)[0]?.count ?? 0);
}

async function purgeCompanyData(
  companyId: string,
  dryRun: boolean = false
): Promise<DeletionStats[]> {
  const stats: DeletionStats[] = [];

  console.log(`\n${dryRun ? '🔍 DRY RUN:' : '🗑️  PURGING:'} Company ${companyId}\n`);

  // Fetch related IDs up-front for join-table deletions
  const storeIds = await getStoreIds(companyId);
  const inventoryItemIds = await getInventoryItemIds(companyId);
  const vendorIds = await getVendorIds(companyId);
  const recipeIds = await getRecipeIds(companyId);
  const menuItemIds = await getMenuItemIds(companyId);
  const apiCredentialIds = await getApiCredentialIds(companyId);
  const countIds = await getInventoryCountIds(companyId);
  const prepItemIds = await getPrepItemIds(companyId);
  const prepChartRunIds = await getPrepChartRunIds(companyId);

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
          .where(inArray(schema.inventoryCountLines.inventoryCountId, countIds));
        const lineIds = lines.map(l => l.id);
        if (lineIds.length === 0) return 0;
        const result = await db.delete(schema.inventoryCountEntries)
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
          .where(eq(schema.inventoryCounts.companyId, companyId))
          .returning({ id: schema.inventoryCounts.id });
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
          .where(inArray(schema.posSales.storeId, storeIds));
        const salesIds = sales.map(s => s.id);
        if (salesIds.length === 0) return 0;
        const result = await db.delete(schema.posSalesLines)
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
          .where(eq(schema.transferOrders.companyId, companyId));
        const orderIds = orders.map(o => o.id);
        if (orderIds.length === 0) return 0;
        const result = await db.delete(schema.transferOrderLines)
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
          .where(eq(schema.receipts.companyId, companyId));
        const receiptIds = receipts.map(r => r.id);
        if (receiptIds.length === 0) return 0;
        const result = await db.delete(schema.receiptLines)
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
          .where(eq(schema.purchaseOrders.companyId, companyId));
        const poIds = pos.map(p => p.id);
        if (poIds.length === 0) return 0;
        const result = await db.delete(schema.poLines)
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
          .where(eq(schema.dayparts.companyId, companyId))
          .returning({ id: schema.dayparts.id });
        return result.length;
      },
    },

    // ── Shelf Scan Sessions ──────────────────────────────────────────────
    {
      name: "shelf_scan_sessions",
      count: async () => countByCompany("shelf_scan_sessions", companyId),
      delete: async () => {
        const result = await db.delete(schema.shelfScanSessions)
          .where(eq(schema.shelfScanSessions.companyId, companyId))
          .returning({ id: schema.shelfScanSessions.id });
        return result.length;
      },
    },

    // ── Recipe Import Sessions ───────────────────────────────────────────
    {
      name: "recipe_import_sessions",
      count: async () => countByCompany("recipe_import_sessions", companyId),
      delete: async () => {
        const result = await db.delete(schema.recipeImportSessions)
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

async function verifyCompanyExists(companyId: string): Promise<boolean> {
  const companies = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId));
  return companies.length > 0;
}

async function getCompanyInfo(companyId: string) {
  const companies = await db
    .select()
    .from(schema.companies)
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

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
const isBundled = !import.meta.url.includes('/server/scripts/');

if (isMainModule && !isBundled) {
  main().catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

export { purgeCompanyData };
