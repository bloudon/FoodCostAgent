/**
 * AI Chat data tools — company-scoped, read-only data access for the AI assistant.
 *
 * Every tool executes server-side with the authenticated request's companyId
 * baked in. The model chooses WHAT to query, never WHOSE data — tenant
 * isolation is enforced here, not by the model.
 *
 * Adding a new data domain = adding one entry to CHAT_TOOLS below.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rows<T>(result: unknown): T[] {
  return (((result as any).rows || result) as T[]) ?? [];
}

function clampInt(value: unknown, def: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * Serialize a tool result, hard-capped so a huge dataset can't blow up the prompt.
 * Truncates by shrinking array properties (keeping valid JSON), never by slicing text.
 */
function toolJson(payload: Record<string, any>): string {
  const MAX = 24_000; // chars ≈ ~6k tokens
  let out = { ...payload };
  let json = JSON.stringify(out);
  while (json.length > MAX) {
    // Find the largest array property and halve it
    let biggestKey: string | null = null;
    let biggestLen = 1;
    for (const [key, value] of Object.entries(out)) {
      if (Array.isArray(value) && value.length > biggestLen) {
        biggestKey = key;
        biggestLen = value.length;
      }
    }
    if (!biggestKey) break; // nothing left to shrink
    out = {
      ...out,
      [biggestKey]: out[biggestKey].slice(0, Math.floor(biggestLen / 2)),
      truncated: true,
      truncation_note: "Result too large — some rows omitted. Narrow your query (search term, shorter date range, or lower limit).",
    };
    json = JSON.stringify(out);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Tool implementations (all take companyId injected by the server)
// ---------------------------------------------------------------------------

type ToolExecutor = (companyId: string, args: Record<string, any>) => Promise<string>;

const executors: Record<string, ToolExecutor> = {
  async search_inventory_items(companyId, args) {
    const limit = clampInt(args.limit, 25, 1, 100);
    const search = typeof args.search === "string" ? args.search.trim() : "";
    const result = search
      ? await db.execute(sql`
          SELECT ii.name, u.name AS unit, ii.price_per_unit, ii.yield_percent, c.name AS category
          FROM inventory_items ii
          LEFT JOIN units u ON ii.unit_id = u.id
          LEFT JOIN categories c ON ii.category_id = c.id
          WHERE ii.company_id = ${companyId} AND ii.name ILIKE ${"%" + search + "%"}
          ORDER BY ii.price_per_unit DESC NULLS LAST LIMIT ${limit}`)
      : await db.execute(sql`
          SELECT ii.name, u.name AS unit, ii.price_per_unit, ii.yield_percent, c.name AS category
          FROM inventory_items ii
          LEFT JOIN units u ON ii.unit_id = u.id
          LEFT JOIN categories c ON ii.category_id = c.id
          WHERE ii.company_id = ${companyId}
          ORDER BY ii.price_per_unit DESC NULLS LAST LIMIT ${limit}`);
    return toolJson({ items: rows(result) });
  },

  async get_recipes(companyId, args) {
    const search = typeof args.search === "string" ? args.search.trim() : "";
    const limit = clampInt(args.limit, 15, 1, 50);
    const recipesResult = search
      ? await db.execute(sql`
          SELECT r.id, r.name, r.computed_cost, r.yield_qty, u.name AS yield_unit
          FROM recipes r LEFT JOIN units u ON r.yield_unit_id = u.id
          WHERE r.company_id = ${companyId} AND r.is_active = 1
            AND (r.is_placeholder = 0 OR r.is_placeholder IS NULL)
            AND r.name ILIKE ${"%" + search + "%"}
          ORDER BY r.computed_cost DESC NULLS LAST LIMIT ${limit}`)
      : await db.execute(sql`
          SELECT r.id, r.name, r.computed_cost, r.yield_qty, u.name AS yield_unit
          FROM recipes r LEFT JOIN units u ON r.yield_unit_id = u.id
          WHERE r.company_id = ${companyId} AND r.is_active = 1
            AND (r.is_placeholder = 0 OR r.is_placeholder IS NULL)
          ORDER BY r.computed_cost DESC NULLS LAST LIMIT ${limit}`);
    const recipes = rows<any>(recipesResult);

    // Include ingredient detail when explicitly requested or when the search matched few recipes
    const includeIngredients = args.include_ingredients === true || (search && recipes.length <= 3);
    if (includeIngredients) {
      for (const recipe of recipes.slice(0, 5)) {
        const ing = await db.execute(sql`
          SELECT rc.qty,
                 COALESCE(ii.name, r2.name, rc.missing_item_name) AS ingredient,
                 u.name AS unit, ii.price_per_unit, rc.component_type,
                 COALESCE(rc.yield_override, ii.yield_percent) AS effective_yield,
                 r2.computed_cost AS sub_recipe_cost, r2.yield_qty AS sub_recipe_yield_qty
          FROM recipe_components rc
          LEFT JOIN inventory_items ii ON rc.component_id = ii.id AND rc.component_type = 'inventory_item'
          LEFT JOIN recipes r2 ON rc.component_id = r2.id AND rc.component_type = 'recipe'
          LEFT JOIN units u ON rc.unit_id = u.id
          WHERE rc.recipe_id = ${recipe.id}
          ORDER BY rc.sort_order ASC LIMIT 25`);
        recipe.ingredients = rows(ing);
      }
    }
    return toolJson({ recipes });
  },

  async get_menu_items(companyId, args) {
    const search = typeof args.search === "string" ? args.search.trim() : "";
    const limit = clampInt(args.limit, 25, 1, 100);
    const result = search
      ? await db.execute(sql`
          SELECT mi.name, mi.price, r.name AS recipe, r.computed_cost,
                 CASE WHEN mi.price > 0 AND r.computed_cost IS NOT NULL
                      THEN ROUND(((r.computed_cost / mi.price) * 100)::numeric, 1) END AS food_cost_pct
          FROM menu_items mi LEFT JOIN recipes r ON mi.recipe_id = r.id
          WHERE mi.company_id = ${companyId} AND mi.active = 1 AND mi.name ILIKE ${"%" + search + "%"}
          ORDER BY mi.name ASC LIMIT ${limit}`)
      : await db.execute(sql`
          SELECT mi.name, mi.price, r.name AS recipe, r.computed_cost,
                 CASE WHEN mi.price > 0 AND r.computed_cost IS NOT NULL
                      THEN ROUND(((r.computed_cost / mi.price) * 100)::numeric, 1) END AS food_cost_pct
          FROM menu_items mi LEFT JOIN recipes r ON mi.recipe_id = r.id
          WHERE mi.company_id = ${companyId} AND mi.active = 1 AND mi.price > 0
          ORDER BY (CASE WHEN mi.price > 0 AND r.computed_cost IS NOT NULL
                         THEN r.computed_cost / mi.price END) DESC NULLS LAST
          LIMIT ${limit}`);
    return toolJson({ menu_items: rows(result), note: search ? undefined : "sorted worst food-cost % first" });
  },

  async get_waste_log(companyId, args) {
    const days = clampInt(args.days, 30, 1, 365);
    const search = typeof args.search === "string" ? args.search.trim() : "";
    const itemsResult = search
      ? await db.execute(sql`
          SELECT COALESCE(ii.name, mi.name, 'Unknown') AS item, wl.waste_type,
                 SUM(wl.qty) AS total_qty, SUM(wl.total_value) AS total_cost, u.name AS unit
          FROM waste_logs wl
          LEFT JOIN inventory_items ii ON wl.inventory_item_id = ii.id AND wl.waste_type = 'inventory'
          LEFT JOIN menu_items mi ON wl.menu_item_id = mi.id AND wl.waste_type = 'menu_item'
          LEFT JOIN units u ON ii.unit_id = u.id
          WHERE wl.company_id = ${companyId} AND wl.wasted_at >= NOW() - (${days} || ' days')::interval
            AND COALESCE(ii.name, mi.name, 'Unknown') ILIKE ${"%" + search + "%"}
          GROUP BY 1, 2, 5 ORDER BY total_cost DESC LIMIT 50`)
      : await db.execute(sql`
          SELECT COALESCE(ii.name, mi.name, 'Unknown') AS item, wl.waste_type,
                 SUM(wl.qty) AS total_qty, SUM(wl.total_value) AS total_cost, u.name AS unit
          FROM waste_logs wl
          LEFT JOIN inventory_items ii ON wl.inventory_item_id = ii.id AND wl.waste_type = 'inventory'
          LEFT JOIN menu_items mi ON wl.menu_item_id = mi.id AND wl.waste_type = 'menu_item'
          LEFT JOIN units u ON ii.unit_id = u.id
          WHERE wl.company_id = ${companyId} AND wl.wasted_at >= NOW() - (${days} || ' days')::interval
          GROUP BY 1, 2, 5 ORDER BY total_cost DESC LIMIT 50`);
    const totalsResult = await db.execute(sql`
      SELECT SUM(CASE WHEN wl.wasted_at >= NOW() - (${days} || ' days')::interval THEN wl.total_value ELSE 0 END) AS current_total,
             SUM(CASE WHEN wl.wasted_at >= NOW() - (${days * 2} || ' days')::interval
                       AND wl.wasted_at <  NOW() - (${days} || ' days')::interval THEN wl.total_value ELSE 0 END) AS prior_total
      FROM waste_logs wl
      WHERE wl.company_id = ${companyId} AND wl.wasted_at >= NOW() - (${days * 2} || ' days')::interval`);
    return toolJson({ days, items: rows(itemsResult), totals: rows(totalsResult)[0] ?? null });
  },

  async get_count_sessions(companyId, args) {
    const days = clampInt(args.days, 90, 1, 365);
    const result = await db.execute(sql`
      SELECT ic.count_date, ic.name, ic.applied, ic.is_power_session,
             cs.name AS store,
             COUNT(DISTINCT icl.inventory_item_id)::int AS item_count,
             COALESCE(SUM(icl.qty * icl.unit_cost), 0) AS total_value
      FROM inventory_counts ic
      LEFT JOIN company_stores cs ON ic.store_id = cs.id
      LEFT JOIN inventory_count_lines icl ON icl.inventory_count_id = ic.id
      WHERE ic.company_id = ${companyId} AND ic.count_date >= NOW() - (${days} || ' days')::interval
      GROUP BY ic.id, ic.count_date, ic.name, ic.applied, ic.is_power_session, cs.name
      ORDER BY ic.count_date DESC LIMIT 40`);
    return toolJson({ days, sessions: rows(result) });
  },

  async get_tfc_runs(companyId, args) {
    const limit = clampInt(args.limit, 10, 1, 60);
    const result = await db.execute(sql`
      SELECT tur.sales_date, tur.total_revenue, tur.total_theoretical_cost,
             tur.total_theoretical_cost_wac, cs.name AS store,
             CASE WHEN tur.total_revenue > 0
                  THEN ROUND(((tur.total_theoretical_cost / tur.total_revenue) * 100)::numeric, 1) END AS tfc_pct
      FROM theoretical_usage_runs tur
      LEFT JOIN company_stores cs ON tur.store_id = cs.id
      WHERE tur.company_id = ${companyId} AND tur.status = 'completed'
      ORDER BY tur.sales_date DESC LIMIT ${limit}`);
    return toolJson({ runs: rows(result) });
  },

  async get_menus(companyId, _args) {
    const result = await db.execute(sql`
      SELECT m.name, m.menu_type, m.status, m.effective_start, m.recurrence_days,
             COUNT(me.id)::int AS entry_count
      FROM menus m
      LEFT JOIN menu_entries me ON me.menu_id = m.id AND me.company_id = ${companyId}
      WHERE m.company_id = ${companyId} AND m.status IN ('live', 'scheduled', 'ready', 'draft')
      GROUP BY m.id, m.name, m.menu_type, m.status, m.effective_start, m.recurrence_days
      ORDER BY CASE m.status WHEN 'live' THEN 1 WHEN 'scheduled' THEN 2 WHEN 'ready' THEN 3 ELSE 4 END, m.name
      LIMIT 25`);
    return toolJson({ menus: rows(result) });
  },

  async get_vendors(companyId, _args) {
    const result = await db.execute(sql`
      SELECT v.name, v.active, v.delivery_days, v.lead_days_ahead, v.payment_terms,
             COUNT(DISTINCT po.id)::int AS purchase_orders_90d
      FROM vendors v
      LEFT JOIN purchase_orders po ON po.vendor_id = v.id AND po.company_id = ${companyId}
        AND po.created_at >= NOW() - INTERVAL '90 days'
      WHERE v.company_id = ${companyId}
      GROUP BY v.id, v.name, v.active, v.delivery_days, v.lead_days_ahead, v.payment_terms
      ORDER BY v.active DESC, v.name ASC LIMIT 60`);
    return toolJson({ vendors: rows(result) });
  },

  async get_purchase_orders(companyId, args) {
    const days = clampInt(args.days, 30, 1, 365);
    const status = typeof args.status === "string" && ["pending", "ordered", "received"].includes(args.status)
      ? args.status : null;
    const result = status
      ? await db.execute(sql`
          SELECT po.created_at, po.status, po.expected_date, v.name AS vendor, cs.name AS store,
                 COUNT(pl.id)::int AS line_count
          FROM purchase_orders po
          LEFT JOIN vendors v ON po.vendor_id = v.id
          LEFT JOIN company_stores cs ON po.store_id = cs.id
          LEFT JOIN po_lines pl ON pl.purchase_order_id = po.id
          WHERE po.company_id = ${companyId} AND po.status = ${status}
            AND po.created_at >= NOW() - (${days} || ' days')::interval
          GROUP BY po.id, po.created_at, po.status, po.expected_date, v.name, cs.name
          ORDER BY po.created_at DESC LIMIT 50`)
      : await db.execute(sql`
          SELECT po.created_at, po.status, po.expected_date, v.name AS vendor, cs.name AS store,
                 COUNT(pl.id)::int AS line_count
          FROM purchase_orders po
          LEFT JOIN vendors v ON po.vendor_id = v.id
          LEFT JOIN company_stores cs ON po.store_id = cs.id
          LEFT JOIN po_lines pl ON pl.purchase_order_id = po.id
          WHERE po.company_id = ${companyId}
            AND po.created_at >= NOW() - (${days} || ' days')::interval
          GROUP BY po.id, po.created_at, po.status, po.expected_date, v.name, cs.name
          ORDER BY po.created_at DESC LIMIT 50`);
    return toolJson({ days, purchase_orders: rows(result) });
  },
};

// ---------------------------------------------------------------------------
// OpenAI tool definitions
// ---------------------------------------------------------------------------

export const chatToolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "search_inventory_items",
      description: "Look up the company's inventory items with unit, unit price, yield %, and category. Use `search` to find specific items; omit it for the top items by cost.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Partial item name to search for" },
          limit: { type: "number", description: "Max items to return (default 25, max 100)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recipes",
      description: "Look up recipes with computed cost and yield. Use `search` to find specific recipes (ingredient detail included automatically for ≤3 matches) or set include_ingredients.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Partial recipe name" },
          include_ingredients: { type: "boolean", description: "Include per-ingredient cost breakdown (first 5 recipes)" },
          limit: { type: "number", description: "Max recipes (default 15, max 50)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_menu_items",
      description: "Look up menu items with sale price, linked recipe, recipe cost, and food cost %. Without `search`, returns items sorted worst food-cost % first.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Partial menu item name" },
          limit: { type: "number", description: "Max items (default 25, max 100)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_waste_log",
      description: "Waste totals by item over a date window, plus current-vs-prior-period trend totals. Use `search` to find a specific wasted item by name.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Lookback window in days (default 30, max 365)" },
          search: { type: "string", description: "Partial item name to filter waste entries" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_count_sessions",
      description: "Historical inventory count sessions: date, store, items counted, total counted value, applied status. Use for verifying or comparing past counts.",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "Lookback window in days (default 90, max 365)" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_tfc_runs",
      description: "Recent theoretical food cost (TFC) variance runs: sales date, store, revenue, theoretical cost, TFC %.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Max runs (default 10, max 60)" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_menus",
      description: "The menu portfolio: menu names, type, status (live/scheduled/ready/draft), start dates, recurrence days, and entry counts.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_vendors",
      description: "Vendors with delivery days, lead time, payment terms, and 90-day purchase order counts.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_purchase_orders",
      description: "Recent purchase orders with vendor, store, status (pending/ordered/received), expected date, and line counts.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Lookback window in days (default 30, max 365)" },
          status: { type: "string", enum: ["pending", "ordered", "received"], description: "Filter by status" },
        },
      },
    },
  },
];

/** Execute a tool by name with server-injected companyId. Never throws — returns an error payload the model can read. */
export async function executeChatTool(name: string, args: Record<string, any>, companyId: string): Promise<string> {
  const executor = executors[name];
  if (!executor) return JSON.stringify({ error: `Unknown tool: ${name}` });
  try {
    return await executor(companyId, args || {});
  } catch (err: any) {
    console.warn(`Chat tool ${name} failed:`, err);
    return JSON.stringify({ error: `Tool ${name} failed to fetch data` });
  }
}
