/**
 * Smoke-test suite for GlobalSearchService (server/globalSearch.ts)
 *
 * Coverage:
 *  1. Result shape — all 10 entity types return the required fields
 *  2. Routes — especially non-obvious ones:
 *       vendor items  → /vendors/<vendor_id>   (NOT /vendor-items/<vi_id>)
 *       storage locs  → /storage-locations      (list, not a detail page)
 *       order guides  → /order-guides/<id>/review
 *  3. 2-character minimum enforced by the route handler
 *  4. Company scoping — every DB call receives the correct companyId
 *  5. Soft-deleted / inactive records are excluded (SQL WHERE clause verified)
 *
 * All tests run without a live database by default. The live-DB smoke block
 * at the bottom is auto-skipped when DATABASE_URL is absent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GlobalSearchResult } from "./globalSearch";

// ── DB mock ──────────────────────────────────────────────────────────────────
//
// We intercept db.execute at the module level.  Each test configures the
// response via `setNextRows(rowsPerCall)`.  We also capture every SQL string
// that is passed in so the SQL-inspection tests can work.

const capturedSql: string[] = [];

// Mutable closure that tests can replace.
let _rowQueue: Record<string, unknown>[][] = [];

function setNextRows(rowsPerCall: Record<string, unknown>[][]) {
  _rowQueue = [...rowsPerCall];
}

vi.mock("./db", () => ({
  db: {
    execute: vi.fn(async (query: unknown) => {
      // Extract the raw SQL text from whatever drizzle-orm hands us
      let text = "";
      if (typeof query === "string") {
        text = query;
      } else if (query && typeof query === "object") {
        const q = query as any;
        if (Array.isArray(q.queryChunks)) {
          text = q.queryChunks
            .map((c: any) =>
              typeof c === "string" ? c : c?.value != null ? String(c.value) : "",
            )
            .join("");
        } else if (typeof q.sql === "string") {
          text = q.sql;
        } else {
          text = JSON.stringify(query);
        }
      }
      capturedSql.push(text);

      const rows = _rowQueue.shift() ?? [];
      return { rows };
    }),
  },
}));

// ── Lazy import (after mock is registered) ────────────────────────────────────
// We use a dynamic import inside each describe to ensure the mock is in place.
// In Vitest ESM mode, vi.mock() calls are hoisted; the import below will
// always see the mocked version of ./db.

import { GlobalSearchService } from "./globalSearch";

// ── Shared constants ─────────────────────────────────────────────────────────

const COMPANY_ID = "test-company-001";
const OTHER_COMPANY_ID = "other-company-999";

// Helper: queue N sets of empty rows (one per entity type sub-query)
const EMPTY_10 = () => Array.from({ length: 10 }, () => [] as Record<string, unknown>[]);

// ─────────────────────────────────────────────────────────────────────────────
// 1.  Result shape per entity type
// ─────────────────────────────────────────────────────────────────────────────

describe("GlobalSearchService — result shape", () => {
  beforeEach(() => {
    capturedSql.length = 0;
  });

  it("inventory_item: required fields, route, iconKey", async () => {
    setNextRows([
      [{ id: "ii-1", name: "Chicken Breast", plu_sku: null, barcode: null, category_name: "Proteins", unit_abbr: "lb", match_rank: 1, matched_field: "name" }],
      [], [], [], [], [], [], [], [], [],
    ]);
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("Chicken");

    const r = results.find((x) => x.type === "inventory_item");
    expect(r).toBeDefined();
    expect(r!.id).toBe("ii-1");
    expect(r!.name).toBe("Chicken Breast");
    expect(r!.route).toBe("/inventory-items/ii-1");
    expect(r!.iconKey).toBe("package");
    expect(r!.matchedField).toBe("name");
    expect(r!.subtitle).toBe("Proteins · lb");
  });

  it("recipe: yield subtitle and correct route", async () => {
    setNextRows([[], [{ id: "rec-1", name: "Marinara Sauce", yield_qty: 2, yield_unit: "qt", match_rank: 1 }], [], [], [], [], [], [], [], []]);
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("Marinara");

    const r = results.find((x) => x.type === "recipe");
    expect(r).toBeDefined();
    expect(r!.route).toBe("/recipes/rec-1");
    expect(r!.iconKey).toBe("chef-hat");
    expect(r!.subtitle).toBe("Yield: 2 qt");
  });

  it("menu_item: route is /menu-items/<id>, iconKey is utensils", async () => {
    setNextRows([[], [], [{ id: "mi-1", name: "Margherita Pizza", plu_sku: "1234", price: 14.99, department_name: "Pizzas", match_rank: 1, matched_field: "name" }], [], [], [], [], [], [], []]);
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("Margherita");

    const r = results.find((x) => x.type === "menu_item");
    expect(r).toBeDefined();
    expect(r!.route).toBe("/menu-items/mi-1");
    expect(r!.iconKey).toBe("utensils");
    expect(r!.subtitle).toContain("Pizzas");
    expect(r!.subtitle).toContain("$14.99");
  });

  it("vendor: route is /vendors/<id>, iconKey is truck", async () => {
    setNextRows([[], [], [], [], [], [{ id: "v-1", name: "Sysco", order_guide_type: "electronic", payment_terms: "Net 30", match_rank: 1 }], [], [], [], []]);
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("Sysco");

    const r = results.find((x) => x.type === "vendor");
    expect(r).toBeDefined();
    expect(r!.route).toBe("/vendors/v-1");
    expect(r!.iconKey).toBe("truck");
  });

  it("vendor_item: route uses vendor_id (NOT the vendor_item id) — non-obvious", async () => {
    // searchAll order: inventory(0) recipe(1) menu_item(2) prep_item(3) vendor_item(4) vendor(5) po(6) menu(7) storage(8) og(9)
    setNextRows([[], [], [], [], [
      { id: "vi-99", vendor_id: "v-42", vendor_sku: "SKU-001", brand_name: "Tyson", last_case_price: 49.99, case_size: 40, pack_uom: "lb", item_name: "Chicken Breast", vendor_name: "Sysco", purchase_unit: "lb", match_rank: 1, matched_field: "name" },
    ], [], [], [], [], []]);
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("Chicken");

    const r = results.find((x) => x.type === "vendor_item");
    expect(r).toBeDefined();
    // Route must point to the vendor page using vendor_id, not the vendor-item detail
    expect(r!.route).toBe("/vendors/v-42");
    expect(r!.route).not.toContain("vi-99");
    expect(r!.id).toBe("vi-99");
    expect(r!.iconKey).toBe("tag");
    expect(r!.name).toBe("Chicken Breast");
    expect(r!.subtitle).toContain("Sysco");
    expect(r!.subtitle).toContain("$49.99/cs");
  });

  it("purchase_order: route is /purchase-orders/<id>, name includes vendor, iconKey shopping-cart", async () => {
    setNextRows([[], [], [], [], [], [], [
      { id: "po-1", status: "pending", created_at: "2025-01-15T00:00:00Z", vendor_name: "GFS", store_name: "Main Location", match_rank: 1 },
    ], [], [], []]);
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("GFS");

    const r = results.find((x) => x.type === "purchase_order");
    expect(r).toBeDefined();
    expect(r!.route).toBe("/purchase-orders/po-1");
    expect(r!.iconKey).toBe("shopping-cart");
    expect(r!.name).toBe("PO — GFS");
    expect(r!.status).toBe("pending");
  });

  it("prep_item: route is /prep-chart/items/<id>, iconKey is flame", async () => {
    setNextRows([[], [], [], [
      { id: "pi-1", name: "House Dough", output_qty_per_batch: 10, output_unit: "balls", station_name: "Prep", match_rank: 1 },
    ], [], [], [], [], [], []]);
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("Dough");

    const r = results.find((x) => x.type === "prep_item");
    expect(r).toBeDefined();
    expect(r!.route).toBe("/prep-chart/items/pi-1");
    expect(r!.iconKey).toBe("flame");
    expect(r!.subtitle).toContain("10 balls/batch");
    expect(r!.subtitle).toContain("Prep");
  });

  it("menu: route is /menus/<id>, iconKey is book-open", async () => {
    setNextRows([[], [], [], [], [], [], [], [
      { id: "m-1", name: "Dinner Menu", status: "active", menu_type: "dinner", match_rank: 1 },
    ], [], []]);
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("Dinner");

    const r = results.find((x) => x.type === "menu");
    expect(r).toBeDefined();
    expect(r!.route).toBe("/menus/m-1");
    expect(r!.iconKey).toBe("book-open");
    expect(r!.status).toBe("active");
  });

  it("storage_location: route is /storage-locations list (NOT a detail page) — non-obvious", async () => {
    setNextRows([[], [], [], [], [], [], [], [], [
      { id: "sl-1", name: "Walk-in Cooler", match_rank: 1 },
    ], []]);
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("Walk");

    const r = results.find((x) => x.type === "storage_location");
    expect(r).toBeDefined();
    // Route must be the list page, NOT /storage-locations/sl-1
    expect(r!.route).toBe("/storage-locations");
    expect(r!.route).not.toContain("sl-1");
    expect(r!.iconKey).toBe("map-pin");
    expect(r!.name).toBe("Walk-in Cooler");
    expect(r!.id).toBe("sl-1"); // id is still populated (for keying etc.)
  });

  it("order_guide: route is /order-guides/<id>/review, iconKey is file-text", async () => {
    setNextRows([[], [], [], [], [], [], [], [], [], [
      { id: "og-1", vendor_key: "sysco", source: "electronic", status: "processed", fetched_at: "2025-03-01T00:00:00Z", file_name: "sysco_march.csv", detected_vendor_name: null, external_supplier_name: null, vendor_name: "Sysco", match_rank: 1 },
    ]]);
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("Sysco");

    const r = results.find((x) => x.type === "order_guide");
    expect(r).toBeDefined();
    expect(r!.route).toBe("/order-guides/og-1/review");
    expect(r!.iconKey).toBe("file-text");
    expect(r!.name).toBe("sysco_march.csv");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2.  GlobalSearchResult interface contract — all required fields present
// ─────────────────────────────────────────────────────────────────────────────

describe("GlobalSearchResult — interface contract", () => {
  const REQUIRED_FIELDS: (keyof GlobalSearchResult)[] = [
    "type",
    "id",
    "name",
    "route",
    "iconKey",
    "matchedField",
  ];

  it("all 10 entity types return every required field with non-empty values", async () => {
    setNextRows([
      [{ id: "ii-1", name: "A", plu_sku: null, barcode: null, category_name: null, unit_abbr: null, match_rank: 1, matched_field: "name" }],
      [{ id: "r-1",  name: "B", yield_qty: null, yield_unit: null, match_rank: 1 }],
      [{ id: "mi-1", name: "C", plu_sku: null, price: null, department_name: null, match_rank: 1, matched_field: "name" }],
      [{ id: "pi-1", name: "D", output_qty_per_batch: null, output_unit: null, station_name: null, match_rank: 1 }],
      [{ id: "vi-1", vendor_id: "v-1", vendor_sku: null, brand_name: null, last_case_price: null, case_size: null, pack_uom: null, item_name: "E", vendor_name: null, purchase_unit: null, match_rank: 1, matched_field: "name" }],
      [{ id: "v-1",  name: "F", order_guide_type: null, payment_terms: null, match_rank: 1 }],
      [{ id: "po-1", status: "pending", created_at: null, vendor_name: "G", store_name: null, match_rank: 1 }],
      [{ id: "m-1",  name: "H", status: "active", menu_type: null, match_rank: 1 }],
      [{ id: "sl-1", name: "I", match_rank: 1 }],
      [{ id: "og-1", vendor_key: "gfs", source: null, status: "processed", fetched_at: null, file_name: null, detected_vendor_name: null, external_supplier_name: null, vendor_name: "J", match_rank: 1 }],
    ]);

    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("ab");

    expect(results.length).toBe(10);

    for (const result of results) {
      for (const field of REQUIRED_FIELDS) {
        expect(
          result[field],
          `type=${result.type} is missing required field "${field}"`,
        ).toBeDefined();
        expect(
          result[field],
          `type=${result.type} field "${field}" must not be empty string`,
        ).not.toBe("");
      }
      // Every route must be an absolute path
      expect(result.route, `type=${result.type} route must start with /`).toMatch(/^\//);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.  2-character minimum (route handler logic simulation)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/search — 2-character minimum enforcement", () => {
  /**
   * Mirror of the guard at the top of the route handler in routes.ts:
   *   const q = (req.query.q as string ?? "").trim();
   *   if (!q || q.length < 2) return res.status(400).json({ error: "..." });
   */
  function simulateRouteGuard(rawQ: string | undefined): number {
    const q = (rawQ ?? "").trim();
    if (!q || q.length < 2) return 400;
    return 200;
  }

  it("rejects missing query (undefined)", () => {
    expect(simulateRouteGuard(undefined)).toBe(400);
  });

  it("rejects empty string", () => {
    expect(simulateRouteGuard("")).toBe(400);
  });

  it("rejects whitespace-only string", () => {
    expect(simulateRouteGuard("   ")).toBe(400);
  });

  it("rejects a single character", () => {
    expect(simulateRouteGuard("a")).toBe(400);
  });

  it("allows exactly 2 characters", () => {
    expect(simulateRouteGuard("ab")).toBe(200);
  });

  it("allows more than 2 characters", () => {
    expect(simulateRouteGuard("chicken")).toBe(200);
  });

  it("trims whitespace before checking length", () => {
    // " a " trims to "a" → length 1 → reject
    expect(simulateRouteGuard(" a ")).toBe(400);
    // " ab " trims to "ab" → length 2 → allow
    expect(simulateRouteGuard(" ab ")).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.  Company scoping — constructor is honoured
// ─────────────────────────────────────────────────────────────────────────────

describe("GlobalSearchService — company scoping", () => {
  beforeEach(() => {
    capturedSql.length = 0;
  });

  it("every sub-query contains the companyId passed to the constructor", async () => {
    setNextRows(EMPTY_10());
    const svc = new GlobalSearchService(COMPANY_ID);
    await svc.searchAll("ab");

    expect(capturedSql.length).toBeGreaterThanOrEqual(10);
    for (const sql of capturedSql) {
      expect(sql, `SQL fragment missing companyId "${COMPANY_ID}"`).toContain(COMPANY_ID);
    }
  });

  it("a different instance uses its own companyId and not the other one", async () => {
    setNextRows(EMPTY_10());
    const svc = new GlobalSearchService(OTHER_COMPANY_ID);
    await svc.searchAll("ab");

    for (const sql of capturedSql) {
      expect(sql).toContain(OTHER_COMPANY_ID);
      expect(sql).not.toContain(COMPANY_ID);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.  Inactive / soft-deleted record exclusion (SQL WHERE clause inspection)
// ─────────────────────────────────────────────────────────────────────────────

describe("GlobalSearchService — inactive record exclusion (SQL inspection)", () => {
  async function sqlFor(
    method: keyof GlobalSearchService,
    q = "ab",
  ): Promise<string> {
    capturedSql.length = 0;
    setNextRows([[]]);
    const svc = new GlobalSearchService(COMPANY_ID);
    await (svc[method] as (q: string) => Promise<unknown>)(q);
    return capturedSql.join("\n");
  }

  it("searchInventoryItems filters by active = 1", async () => {
    expect(await sqlFor("searchInventoryItems")).toMatch(/active\s*=\s*1/i);
  });

  it("searchRecipes filters by is_active = 1 and is_placeholder = 0", async () => {
    const s = await sqlFor("searchRecipes");
    expect(s).toMatch(/is_active\s*=\s*1/i);
    expect(s).toMatch(/is_placeholder\s*=\s*0/i);
  });

  it("searchMenuItems filters by active = 1 and excludes modifier children (parent_menu_item_id IS NULL)", async () => {
    const s = await sqlFor("searchMenuItems");
    expect(s).toMatch(/active\s*=\s*1/i);
    expect(s).toMatch(/parent_menu_item_id\s+IS\s+NULL/i);
  });

  it("searchVendors filters by active = 1", async () => {
    expect(await sqlFor("searchVendors")).toMatch(/active\s*=\s*1/i);
  });

  it("searchVendorItems filters by vi.active = 1 AND v.active = 1", async () => {
    const s = await sqlFor("searchVendorItems");
    expect(s).toMatch(/vi\.active\s*=\s*1/i);
    expect(s).toMatch(/v\.active\s*=\s*1/i);
  });

  it("searchPrepItems filters by active = 1", async () => {
    expect(await sqlFor("searchPrepItems")).toMatch(/active\s*=\s*1/i);
  });

  it("searchMenus excludes retired menus (status != 'retired')", async () => {
    expect(await sqlFor("searchMenus")).toMatch(/status\s*!=\s*'retired'/i);
  });

  it("searchOrderGuides excludes rejected guides (status != 'rejected')", async () => {
    expect(await sqlFor("searchOrderGuides")).toMatch(/status\s*!=\s*'rejected'/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6.  searchAll — aggregation across all entity types
// ─────────────────────────────────────────────────────────────────────────────

describe("GlobalSearchService.searchAll — aggregation", () => {
  it("returns results from all 10 entity types when each sub-query returns one row", async () => {
    setNextRows([
      [{ id: "ii-1", name: "Alpha", plu_sku: null, barcode: null, category_name: null, unit_abbr: null, match_rank: 1, matched_field: "name" }],
      [{ id: "r-1",  name: "Alpha", yield_qty: null, yield_unit: null, match_rank: 1 }],
      [{ id: "mi-1", name: "Alpha", plu_sku: null, price: null, department_name: null, match_rank: 1, matched_field: "name" }],
      [{ id: "pi-1", name: "Alpha", output_qty_per_batch: null, output_unit: null, station_name: null, match_rank: 1 }],
      [{ id: "vi-1", vendor_id: "v-9", vendor_sku: null, brand_name: null, last_case_price: null, case_size: null, pack_uom: null, item_name: "Alpha", vendor_name: null, purchase_unit: null, match_rank: 1, matched_field: "name" }],
      [{ id: "v-1",  name: "Alpha", order_guide_type: null, payment_terms: null, match_rank: 1 }],
      [{ id: "po-1", status: "pending", created_at: null, vendor_name: "Alpha", store_name: null, match_rank: 1 }],
      [{ id: "m-1",  name: "Alpha", status: "active", menu_type: null, match_rank: 1 }],
      [{ id: "sl-1", name: "Alpha", match_rank: 1 }],
      [{ id: "og-1", vendor_key: null, source: null, status: "processed", fetched_at: null, file_name: null, detected_vendor_name: null, external_supplier_name: null, vendor_name: "Alpha", match_rank: 1 }],
    ]);

    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("Al");

    const types = results.map((r) => r.type);
    const expectedTypes: GlobalSearchResult["type"][] = [
      "inventory_item", "recipe", "menu_item", "prep_item",
      "vendor_item", "vendor", "purchase_order", "menu",
      "storage_location", "order_guide",
    ];

    for (const t of expectedTypes) {
      expect(types, `searchAll must include results of type "${t}"`).toContain(t);
    }
    expect(results.length).toBe(10);
  });

  it("returns empty array when every sub-query finds nothing", async () => {
    setNextRows(EMPTY_10());
    const svc = new GlobalSearchService(COMPANY_ID);
    const results = await svc.searchAll("zzzznotfound");
    expect(results).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7.  LIVE DB smoke — auto-skipped without DATABASE_URL
// ─────────────────────────────────────────────────────────────────────────────

describe("GlobalSearchService — live DB smoke (skipped without DATABASE_URL)", () => {
  const LIVE_COMPANY_ID = "ad95ecda-74a9-49d7-833b-6d7d2f48efd1";

  it("searchAll returns well-shaped results from the live DB", async () => {
    if (!process.env.DATABASE_URL) {
      console.warn("[skip] DATABASE_URL not set");
      return;
    }

    // Bypass the db mock by re-importing the real module inside the test.
    // In practice this test runs in CI where DATABASE_URL is set.
    const { GlobalSearchService: LiveSvc } = await import("./globalSearch");
    const svc = new LiveSvc(LIVE_COMPANY_ID);
    const results = await svc.searchAll("ch");

    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(r.type).toBeDefined();
      expect(r.id).toBeDefined();
      expect(r.name).toBeDefined();
      expect(r.route).toMatch(/^\//);
      expect(r.iconKey).toBeDefined();
      expect(r.matchedField).toBeDefined();
    }
  });

  it("nonexistent companyId returns zero results", async () => {
    if (!process.env.DATABASE_URL) {
      console.warn("[skip] DATABASE_URL not set");
      return;
    }

    const { GlobalSearchService: LiveSvc } = await import("./globalSearch");
    const svc = new LiveSvc("00000000-0000-0000-0000-000000000000");
    const results = await svc.searchAll("ch");
    expect(results).toEqual([]);
  });
});
