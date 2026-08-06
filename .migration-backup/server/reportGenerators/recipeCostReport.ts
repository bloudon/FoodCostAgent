import * as XLSX from "xlsx";
import { db } from "../db";
import { sql } from "drizzle-orm";
import type { ReportFilters } from "@shared/schema";

export interface RecipeCostRow {
  name: string;
  yieldQty: number;
  yieldUnit: string;
  totalCost: number;
  costPerUnit: number;
}

export async function getRecipeCostRows(companyId: string, _filters: ReportFilters): Promise<RecipeCostRow[]> {
  const result = await db.execute(sql`
    SELECT
      r.name,
      r.yield_qty       AS "yieldQty",
      COALESCE(u.abbreviation, '') AS "yieldUnit",
      r.computed_cost   AS "totalCost",
      CASE WHEN r.yield_qty > 0 THEN r.computed_cost / r.yield_qty ELSE 0 END AS "costPerUnit"
    FROM recipes r
    LEFT JOIN units u ON u.id = r.yield_unit_id
    WHERE r.company_id = ${companyId}
      AND r.is_active = 1
      AND r.is_placeholder = 0
    ORDER BY r.name ASC
  `);
  return (result as any).rows ?? [];
}

export function buildRecipeCostWorkbook(rows: RecipeCostRow[]): Buffer {
  const sheetData = rows.map(r => ({
    "Recipe Name":          r.name,
    "Yield Qty":            r.yieldQty ?? 0,
    "Yield Unit":           r.yieldUnit ?? "",
    "Total Recipe Cost ($)": Number(r.totalCost ?? 0).toFixed(4),
    "Cost per Unit ($)":     Number(r.costPerUnit ?? 0).toFixed(4),
  }));
  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recipe Cost");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
