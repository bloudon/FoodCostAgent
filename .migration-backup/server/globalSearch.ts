import { db } from "./db";
import { sql } from "drizzle-orm";

export type SearchEntityType =
  | "inventory_item"
  | "recipe"
  | "menu_item"
  | "vendor"
  | "vendor_item"
  | "purchase_order"
  | "prep_item"
  | "menu"
  | "storage_location"
  | "order_guide";

export interface GlobalSearchResult {
  type: SearchEntityType;
  id: string;
  name: string;
  subtitle?: string;
  route: string;
  status?: string;
  iconKey: string;
  matchedField: string;
}

const LIMIT = 5;

function normalizeForBarcode(q: string): string {
  return q.replace(/[\s\-]/g, "");
}

function buildSubtitle(...parts: (string | number | null | undefined)[]): string | undefined {
  const filtered = parts.filter((p) => p !== null && p !== undefined && p !== "");
  return filtered.length > 0 ? filtered.map(String).join(" · ") : undefined;
}

export class GlobalSearchService {
  private companyId: string;

  constructor(companyId: string) {
    this.companyId = companyId;
  }

  async searchAll(q: string): Promise<GlobalSearchResult[]> {
    const [
      inventoryItemResults,
      recipeResults,
      menuItemResults,
      prepItemResults,
      vendorItemResults,
      vendorResults,
      purchaseOrderResults,
      menuResults,
      storageLocationResults,
      orderGuideResults,
    ] = await Promise.all([
      this.searchInventoryItems(q),
      this.searchRecipes(q),
      this.searchMenuItems(q),
      this.searchPrepItems(q),
      this.searchVendorItems(q),
      this.searchVendors(q),
      this.searchPurchaseOrders(q),
      this.searchMenus(q),
      this.searchStorageLocations(q),
      this.searchOrderGuides(q),
    ]);

    return [
      ...inventoryItemResults,
      ...recipeResults,
      ...menuItemResults,
      ...prepItemResults,
      ...vendorItemResults,
      ...vendorResults,
      ...purchaseOrderResults,
      ...menuResults,
      ...storageLocationResults,
      ...orderGuideResults,
    ];
  }

  async searchInventoryItems(q: string): Promise<GlobalSearchResult[]> {
    const normalizedQ = normalizeForBarcode(q);
    const pct = `%${q}%`;
    const prefix = `${q}%`;
    const pctNorm = `%${normalizedQ}%`;

    const result = await db.execute(sql`
      SELECT
        ii.id,
        ii.name,
        ii.plu_sku,
        ii.barcode,
        c.name AS category_name,
        u.abbreviation AS unit_abbr,
        CASE
          WHEN lower(ii.name) = lower(${q}) THEN 1
          WHEN lower(ii.name) LIKE lower(${prefix}) THEN 2
          WHEN lower(coalesce(ii.plu_sku,'')) = lower(${q}) THEN 3
          WHEN lower(regexp_replace(coalesce(ii.barcode,''), '[\s\-]', '', 'g')) = lower(${normalizedQ}) THEN 3
          WHEN lower(ii.name) LIKE lower(${pct}) THEN 4
          ELSE 5
        END AS match_rank,
        CASE
          WHEN lower(ii.name) LIKE lower(${pct}) THEN 'name'
          WHEN ii.plu_sku ILIKE ${pct} THEN 'plu_sku'
          ELSE 'barcode'
        END AS matched_field
      FROM inventory_items ii
      LEFT JOIN categories c ON ii.category_id = c.id
      LEFT JOIN units u ON ii.unit_id = u.id
      WHERE ii.company_id = ${this.companyId}
        AND ii.active = 1
        AND (
          ii.name ILIKE ${pct}
          OR ii.plu_sku ILIKE ${pct}
          OR regexp_replace(coalesce(ii.barcode,''), '[\s\-]', '', 'g') ILIKE ${pctNorm}
        )
      ORDER BY match_rank ASC, ii.name ASC
      LIMIT ${LIMIT}
    `);

    return (result.rows as any[]).map((row) => ({
      type: "inventory_item" as SearchEntityType,
      id: row.id,
      name: row.name,
      subtitle: buildSubtitle(row.category_name, row.unit_abbr),
      route: `/inventory-items/${row.id}`,
      iconKey: "package",
      matchedField: row.matched_field as string,
    }));
  }

