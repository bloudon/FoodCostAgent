import * as XLSX from "xlsx";
import { db } from "../db";
import { sql } from "drizzle-orm";
import type { ReportFilters } from "@workspace/db";

export interface PurchaseActivityRow {
  date: string;
  storeName: string;
  vendorName: string;
  poId: string;
  lineCount: number;
  totalValue: number;
}

export async function getPurchaseActivityRows(
  companyId: string,
  filters: ReportFilters,
  accessibleStoreIds?: string[],
): Promise<PurchaseActivityRow[]> {
  const extraParts: any[] = [];
  // Store scope: explicit storeId > accessible set > no restriction
  // IMPORTANT: if accessibleStoreIds is provided and empty, return no rows (safe default)
  if (filters.storeId) {
    extraParts.push(sql` AND r.store_id = ${filters.storeId}`);
  } else if (accessibleStoreIds !== undefined) {
    if (accessibleStoreIds.length === 0) {
      // Caller provided an empty scope — user has no accessible stores; return nothing
      return [];
    }
    extraParts.push(sql` AND r.store_id = ANY(${accessibleStoreIds}::text[])`);
  }
  if (filters.dateFrom) extraParts.push(sql` AND r.received_at >= ${new Date(filters.dateFrom)}`);
  if (filters.dateTo)   extraParts.push(sql` AND r.received_at <= ${new Date(filters.dateTo + "T23:59:59Z")}`);
  const extra = extraParts.length ? sql.join(extraParts, sql``) : sql``;

  const result = await db.execute(sql`
    SELECT
      TO_CHAR(r.received_at, 'YYYY-MM-DD') AS "date",
      cs.name    AS "storeName",
      v.name     AS "vendorName",
      po.id      AS "poId",
      COUNT(rl.id)::int AS "lineCount",
      COALESCE(SUM(rl.received_qty * rl.price_each), 0) AS "totalValue"
    FROM receipts r
    JOIN purchase_orders po ON po.id = r.purchase_order_id
    JOIN vendors         v  ON v.id  = po.vendor_id
    JOIN company_stores  cs ON cs.id = r.store_id
    LEFT JOIN receipt_lines rl ON rl.receipt_id = r.id
    WHERE r.company_id = ${companyId}
      AND r.status = 'completed'
      ${extra}
    GROUP BY r.id, r.received_at, cs.name, v.name, po.id
    ORDER BY r.received_at DESC
  `);
  return (result as any).rows ?? [];
}

export function buildPurchaseActivityWorkbook(rows: PurchaseActivityRow[]): Buffer {
  const sheetData = rows.map(r => ({
    "Date":            r.date,
    "Store":           r.storeName,
    "Vendor":          r.vendorName,
    "PO Reference":    r.poId,
    "Lines":           r.lineCount ?? 0,
    "Total Value ($)": Number(r.totalValue ?? 0).toFixed(2),
  }));
  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Purchase Activity");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
