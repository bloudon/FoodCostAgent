import { db } from "../db";
import { storage } from "../storage";
import { dailyMenuItemSales, menuItemPrepUsages, prepOnHand, dayparts } from "@shared/schema";
import { eq, and, gte, lte, isNull, gt } from "drizzle-orm";
import type { InsertPrepChartRun, InsertPrepChartLine, PrepChartRun, PrepChartLine } from "@shared/schema";

export interface GenerateChartOptions {
  companyId: string;
  storeId: string;
  businessDate: Date;
  daypartId?: string;
  bufferPercent?: number;
  weeksLookback?: number;
}

export interface PrepChartResult {
  run: PrepChartRun;
  lines: PrepChartLine[];
}

export async function generatePrepChart(opts: GenerateChartOptions): Promise<PrepChartResult> {
  const {
    companyId,
    storeId,
    businessDate,
    daypartId,
    bufferPercent = 10,
    weeksLookback = 4,
  } = opts;

  const targetDow = businessDate.getDay(); // 0 = Sunday ... 6 = Saturday

  // ------------------------------------------------------------------
  // 1. Gather historical sales for same day-of-week over past N weeks
  // ------------------------------------------------------------------
  const lookbackStart = new Date(businessDate);
  lookbackStart.setDate(lookbackStart.getDate() - weeksLookback * 7);

  const salesRows = await db
    .select({
      menuItemId: dailyMenuItemSales.menuItemId,
      daypartId: dailyMenuItemSales.daypartId,
      qtySold: dailyMenuItemSales.qtySold,
      salesDate: dailyMenuItemSales.salesDate,
    })
    .from(dailyMenuItemSales)
    .where(
      and(
        eq(dailyMenuItemSales.companyId, companyId),
        eq(dailyMenuItemSales.storeId, storeId),
        gte(dailyMenuItemSales.salesDate, lookbackStart),
        lte(dailyMenuItemSales.salesDate, businessDate),
        daypartId ? eq(dailyMenuItemSales.daypartId, daypartId) : isNull(dailyMenuItemSales.daypartId),
      )
    );

  // Filter to same day-of-week and aggregate avg qty per menu item
  const menuItemQtyMap: Map<string, { total: number; weeks: number }> = new Map();
  for (const row of salesRows) {
    if (row.salesDate.getDay() !== targetDow) continue;
    const existing = menuItemQtyMap.get(row.menuItemId) ?? { total: 0, weeks: 0 };
    existing.total += row.qtySold;
    existing.weeks += 1;
    menuItemQtyMap.set(row.menuItemId, existing);
  }

  const avgQtyByMenuItemId: Map<string, number> = new Map();
  for (const [menuItemId, { total, weeks }] of menuItemQtyMap.entries()) {
    avgQtyByMenuItemId.set(menuItemId, weeks > 0 ? total / weeks : 0);
  }

  // ------------------------------------------------------------------
  // 2. Load all menu_item_prep_usages for this company
  // ------------------------------------------------------------------
  const usageRows = await db
    .select()
    .from(menuItemPrepUsages)
    .where(eq(menuItemPrepUsages.companyId, companyId));

  // Build: prepItemId -> { forecastQty, drivingItems: string[] }
  const prepForecastMap: Map<string, { qty: number; drivingItems: string[] }> = new Map();
  for (const usage of usageRows) {
    const avgSold = avgQtyByMenuItemId.get(usage.menuItemId) ?? 0;
    if (avgSold === 0) continue;
    const contrib = avgSold * usage.quantityPerSale;
    const existing = prepForecastMap.get(usage.prepItemId) ?? { qty: 0, drivingItems: [] };
    existing.qty += contrib;
    existing.drivingItems.push(usage.menuItemId);
    prepForecastMap.set(usage.prepItemId, existing);
  }

  // ------------------------------------------------------------------
  // 3. Load all prep items for this company
  // ------------------------------------------------------------------
  const allPrepItems = await storage.getPrepItems(companyId);
  const activePrepItems = allPrepItems.filter(p => p.active === 1);

  // Collect all prep item IDs that appear in forecast OR are active
  const relevantPrepItemIds = new Set<string>([
    ...prepForecastMap.keys(),
    ...activePrepItems.map(p => p.id),
  ]);

  // ------------------------------------------------------------------
  // 4. Load on-hand for each relevant prep item
  // ------------------------------------------------------------------
  const onHandRows = await db
    .select({
      prepItemId: prepOnHand.prepItemId,
      quantityOnHand: prepOnHand.quantityOnHand,
      expiresAt: prepOnHand.expiresAt,
    })
    .from(prepOnHand)
    .where(
      and(
        eq(prepOnHand.companyId, companyId),
        eq(prepOnHand.storeId, storeId),
        gt(prepOnHand.expiresAt, new Date()),
      )
    );

  const onHandMap: Map<string, number> = new Map();
  for (const row of onHandRows) {
    const current = onHandMap.get(row.prepItemId) ?? 0;
    onHandMap.set(row.prepItemId, current + row.quantityOnHand);
  }

  // ------------------------------------------------------------------
  // 5. Load daypart info for due_time calculation
  // ------------------------------------------------------------------
  let daypartStartTime: string | null = null;
  if (daypartId) {
    const [dp] = await db.select().from(dayparts).where(
      and(eq(dayparts.id, daypartId), eq(dayparts.companyId, companyId))
    );
    if (dp?.startTime) daypartStartTime = dp.startTime;
  }

  // ------------------------------------------------------------------
  // 6. Build chart run and persist
  // ------------------------------------------------------------------
  const runData: InsertPrepChartRun = {
    companyId,
    storeId,
    businessDate,
    daypartId: daypartId ?? null,
    basedOnMode: "history",
    bufferPercent,
    weeksLookback,
  };
  const run = await storage.createPrepChartRun(runData);

  // ------------------------------------------------------------------
  // 7. Calculate recommendations for each active prep item
  // ------------------------------------------------------------------
  const lines: InsertPrepChartLine[] = [];

  for (const prepItem of activePrepItems) {
    const forecast = prepForecastMap.get(prepItem.id);
    const forecastQty = forecast?.qty ?? 0;
    const onHandQty = onHandMap.get(prepItem.id) ?? 0;

    const buffer = forecastQty * (bufferPercent / 100);
    const netNeeded = Math.max(0, forecastQty - onHandQty + buffer);
    const batchQty = prepItem.outputQtyPerBatch > 0 ? prepItem.outputQtyPerBatch : 1;
    const recommendedBatches = Math.ceil(netNeeded / batchQty);
    const recommendedQty = recommendedBatches * batchQty;

    // Due time: daypart start minus prep lead minutes
    let dueTime: Date | null = null;
    if (daypartStartTime && prepItem.prepLeadMinutes > 0) {
      const [hStr, mStr] = daypartStartTime.split(":");
      const h = parseInt(hStr, 10);
      const m = parseInt(mStr, 10);
      const daypartMs = (h * 60 + m) * 60 * 1000;
      const leadMs = prepItem.prepLeadMinutes * 60 * 1000;
      const dueMs = daypartMs - leadMs;
      if (dueMs >= 0) {
        dueTime = new Date(businessDate);
        dueTime.setHours(0, 0, 0, 0);
        dueTime = new Date(dueTime.getTime() + dueMs);
      }
    }

    // Reasoning summary
    const drivingItems = forecast?.drivingItems ?? [];
    let reasoningSummary: string;
    if (forecastQty === 0) {
      reasoningSummary = `No historical sales data for ${weeksLookback}-wk lookback — on hand: ${onHandQty.toFixed(1)} ${prepItem.outputUnit}`;
    } else {
      const bufferStr = bufferPercent > 0 ? ` + ${bufferPercent}% buffer` : "";
      const drivingCount = new Set(drivingItems).size;
      reasoningSummary =
        `${weeksLookback}-wk avg: ${forecastQty.toFixed(1)} ${prepItem.outputUnit} forecast (${drivingCount} menu item${drivingCount !== 1 ? "s" : ""})` +
        `${bufferStr} · on hand: ${onHandQty.toFixed(1)} · net: ${netNeeded.toFixed(1)} → ${recommendedBatches} batch${recommendedBatches !== 1 ? "es" : ""}`;
    }

    // Confidence: based on how many weeks of data we have
    const dataWeeks = drivingItems.length > 0 ? Math.min(weeksLookback, Math.max(1, salesRows.filter(r => drivingItems.includes(r.menuItemId)).length)) : 0;
    const confidenceScore = dataWeeks > 0 ? Math.min(1, dataWeeks / weeksLookback) : 0;

    lines.push({
      prepChartRunId: run.id,
      companyId,
      prepItemId: prepItem.id,
      stationId: prepItem.stationId ?? null,
      forecastQty,
      onHandQty,
      recommendedQty,
      recommendedBatches,
      dueTime,
      confidenceScore,
      reasoningSummary,
    });
  }

  const savedLines = await storage.createPrepChartLines(lines);
  return { run, lines: savedLines };
}