  async searchRecipes(q: string): Promise<GlobalSearchResult[]> {
    const pct = `%${q}%`;
    const prefix = `${q}%`;

    const result = await db.execute(sql`
      SELECT
        r.id,
        r.name,
        r.yield_qty,
        u.abbreviation AS yield_unit,
        CASE
          WHEN lower(r.name) = lower(${q}) THEN 1
          WHEN lower(r.name) LIKE lower(${prefix}) THEN 2
          WHEN lower(r.name) LIKE lower(${pct}) THEN 4
          ELSE 5
        END AS match_rank
      FROM recipes r
      LEFT JOIN units u ON r.yield_unit_id = u.id
      WHERE r.company_id = ${this.companyId}
        AND r.is_active = 1
        AND r.is_placeholder = 0
        AND r.name ILIKE ${pct}
      ORDER BY match_rank ASC, r.name ASC
      LIMIT ${LIMIT}
    `);

    return (result.rows as any[]).map((row) => ({
      type: "recipe" as SearchEntityType,
      id: row.id,
      name: row.name,
      subtitle:
        row.yield_qty && row.yield_unit
          ? `Yield: ${Number(row.yield_qty)} ${row.yield_unit}`
          : undefined,
      route: `/recipes/${row.id}`,
      iconKey: "chef-hat",
      matchedField: "name",
    }));
  }

  async searchMenuItems(q: string): Promise<GlobalSearchResult[]> {
    const pct = `%${q}%`;
    const prefix = `${q}%`;

    const result = await db.execute(sql`
      SELECT
        mi.id,
        mi.name,
        mi.plu_sku,
        mi.price,
        md.name AS department_name,
        CASE
          WHEN lower(mi.name) = lower(${q}) THEN 1
          WHEN lower(mi.name) LIKE lower(${prefix}) THEN 2
          WHEN lower(coalesce(mi.plu_sku,'')) = lower(${q}) THEN 3
          WHEN lower(mi.name) LIKE lower(${pct}) THEN 4
          ELSE 5
        END AS match_rank,
        CASE
          WHEN lower(mi.name) LIKE lower(${pct}) THEN 'name'
          ELSE 'plu_sku'
        END AS matched_field
      FROM menu_items mi
      LEFT JOIN menu_departments md ON mi.menu_department_id = md.id
      WHERE mi.company_id = ${this.companyId}
        AND mi.active = 1
        AND mi.parent_menu_item_id IS NULL
        AND (
          mi.name ILIKE ${pct}
          OR mi.plu_sku ILIKE ${pct}
        )
      ORDER BY match_rank ASC, mi.name ASC
      LIMIT ${LIMIT}
    `);

    return (result.rows as any[]).map((row) => {
      const parts: string[] = [];
      if (row.department_name) parts.push(row.department_name as string);
      if (row.price != null) parts.push(`$${Number(row.price).toFixed(2)}`);
      return {
        type: "menu_item" as SearchEntityType,
        id: row.id,
        name: row.name,
        subtitle: parts.length > 0 ? parts.join(" · ") : undefined,
        route: `/menu-items/${row.id}`,
        iconKey: "utensils",
        matchedField: row.matched_field as string,
      };
    });
  }

  async searchVendors(q: string): Promise<GlobalSearchResult[]> {
    const pct = `%${q}%`;
    const prefix = `${q}%`;

    const result = await db.execute(sql`
      SELECT
        v.id,
        v.name,
        v.order_guide_type,
        v.payment_terms,
        CASE
          WHEN lower(v.name) = lower(${q}) THEN 1
          WHEN lower(v.name) LIKE lower(${prefix}) THEN 2
          WHEN lower(v.name) LIKE lower(${pct}) THEN 4
          ELSE 5
        END AS match_rank
      FROM vendors v
      WHERE v.company_id = ${this.companyId}
        AND v.active = 1
        AND v.name ILIKE ${pct}
      ORDER BY match_rank ASC, v.name ASC
      LIMIT ${LIMIT}
    `);

    return (result.rows as any[]).map((row) => {
      const parts: string[] = [];
      if (row.order_guide_type && row.order_guide_type !== "manual")
        parts.push(row.order_guide_type as string);
      if (row.payment_terms) parts.push(row.payment_terms as string);
      return {
        type: "vendor" as SearchEntityType,
        id: row.id,
        name: row.name,
        subtitle: parts.length > 0 ? parts.join(" · ") : undefined,
        route: `/vendors/${row.id}`,
        iconKey: "truck",
        matchedField: "name",
      };
    });
  }

