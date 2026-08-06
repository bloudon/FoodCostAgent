/**
 * Menu Forecast Service
 *
 * Computes weighted food-cost projections from operator-entered forecast
 * quantities (forecastQty) and surfaces POS-history suggestions where
 * recent sales data is available.
 *
 * Also exports `activateScheduledMenus` — the cron-style helper that
 * promotes menus whose effectiveStart has passed from 'scheduled' to
 * 'live'.
 */

import { eq, and, gte, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  menus,
  menuEntries,
  menuItems,
  recipes,
  dailyMenuItemSales,
} from "@workspace/db";

// ── Public types ────────────────────────────────────────────────────────────

export interface ForecastEntry {
  entryId:          string;
  menuItemId:       string;
  itemName:         string;
  price:            number | null;
  recipeCost:       number | null;
  forecastQty:      number | null;
  /** Mix-% computed from forecastQty / total — null when totalForecastQty is 0 */
  forecastPct:      number | null;
  projectedRevenue:  number | null;
  projectedFoodCost: number | null;
  /** Average daily qty sold over the past 30 days (from POS/CSV history) */
  suggestedQty:     number | null;
}

export interface ForecastReport {
  menuId:                  string;
  totalForecastQty:        number;
  entriesWithForecast:     number;
  totalEntries:            number;
  projectedRevenue:        number | null;
  projectedFoodCost:       number | null;
  projectedFoodCostPct:    number | null;
  projectedGrossMargin:    number | null;
  projectedGrossMarginPct: number | null;
  /** True when at least one entry has no forecastQty — projections are incomplete */
  isPartialForecast:       boolean;
  entries:                 ForecastEntry[];
}

// ── Core forecast computation ────────────────────────────────────────────────

export async function computeMenuForecastImpl(
  menuId: string,
  companyId: string,
): Promise<ForecastReport> {

  // ── 1. Load entries with item name + recipe cost ─────────────────────────
  const rows = await db
    .select({
      entryId:     menuEntries.id,
      menuItemId:  menuEntries.menuItemId,
      price:       menuEntries.price,
      forecastQty: menuEntries.forecastQty,
      itemName:    menuItems.name,
      recipeCost:  recipes.computedCost,
    })
    .from(menuEntries)
    // @ts-ignore
    .innerJoin(menuItems, eq(menuEntries.menuItemId, menuItems.id))
    .leftJoin(recipes, and(
      // @ts-ignore
      eq(menuItems.recipeId, recipes.id),
      // @ts-ignore
      eq(recipes.isPlaceholder, 0),
    ))
    .where(and(
      // @ts-ignore
      eq(menuEntries.menuId, menuId),
      // @ts-ignore
      eq(menuEntries.companyId, companyId),
    ));

  if (rows.length === 0) {
    return emptyReport(menuId);
  }

  // ── 2. POS suggestion map — 30-day average daily qty ────────────────────
  const menuItemIds = rows.map((r: (typeof rows)[number]) => r.menuItemId);
  const posSuggestions = new Map<string, number>();

  if (menuItemIds.length > 0) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const posRows = await db
      .select({
        menuItemId: dailyMenuItemSales.menuItemId,
        avgQty: sql<number>`ROUND(AVG(${dailyMenuItemSales.qtySold})::numeric, 0)`,
      })
      .from(dailyMenuItemSales)
      .where(and(
        // @ts-ignore
        eq(dailyMenuItemSales.companyId, companyId),
        // @ts-ignore
        inArray(dailyMenuItemSales.menuItemId, menuItemIds),
        // @ts-ignore
        gte(dailyMenuItemSales.salesDate, thirtyDaysAgo),
      ))
      .groupBy(dailyMenuItemSales.menuItemId);

    for (const pr of posRows) {
      if (pr.avgQty != null) posSuggestions.set(pr.menuItemId, Number(pr.avgQty));
    }
  }

  // ── 3. Per-entry projections ─────────────────────────────────────────────
  let totalForecastQty     = 0;
  let entriesWithForecast  = 0;
  let sumRevenue           = 0;
  let sumFoodCost          = 0;
  let revenueComplete      = true;
  let foodCostComplete     = true;

  const entries: ForecastEntry[] = rows.map((r: (typeof rows)[number]) => {
    const qty = typeof r.forecastQty === "number" ? r.forecastQty : null;

    if (qty != null && qty > 0) {
      totalForecastQty += qty;
      entriesWithForecast += 1;
    }

    const projRev = r.price != null && qty != null ? r.price * qty : null;
    const projFc  = r.recipeCost != null && qty != null ? r.recipeCost * qty : null;

    if (projRev != null) sumRevenue += projRev; else revenueComplete = false;
    if (projFc  != null) sumFoodCost += projFc; else foodCostComplete = false;

    return {
      entryId:           r.entryId,
      menuItemId:        r.menuItemId,
      itemName:          r.itemName,
      price:             r.price ?? null,
      recipeCost:        r.recipeCost ?? null,
      forecastQty:       qty,
      forecastPct:       null, // filled in below
      projectedRevenue:  projRev,
      projectedFoodCost: projFc,
      suggestedQty:      posSuggestions.get(r.menuItemId) ?? null,
    };
  });

  // Compute mix percentages
  for (const e of entries) {
    e.forecastPct = totalForecastQty > 0 && e.forecastQty != null
      ? (e.forecastQty / totalForecastQty) * 100
      : null;
  }

  const hasAnyForecast = entriesWithForecast > 0;
  const projRevenue   = revenueComplete && hasAnyForecast ? sumRevenue : null;
  const projFoodCost  = foodCostComplete && hasAnyForecast ? sumFoodCost : null;
  const projFcPct     = projRevenue != null && projRevenue > 0 && projFoodCost != null
    ? (projFoodCost / projRevenue) * 100 : null;
  const projGM        = projRevenue != null && projFoodCost != null
    ? projRevenue - projFoodCost : null;
  const projGMPct     = projGM != null && projRevenue != null && projRevenue > 0
    ? (projGM / projRevenue) * 100 : null;

  return {
    menuId,
    totalForecastQty,
    entriesWithForecast,
    totalEntries: rows.length,
    projectedRevenue:        projRevenue,
    projectedFoodCost:       projFoodCost,
    projectedFoodCostPct:    projFcPct,
    projectedGrossMargin:    projGM,
    projectedGrossMarginPct: projGMPct,
    isPartialForecast:       entriesWithForecast < rows.length,
    entries,
  };
}

function emptyReport(menuId: string): ForecastReport {
  return {
    menuId,
    totalForecastQty: 0,
    entriesWithForecast: 0,
    totalEntries: 0,
    projectedRevenue:        null,
    projectedFoodCost:       null,
    projectedFoodCostPct:    null,
    projectedGrossMargin:    null,
    projectedGrossMarginPct: null,
    isPartialForecast:       false,
    entries:                 [],
  };
}

// ── Scheduler helper ─────────────────────────────────────────────────────────

/**
 * Promote every menu whose status is 'scheduled' and whose effectiveStart
 * is in the past (or now) to 'live'.  Returns the number of rows updated.
 */
export async function activateScheduledMenus(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE menus
       SET status     = 'live',
           updated_at = now()
     WHERE status          = 'scheduled'
       AND effective_start IS NOT NULL
       AND effective_start <= now()
    RETURNING id
  `);
  const rows: any[] = (result as any).rows ?? [];
  return rows.length;
}
