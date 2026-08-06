/**
 * Column definitions for each report type — used by ReportViewer to render the data table.
 */
export interface ColDef {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  format?: (val: any) => string;
}

const usd = (v: any) =>
  v == null ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (v: any) =>
  v == null ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const REPORT_LABELS: Record<string, string> = {
  recipe_cost:       "Recipe Cost",
  inventory_value:   "Inventory Value",
  purchase_activity: "Purchase Activity",
};

export const COLUMN_DEFS: Record<string, ColDef[]> = {
  recipe_cost: [
    { key: "name",         header: "Recipe Name",         align: "left"  },
    { key: "yieldQty",     header: "Yield Qty",           align: "right", format: num },
    { key: "yieldUnit",    header: "Unit",                align: "left"  },
    { key: "totalCost",    header: "Total Cost",          align: "right", format: usd },
    { key: "costPerUnit",  header: "Cost / Unit",         align: "right", format: usd },
  ],
  inventory_value: [
    { key: "storeName",   header: "Store",               align: "left"  },
    { key: "itemName",    header: "Item",                align: "left"  },
    { key: "category",    header: "Category",            align: "left"  },
    { key: "onHandQty",   header: "On Hand",             align: "right", format: num },
    { key: "unit",        header: "Unit",                align: "left"  },
    { key: "unitCost",    header: "Unit Cost",           align: "right", format: usd },
    { key: "totalValue",  header: "Total Value",         align: "right", format: usd },
  ],
  purchase_activity: [
    { key: "date",        header: "Date",                align: "left"  },
    { key: "storeName",   header: "Store",               align: "left"  },
    { key: "vendorName",  header: "Vendor",              align: "left"  },
    { key: "poId",        header: "PO ID",               align: "left"  },
    { key: "lineCount",   header: "Lines",               align: "right" },
    { key: "totalValue",  header: "Total Value",         align: "right", format: usd },
  ],
};