  async searchVendorItems(q: string): Promise<GlobalSearchResult[]> {
    const pct = `%${q}%`;
    const prefix = `${q}%`;

    const result = await db.execute(sql`
      SELECT
        vi.id,
        vi.vendor_sku,
        vi.brand_name,
        vi.last_case_price,
        vi.case_size,
        vi.pack_uom,
        vi.vendor_id,
        ii.name AS item_name,
        v.name AS vendor_name,
        u.abbreviation AS purchase_unit,
        CASE
          WHEN lower(ii.name) = lower(${q}) THEN 1
          WHEN lower(ii.name) LIKE lower(${prefix}) THEN 2
          WHEN lower(coalesce(vi.vendor_sku,'')) = lower(${q}) THEN 3
          WHEN lower(ii.name) LIKE lower(${pct}) THEN 4
          ELSE 5
        END AS match_rank,
        CASE
          WHEN lower(ii.name) LIKE lower(${pct}) THEN 'name'
          WHEN vi.vendor_sku ILIKE ${pct} THEN 'vendor_sku'
          ELSE 'brand_name'
        END AS matched_field
      FROM vendor_items vi
      JOIN inventory_items ii ON vi.inventory_item_id = ii.id
      JOIN vendors v ON vi.vendor_id = v.id
      LEFT JOIN units u ON vi.purchase_unit_id = u.id
      WHERE ii.company_id = ${this.companyId}
        AND vi.active = 1
        AND v.active = 1
        AND (
          ii.name ILIKE ${pct}
          OR vi.vendor_sku ILIKE ${pct}
          OR vi.brand_name ILIKE ${pct}
        )
      ORDER BY match_rank ASC, ii.name ASC
      LIMIT ${LIMIT}
    `);

    return (result.rows as any[]).map((row) => {
      const parts: string[] = [];
      if (row.vendor_name) parts.push(row.vendor_name as string);
      if (row.case_size && row.purchase_unit)
        parts.push(`${Number(row.case_size)} ${row.purchase_unit}`);
      if (row.last_case_price != null)
        parts.push(`$${Number(row.last_case_price).toFixed(2)}/cs`);
      return {
        type: "vendor_item" as SearchEntityType,
        id: row.id,
        name: row.item_name as string,
        subtitle: parts.length > 0 ? parts.join(" · ") : undefined,
        route: `/vendors/${row.vendor_id}`,
        iconKey: "tag",
        matchedField: row.matched_field as string,
      };
    });
  }

  async searchPurchaseOrders(q: string): Promise<GlobalSearchResult[]> {
    const pct = `%${q}%`;
    const prefix = `${q}%`;

    const result = await db.execute(sql`
      SELECT
        po.id,
        po.status,
        po.created_at,
        v.name AS vendor_name,
        s.name AS store_name,
        CASE
          WHEN lower(v.name) = lower(${q}) THEN 1
          WHEN lower(v.name) LIKE lower(${prefix}) THEN 2
          WHEN lower(v.name) LIKE lower(${pct}) THEN 4
          ELSE 5
        END AS match_rank
      FROM purchase_orders po
      JOIN vendors v ON po.vendor_id = v.id
      JOIN company_stores s ON po.store_id = s.id
      WHERE po.company_id = ${this.companyId}
        AND (
          v.name ILIKE ${pct}
          OR po.id ILIKE ${pct}
        )
      ORDER BY match_rank ASC, po.created_at DESC
      LIMIT ${LIMIT}
    `);

    return (result.rows as any[]).map((row) => {
      const parts: string[] = [];
      if (row.vendor_name) parts.push(row.vendor_name as string);
      if (row.store_name) parts.push(row.store_name as string);
      if (row.status) parts.push(row.status as string);
      if (row.created_at) {
        const d = new Date(row.created_at as string);
        parts.push(d.toLocaleDateString());
      }
      return {
        type: "purchase_order" as SearchEntityType,
        id: row.id,
        name: `PO — ${row.vendor_name}`,
        subtitle: parts.join(" · ") || undefined,
        route: `/purchase-orders/${row.id}`,
        status: row.status as string,
        iconKey: "shopping-cart",
        matchedField: "vendor_name",
      };
    });
  }

  async searchPrepItems(q: string): Promise<GlobalSearchResult[]> {
    const pct = `%${q}%`;
    const prefix = `${q}%`;

    const result = await db.execute(sql`
      SELECT
        pi.id,
        pi.name,
        pi.output_qty_per_batch,
        pi.output_unit,
        st.name AS station_name,
        CASE
          WHEN lower(pi.name) = lower(${q}) THEN 1
          WHEN lower(pi.name) LIKE lower(${prefix}) THEN 2
          WHEN lower(pi.name) LIKE lower(${pct}) THEN 4
          ELSE 5
        END AS match_rank
      FROM prep_items pi
      LEFT JOIN stations st ON pi.station_id = st.id
      WHERE pi.company_id = ${this.companyId}
        AND pi.active = 1
        AND pi.name ILIKE ${pct}
      ORDER BY match_rank ASC, pi.name ASC
      LIMIT ${LIMIT}
    `);

    return (result.rows as any[]).map((row) => {
      const parts: string[] = [];
      if (row.output_qty_per_batch && row.output_unit)
        parts.push(`${Number(row.output_qty_per_batch)} ${row.output_unit}/batch`);
      if (row.station_name) parts.push(row.station_name as string);
      return {
        type: "prep_item" as SearchEntityType,
        id: row.id,
        name: row.name,
        subtitle: parts.length > 0 ? parts.join(" · ") : undefined,
        route: `/prep-chart/items/${row.id}`,
        iconKey: "flame",
        matchedField: "name",
      };
    });
  }

