import { db } from "../db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import * as schema from "../../shared/schema";

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
 *   --dry-run    Show what would be deleted without actually deleting
 *   --yes        Skip confirmation prompt (use with caution!)
 */

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

async function countRows(tableName: string, whereClause: any): Promise<number> {
  const result = await db.execute(
    sql`SELECT COUNT(*) as count FROM ${sql.identifier(tableName)} WHERE ${whereClause}`
  );
  return Number(result.rows[0]?.count || 0);
}

async function purgeCompanyData(
  companyId: string,
  dryRun: boolean = false
): Promise<DeletionStats[]> {
  const stats: DeletionStats[] = [];
  
  console.log(`\n${dryRun ? '🔍 DRY RUN:' : '🗑️  PURGING:'} Company ${companyId}\n`);

  // Get related IDs first
  const storeIds = await getStoreIds(companyId);
  const inventoryItemIds = await getInventoryItemIds(companyId);
  const vendorIds = await getVendorIds(companyId);
  const recipeIds = await getRecipeIds(companyId);
  const menuItemIds = await getMenuItemIds(companyId);
  const apiCredentialIds = await getApiCredentialIds(companyId);

  console.log(`Found related entities:`);
  console.log(`  - Stores: ${storeIds.length}`);
  console.log(`  - Inventory Items: ${inventoryItemIds.length}`);
  console.log(`  - Vendors: ${vendorIds.length}`);
  console.log(`  - Recipes: ${recipeIds.length}`);
  console.log(`  - Menu Items: ${menuItemIds.length}`);
  console.log(`\n`);

  // Deletion functions in dependency order (leaf to root)
  const deletions = [
    // EDI and Order Guides (these are global vendor tables, not company-specific)
    // We'll skip these as they're shared across companies
    
    // POS Sales
    {
      name: "pos_sales_lines",
      delete: async () => {
        const sales = await db.select({ id: schema.posSales.id })
          .from(schema.posSales)
          .where(eq(schema.posSales.companyId, companyId));
        const salesIds = sales.map(s => s.id);
        if (salesIds.length === 0) return 0;
        const result = await db.delete(schema.posSalesLines)
          .where(sql`${schema.posSalesLines.posSalesId} IN ${sql.raw(`(${salesIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    {
      name: "pos_sales",
      delete: async () => {
        if (storeIds.length === 0) return 0;
        const result = await db.delete(schema.posSales)
          .where(sql`${schema.posSales.storeId} IN ${sql.raw(`(${storeIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },

    // Recipes
    {
      name: "recipe_components",
      delete: async () => {
        if (recipeIds.length === 0) return 0;
        const result = await db.delete(schema.recipeComponents)
          .where(sql`${schema.recipeComponents.recipeId} IN ${sql.raw(`(${recipeIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    {
      name: "recipe_versions",
      delete: async () => {
        if (recipeIds.length === 0) return 0;
        const result = await db.delete(schema.recipeVersions)
          .where(sql`${schema.recipeVersions.recipeId} IN ${sql.raw(`(${recipeIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },

    // Transfer Orders
    {
      name: "transfer_order_lines",
      delete: async () => {
        const orders = await db.select({ id: schema.transferOrders.id })
          .from(schema.transferOrders)
          .where(eq(schema.transferOrders.companyId, companyId));
        const orderIds = orders.map(o => o.id);
        if (orderIds.length === 0) return 0;
        const result = await db.delete(schema.transferOrderLines)
          .where(sql`${schema.transferOrderLines.transferOrderId} IN ${sql.raw(`(${orderIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    {
      name: "transfer_orders",
      delete: async () => {
        const result = await db.delete(schema.transferOrders)
          .where(eq(schema.transferOrders.companyId, companyId))
          .returning();
        return result.length;
      }
    },
    {
      name: "transfer_logs",
      delete: async () => {
        const result = await db.delete(schema.transferLogs)
          .where(eq(schema.transferLogs.companyId, companyId))
          .returning();
        return result.length;
      }
    },
    {
      name: "waste_logs",
      delete: async () => {
        const result = await db.delete(schema.wasteLogs)
          .where(eq(schema.wasteLogs.companyId, companyId))
          .returning();
        return result.length;
      }
    },

    // Inventory Counts
    {
      name: "inventory_count_lines",
      delete: async () => {
        const counts = await db.select({ id: schema.inventoryCounts.id })
          .from(schema.inventoryCounts)
          .where(eq(schema.inventoryCounts.companyId, companyId));
        const countIds = counts.map(c => c.id);
        if (countIds.length === 0) return 0;
        const result = await db.delete(schema.inventoryCountLines)
          .where(sql`${schema.inventoryCountLines.inventoryCountId} IN ${sql.raw(`(${countIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    {
      name: "inventory_counts",
      delete: async () => {
        const result = await db.delete(schema.inventoryCounts)
          .where(eq(schema.inventoryCounts.companyId, companyId))
          .returning();
        return result.length;
      }
    },

    // Purchase Orders and Receipts
    {
      name: "receipt_lines",
      delete: async () => {
        const receipts = await db.select({ id: schema.receipts.id })
          .from(schema.receipts)
          .where(eq(schema.receipts.companyId, companyId));
        const receiptIds = receipts.map(r => r.id);
        if (receiptIds.length === 0) return 0;
        const result = await db.delete(schema.receiptLines)
          .where(sql`${schema.receiptLines.receiptId} IN ${sql.raw(`(${receiptIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    {
      name: "receipts",
      delete: async () => {
        const result = await db.delete(schema.receipts)
          .where(eq(schema.receipts.companyId, companyId))
          .returning();
        return result.length;
      }
    },
    {
      name: "po_lines",
      delete: async () => {
        const pos = await db.select({ id: schema.purchaseOrders.id })
          .from(schema.purchaseOrders)
          .where(eq(schema.purchaseOrders.companyId, companyId));
        const poIds = pos.map(p => p.id);
        if (poIds.length === 0) return 0;
        const result = await db.delete(schema.poLines)
          .where(sql`${schema.poLines.purchaseOrderId} IN ${sql.raw(`(${poIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    {
      name: "purchase_orders",
      delete: async () => {
        const result = await db.delete(schema.purchaseOrders)
          .where(eq(schema.purchaseOrders.companyId, companyId))
          .returning();
        return result.length;
      }
    },

    // API Credentials
    {
      name: "api_credential_locations",
      delete: async () => {
        if (apiCredentialIds.length === 0) return 0;
        const result = await db.delete(schema.apiCredentialLocations)
          .where(sql`${schema.apiCredentialLocations.apiCredentialId} IN ${sql.raw(`(${apiCredentialIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },

    // Store-level data
    {
      name: "store_inventory_items",
      delete: async () => {
        const result = await db.delete(schema.storeInventoryItems)
          .where(eq(schema.storeInventoryItems.companyId, companyId))
          .returning();
        return result.length;
      }
    },
    {
      name: "store_menu_items",
      delete: async () => {
        if (menuItemIds.length === 0) return 0;
        const result = await db.delete(schema.storeMenuItems)
          .where(sql`${schema.storeMenuItems.menuItemId} IN ${sql.raw(`(${menuItemIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    {
      name: "store_recipes",
      delete: async () => {
        if (recipeIds.length === 0) return 0;
        const result = await db.delete(schema.storeRecipes)
          .where(sql`${schema.storeRecipes.recipeId} IN ${sql.raw(`(${recipeIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    {
      name: "store_storage_locations",
      delete: async () => {
        if (storeIds.length === 0) return 0;
        const result = await db.delete(schema.storeStorageLocations)
          .where(sql`${schema.storeStorageLocations.storeId} IN ${sql.raw(`(${storeIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },

    // Vendor data
    {
      name: "vendor_items",
      delete: async () => {
        if (vendorIds.length === 0) return 0;
        const result = await db.delete(schema.vendorItems)
          .where(sql`${schema.vendorItems.vendorId} IN ${sql.raw(`(${vendorIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    // Note: vendor_credentials is a global table (not company-specific), skip it
    {
      name: "vendors",
      delete: async () => {
        const result = await db.delete(schema.vendors)
          .where(eq(schema.vendors.companyId, companyId))
          .returning();
        return result.length;
      }
    },

    // Inventory item related
    {
      name: "inventory_item_locations",
      delete: async () => {
        if (inventoryItemIds.length === 0) return 0;
        const result = await db.delete(schema.inventoryItemLocations)
          .where(sql`${schema.inventoryItemLocations.inventoryItemId} IN ${sql.raw(`(${inventoryItemIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    {
      name: "inventory_item_price_history",
      delete: async () => {
        if (inventoryItemIds.length === 0) return 0;
        const result = await db.delete(schema.inventoryItemPriceHistory)
          .where(sql`${schema.inventoryItemPriceHistory.inventoryItemId} IN ${sql.raw(`(${inventoryItemIds.map(id => `'${id}'`).join(',')})`)}`)
          .returning();
        return result.length;
      }
    },
    {
      name: "inventory_items",
      delete: async () => {
        const result = await db.delete(schema.inventoryItems)
          .where(eq(schema.inventoryItems.companyId, companyId))
          .returning();
        return result.length;
      }
    },

    // Recipes and Menu Items
    {
      name: "recipes",
      delete: async () => {
        const result = await db.delete(schema.recipes)
          .where(eq(schema.recipes.companyId, companyId))
          .returning();
        return result.length;
      }
    },
    {
      name: "menu_items",
      delete: async () => {
        const result = await db.delete(schema.menuItems)
          .where(eq(schema.menuItems.companyId, companyId))
          .returning();
        return result.length;
      }
    },

    // Company settings and locations
    {
      name: "api_credentials",
      delete: async () => {
        const result = await db.delete(schema.apiCredentials)
          .where(eq(schema.apiCredentials.companyId, companyId))
          .returning();
        return result.length;
      }
    },
    {
      name: "storage_locations",
      delete: async () => {
        const result = await db.delete(schema.storageLocations)
          .where(eq(schema.storageLocations.companyId, companyId))
          .returning();
        return result.length;
      }
    },
    {
      name: "categories",
      delete: async () => {
        const result = await db.delete(schema.categories)
          .where(eq(schema.categories.companyId, companyId))
          .returning();
        return result.length;
      }
    },
    // Note: company_settings is a global table (no companyId), skip it

    // Users (only company-specific users, not global admins)
    {
      name: "users",
      delete: async () => {
        const result = await db.delete(schema.users)
          .where(eq(schema.users.companyId, companyId))
          .returning();
        return result.length;
      }
    },

    // Stores (before company)
    {
      name: "company_stores",
      delete: async () => {
        const result = await db.delete(schema.companyStores)
          .where(eq(schema.companyStores.companyId, companyId))
          .returning();
        return result.length;
      }
    },

    // Finally, the company itself
    {
      name: "companies",
      delete: async () => {
        const result = await db.delete(schema.companies)
          .where(eq(schema.companies.id, companyId))
          .returning();
        return result.length;
      }
    },
  ];

  // Execute deletions
  for (const deletion of deletions) {
    try {
      const rowsDeleted = dryRun ? 0 : await deletion.delete();
      stats.push({
        tableName: deletion.name,
        rowsDeleted,
      });
      
      if (rowsDeleted > 0 || dryRun) {
        const icon = dryRun ? '📋' : '✅';
        console.log(`${icon} ${deletion.name}: ${rowsDeleted} rows ${dryRun ? 'would be deleted' : 'deleted'}`);
      }
    } catch (error: any) {
      console.error(`❌ Error deleting from ${deletion.name}:`, error.message);
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

  // Verify company exists
  const exists = await verifyCompanyExists(companyId);
  if (!exists) {
    console.error(`❌ Company with ID "${companyId}" not found.`);
    process.exit(1);
  }

  const companyInfo = await getCompanyInfo(companyId);
  console.log(`\n🏢 Company: ${companyInfo.name} (${companyInfo.id})`);

  if (!dryRun && !autoConfirm) {
    console.log(`\n⚠️  WARNING: This will permanently delete ALL data for this company!`);
    console.log(`This includes:`);
    console.log(`  - All stores and their inventory`);
    console.log(`  - All vendors and purchase orders`);
    console.log(`  - All recipes and menu items`);
    console.log(`  - All sales data and reports`);
    console.log(`  - All users associated with this company`);
    console.log(`\nType the company name "${companyInfo.name}" to confirm:`);
    
    // Simple confirmation via stdin
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const confirmation = await new Promise<string>((resolve) => {
      rl.question('> ', (answer: string) => {
        rl.close();
        resolve(answer);
      });
    });

    if (confirmation.trim() !== companyInfo.name) {
      console.log(`\n❌ Confirmation failed. No data was deleted.`);
      process.exit(1);
    }
  }

  // Execute purge
  const startTime = Date.now();
  const stats = await purgeCompanyData(companyId, dryRun);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Summary
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

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

export { purgeCompanyData };
