/**
 * Report generator dispatcher.
 * Accepts a companyId + ReportFilters, returns rows (for API) or an xlsx Buffer (for email/download).
 */
import type { ReportFilters } from "@workspace/db";
import { getRecipeCostRows, buildRecipeCostWorkbook } from "./recipeCostReport";
import { getInventoryValueRows, buildInventoryValueWorkbook } from "./inventoryValueReport";
import { getPurchaseActivityRows, buildPurchaseActivityWorkbook } from "./purchaseActivityReport";

export async function runReport(
  companyId: string,
  filters: ReportFilters,
  accessibleStoreIds?: string[],
): Promise<{ rows: any[]; reportType: string }> {
  const type = filters.reportType ?? "recipe_cost";
  switch (type) {
    case "recipe_cost":
      return { rows: await getRecipeCostRows(companyId, filters), reportType: type };
    case "inventory_value":
      return { rows: await getInventoryValueRows(companyId, filters, accessibleStoreIds), reportType: type };
    case "purchase_activity":
      return { rows: await getPurchaseActivityRows(companyId, filters, accessibleStoreIds), reportType: type };
    default:
      throw new Error(`Unknown report type: ${type}`);
  }
}

export async function generateReportBuffer(
  companyId: string,
  filters: ReportFilters,
  accessibleStoreIds?: string[],
): Promise<{ buffer: Buffer; filename: string }> {
  const type = filters.reportType ?? "recipe_cost";
  const dateStr = new Date().toISOString().slice(0, 10);
  switch (type) {
    case "recipe_cost": {
      const rows = await getRecipeCostRows(companyId, filters);
      return { buffer: buildRecipeCostWorkbook(rows), filename: `recipe-cost-${dateStr}.xlsx` };
    }
    case "inventory_value": {
      const rows = await getInventoryValueRows(companyId, filters, accessibleStoreIds);
      return { buffer: buildInventoryValueWorkbook(rows), filename: `inventory-value-${dateStr}.xlsx` };
    }
    case "purchase_activity": {
      const rows = await getPurchaseActivityRows(companyId, filters, accessibleStoreIds);
      return { buffer: buildPurchaseActivityWorkbook(rows), filename: `purchase-activity-${dateStr}.xlsx` };
    }
    default:
      throw new Error(`Unknown report type: ${type}`);
  }
}