  async searchMenus(q: string): Promise<GlobalSearchResult[]> {
    const pct = `%${q}%`;
    const prefix = `${q}%`;

    const result = await db.execute(sql`
      SELECT
        m.id,
        m.name,
        m.status,
        m.menu_type,
        CASE
          WHEN lower(m.name) = lower(${q}) THEN 1
          WHEN lower(m.name) LIKE lower(${prefix}) THEN 2
          WHEN lower(m.name) LIKE lower(${pct}) THEN 4
          ELSE 5
        END AS match_rank
      FROM menus m
      WHERE m.company_id = ${this.companyId}
        AND m.status != 'retired'
        AND m.name ILIKE ${pct}
      ORDER BY match_rank ASC, m.name ASC
      LIMIT ${LIMIT}
    `);

    return (result.rows as any[]).map((row) => {
      const parts: string[] = [];
      if (row.menu_type) parts.push(row.menu_type as string);
      if (row.status) parts.push(row.status as string);
      return {
        type: "menu" as SearchEntityType,
        id: row.id,
        name: row.name,
        subtitle: parts.length > 0 ? parts.join(" · ") : undefined,
        route: `/menus/${row.id}`,
        status: row.status as string,
        iconKey: "book-open",
        matchedField: "name",
      };
    });
  }

  async searchStorageLocations(q: string): Promise<GlobalSearchResult[]> {
    const pct = `%${q}%`;
    const prefix = `${q}%`;

    const result = await db.execute(sql`
      SELECT
        sl.id,
        sl.name,
        CASE
          WHEN lower(sl.name) = lower(${q}) THEN 1
          WHEN lower(sl.name) LIKE lower(${prefix}) THEN 2
          WHEN lower(sl.name) LIKE lower(${pct}) THEN 4
          ELSE 5
        END AS match_rank
      FROM storage_locations sl
      WHERE sl.company_id = ${this.companyId}
        AND sl.name ILIKE ${pct}
      ORDER BY match_rank ASC, sl.name ASC
      LIMIT ${LIMIT}
    `);

    return (result.rows as any[]).map((row) => ({
      type: "storage_location" as SearchEntityType,
      id: row.id,
      name: row.name,
      subtitle: undefined,
      route: `/storage-locations`,
      iconKey: "map-pin",
      matchedField: "name",
    }));
  }

  async searchOrderGuides(q: string): Promise<GlobalSearchResult[]> {
    const pct = `%${q}%`;
    const prefix = `${q}%`;

    const result = await db.execute(sql`
      SELECT
        og.id,
        og.vendor_key,
        og.source,
        og.status,
        og.fetched_at,
        og.file_name,
        og.detected_vendor_name,
        og.external_supplier_name,
        v.name AS vendor_name,
        CASE
          WHEN lower(coalesce(v.name, og.detected_vendor_name, og.external_supplier_name, og.vendor_key)) = lower(${q}) THEN 1
          WHEN lower(coalesce(v.name, og.detected_vendor_name, og.external_supplier_name, og.vendor_key)) LIKE lower(${prefix}) THEN 2
          WHEN lower(coalesce(v.name, og.detected_vendor_name, og.external_supplier_name, og.vendor_key)) LIKE lower(${pct}) THEN 4
          ELSE 5
        END AS match_rank
      FROM order_guides og
      LEFT JOIN vendors v ON og.vendor_id = v.id
      WHERE og.company_id = ${this.companyId}
        AND og.status != 'rejected'
        AND (
          coalesce(v.name, og.detected_vendor_name, og.external_supplier_name, og.vendor_key) ILIKE ${pct}
          OR og.file_name ILIKE ${pct}
        )
      ORDER BY match_rank ASC, og.fetched_at DESC
      LIMIT ${LIMIT}
    `);

    return (result.rows as any[]).map((row) => {
      const displayVendor =
        (row.vendor_name as string) ||
        (row.detected_vendor_name as string) ||
        (row.external_supplier_name as string) ||
        (row.vendor_key as string);
      const parts: string[] = [];
      if (displayVendor) parts.push(displayVendor);
      if (row.source) parts.push(row.source as string);
      if (row.fetched_at) {
        const d = new Date(row.fetched_at as string);
        parts.push(d.toLocaleDateString());
      }
      return {
        type: "order_guide" as SearchEntityType,
        id: row.id,
        name: (row.file_name as string) || `Order Guide — ${displayVendor}`,
        subtitle: parts.join(" · ") || undefined,
        route: `/order-guides/${row.id}/review`,
        status: row.status as string,
        iconKey: "file-text",
        matchedField: "vendor",
      };
    });
  }
}
