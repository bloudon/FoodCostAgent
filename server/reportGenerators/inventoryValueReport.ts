import * as XLSX from "xlsx";
import { db } from "../db";
import { sql } from "drizzle-orm";
import type { ReportFilters } from "@shared/schema";

export interface InventoryValueRow {
  storeName: string;
  itemName: string;
  category: string;
  onHandQty: number;
  unit: string;
  unitCost: number;
  totalValue: number;
}

export async function getInventoryValueRows(
  companyId: string,
  filters: ReportFilters,
  accessibleStoreIds?: string[],
): Promise<InventoryValueRow[]> {
  // Build store scope: explicit storeId > accessible set > no restriction
  // IMPORTANT: if accessibleStoreIds is provided and empty, return no rows (safe default)
  let storeFilter: ReturnType<typeof sql>;
  if (filters.storeId) {
    storeFilter = sql` AND sii.store_id = ${filters.storeId}`;
  } else if (accessibleStoreIds !== undefined) {
    if (accessibleStoreIds.length === 0) {
      // Caller provided an empty scope — user has no accessible stores; return nothing
      return [];
    }
    storeFilter = sql` AND sii.store_id = ANY(${accessibleStoreIds}::text[])`;
  } else {
    storeFilter = sql``;
  }
  const result = await db.execute(sql`
    SELECT
      cs.name   AS "storeName",
      ii.name   AS "itemName",
      COALESCE(c.name, 'Uncategorized') AS "category",
      sii.on_hand_qty   AS "onHandQty",
      COALESCE(u.abbreviation, '') AS "unit",
      ii.price_per_unit AS "unitCost",
      sii.on_hand_qty * ii.price_per_unit AS "totalValue"
    FROM store_inventory_items sii
    JOIN inventory_items  ii ON ii.id  = sii.inventory_item_id
    JOIN company_stores   cs ON cs.id  = sii.store_id
    LEFT JOIN categories   c ON c.id   = ii.category_id
    LEFT JOIN units        u ON u.id   = ii.unit_id
    WHERE sii.company_id = ${companyId}
      AND sii.active = 1
      AND ii.active  = 1
      ${storeFilter}
    ORDER BY cs.name ASC, ii.name ASC
  `);
  return (result as any).rows ?? [];
}

export function buildInventoryValueWorkbook(rows: InventoryValueRow[]): Buffer {
  const sheetData = rows.map(r => ({
    "Store":           r.storeName,
    "Item Name":       r.itemName,
    "Category":        r.category,
    "On Hand Qty":     r.onHandQty ?? 0,
    "Unit":            r.unit ?? "",
    "Unit Cost ($)":   Number(r.unitCost ?? 0).toFixed(4),
    "Total Value ($)": Number(r.totalValue ?? 0).toFixed(2),
  }));
  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventory Value");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
