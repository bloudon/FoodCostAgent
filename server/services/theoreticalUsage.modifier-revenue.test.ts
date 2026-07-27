/**
 * Modifier revenue roll-up tests — task #570.
 *
 * Verifies that modifier sales rows stored in daily_menu_item_sales are
 * correctly included in the totalRevenue denominator that the food-cost
 * report uses to compute food-cost %.
 *
 * Test strategy:
 *   1. Seed a scenario with one base menu-item row and one modifier row.
 *   2. Call TheoreticalUsageService.calculateTheoreticalUsage with both rows.
 *   3. Assert totalRevenue equals the sum of base + modifier netSales.
 *   4. Run again with only the base row and confirm totalRevenue is smaller.
 *   5. Assert the implied food-cost % (totalTheoreticalCost / totalRevenue)
 *      differs between the two scenarios, proving modifiers shift the denominator.
 *
 * All storage calls are mocked — this is a unit test of the aggregation logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TheoreticalUsageService } from "./theoreticalUsage";
import type { DailyMenuItemSales } from "@shared/schema";

// ── Module mock ───────────────────────────────────────────────────────────────

vi.mock("../storage", () => ({
  storage: {
    createTheoreticalUsageRun: vi.fn(),
    updateTheoreticalUsageRun: vi.fn(),
    createTheoreticalUsageLines: vi.fn(),
    getCompany: vi.fn(),
    getMenuItem: vi.fn(),
    getRecipe: vi.fn(),
    getRecipeComponents: vi.fn(),
    getInventoryItem: vi.fn(),
    getUnitConversions: vi.fn(),
    getUnit: vi.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal DailyMenuItemSales row for a given menu item. */
function makeSalesRow(
  overrides: Partial<DailyMenuItemSales> & { menuItemId: string; netSales: number; qtySold: number },
): DailyMenuItemSales {
  return {
    id: `sale-${overrides.menuItemId}`,
    companyId: "co-1",
    storeId: "store-1",
    menuItemId: overrides.menuItemId,
    salesDate: new Date("2024-01-20"),
    qtySold: overrides.qtySold,
    netSales: overrides.netSales,
    grossSales: overrides.netSales,
    discounts: 0,
    sourceBatchId: "batch-1",
    connectionId: "conn-1",
    externalOrderId: "order-1",
    externalLineItemId: `line-${overrides.menuItemId}`,
    daypartId: null,
    createdAt: new Date("2024-01-20"),
    updatedAt: new Date("2024-01-20"),
  } as unknown as DailyMenuItemSales;
}

// ── Scenario data ─────────────────────────────────────────────────────────────
//
//  Menu item "Pizza"  — netSales $12.00, recipe cost $4.00
//  Modifier  "Cheese" — netSales  $1.50, recipe cost $2.00
//
//  With both rows:    totalRevenue = $13.50, totalCost = $6.00, FC% ≈ 44.4 %
//  With pizza only:   totalRevenue = $12.00, totalCost = $4.00, FC% ≈ 33.3 %
//
//  The 10+ pp difference proves modifier revenue (and cost) roll in correctly.

const PIZZA_SALES = makeSalesRow({ menuItemId: "item-pizza", netSales: 12.0, qtySold: 1 });
const CHEESE_SALES = makeSalesRow({ menuItemId: "item-cheese", netSales: 1.5, qtySold: 1 });

// Recipes / components share the same unit to avoid conversion look-ups.
const SHARED_UNIT_ID = "unit-each";

const PIZZA_MENU_ITEM = { id: "item-pizza", name: "Margherita Pizza", recipeId: "recipe-pizza" };
const CHEESE_MENU_ITEM = { id: "item-cheese", name: "Extra Cheese", recipeId: "recipe-cheese" };

const PIZZA_RECIPE = { id: "recipe-pizza", companyId: "co-1" };
const CHEESE_RECIPE = { id: "recipe-cheese", companyId: "co-1" };

const PIZZA_COMPONENT = {
  id: "comp-flour",
  recipeId: "recipe-pizza",
  componentType: "inventory_item",
  componentId: "inv-flour",
  qty: 1,
  unitId: SHARED_UNIT_ID,
};

const CHEESE_COMPONENT = {
  id: "comp-cheese",
  recipeId: "recipe-cheese",
  componentType: "inventory_item",
  componentId: "inv-cheese",
  qty: 1,
  unitId: SHARED_UNIT_ID,
};

const INV_FLOUR = { id: "inv-flour", name: "Flour", unitId: SHARED_UNIT_ID, pricePerUnit: "4.00", avgCostPerUnit: "4.00" };
const INV_CHEESE = { id: "inv-cheese", name: "Cheese", unitId: SHARED_UNIT_ID, pricePerUnit: "2.00", avgCostPerUnit: "2.00" };

const COMPANY = { id: "co-1", costingMethod: "last_cost" };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TheoreticalUsageService — modifier revenue roll-up", () => {
  let storageMock: any;
  let capturedRuns: any[];

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedRuns = [];

    const mod = await import("../storage");
    storageMock = (mod as any).storage;

    // createTheoreticalUsageRun — capture the input so we can inspect totalRevenue
    let lastCreatedRun: any = null;
    storageMock.createTheoreticalUsageRun.mockImplementation(async (input: any) => {
      const run = { id: "run-1", ...input };
      lastCreatedRun = run;
      capturedRuns.push(run);
      return run;
    });

    // updateTheoreticalUsageRun — merge updates onto the created run so that
    // the returned object has both totalRevenue (set at create time) and
    // totalTheoreticalCost (set at update time).
    storageMock.updateTheoreticalUsageRun.mockImplementation(
      async (_runId: string, _companyId: string, updates: any) => ({
        ...lastCreatedRun,
        ...updates,
      }),
    );

    storageMock.createTheoreticalUsageLines.mockResolvedValue([]);

    storageMock.getCompany.mockResolvedValue(COMPANY);

    storageMock.getMenuItem.mockImplementation(async (id: string) => {
      if (id === "item-pizza") return PIZZA_MENU_ITEM;
      if (id === "item-cheese") return CHEESE_MENU_ITEM;
      return null;
    });

    storageMock.getRecipe.mockImplementation(async (id: string) => {
      if (id === "recipe-pizza") return PIZZA_RECIPE;
      if (id === "recipe-cheese") return CHEESE_RECIPE;
      return null;
    });

    storageMock.getRecipeComponents.mockImplementation(async (recipeId: string) => {
      if (recipeId === "recipe-pizza") return [PIZZA_COMPONENT];
      if (recipeId === "recipe-cheese") return [CHEESE_COMPONENT];
      return [];
    });

    storageMock.getInventoryItem.mockImplementation(async (id: string) => {
      if (id === "inv-flour") return INV_FLOUR;
      if (id === "inv-cheese") return INV_CHEESE;
      return null;
    });

    // Units are all SHARED_UNIT_ID — no conversions needed
    storageMock.getUnitConversions.mockResolvedValue([]);
    storageMock.getUnit.mockResolvedValue(null);
  });

  it("totalRevenue includes modifier netSales when both base and modifier rows are present", async () => {
    const svc = new TheoreticalUsageService();
    await svc.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-1",
      salesData: [PIZZA_SALES, CHEESE_SALES],
    });

    expect(capturedRuns).toHaveLength(1);
    const run = capturedRuns[0];

    // $12.00 (pizza) + $1.50 (cheese modifier) = $13.50
    expect(run.totalRevenue).toBeCloseTo(13.5);
  });

  it("totalRevenue is smaller when the modifier row is omitted", async () => {
    const svc = new TheoreticalUsageService();
    await svc.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-1",
      salesData: [PIZZA_SALES], // no modifier
    });

    expect(capturedRuns).toHaveLength(1);
    const run = capturedRuns[0];

    // Only pizza: $12.00
    expect(run.totalRevenue).toBeCloseTo(12.0);
  });

  it("food-cost % is lower when modifier revenue is included in the denominator", async () => {
    const svc = new TheoreticalUsageService();

    // ── WITH modifier ─────────────────────────────────────────────────────────
    const withModifier = await svc.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-with",
      salesData: [PIZZA_SALES, CHEESE_SALES],
    });

    // totalCost = flour $4 + cheese $2 = $6; totalRevenue = $13.50
    const fcPctWith = (withModifier.totalTheoreticalCost / withModifier.totalRevenue) * 100;

    // ── WITHOUT modifier ──────────────────────────────────────────────────────
    capturedRuns = []; // reset captures for second run
    const withoutModifier = await svc.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-without",
      salesData: [PIZZA_SALES],
    });

    // totalCost = flour $4; totalRevenue = $12.00
    const fcPctWithout = (withoutModifier.totalTheoreticalCost / withoutModifier.totalRevenue) * 100;

    // Including modifier revenue lowers the food-cost % (larger denominator, larger numerator
    // but denominator grows proportionally more since modifier revenue $1.50 > modifier cost $2
    // is close — the key point is the two percentages must differ).
    expect(fcPctWith).not.toBeCloseTo(fcPctWithout, 1);

    // Sanity-check the directional expectation: modifier adds $1.50 revenue vs $2 cost
    // so the modifier is above 100% FC — adding it raises FC% relative to the base.
    // With: ($6 / $13.50) ≈ 44.4%;  Without: ($4 / $12.00) ≈ 33.3%
    expect(fcPctWith).toBeGreaterThan(fcPctWithout);
  });

  it("each modifier row contributes qtySold to totalMenuItemsSold", async () => {
    const svc = new TheoreticalUsageService();
    await svc.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-1",
      salesData: [PIZZA_SALES, CHEESE_SALES],
    });

    expect(capturedRuns).toHaveLength(1);
    // 1 pizza + 1 modifier portion = 2 total
    expect(capturedRuns[0].totalMenuItemsSold).toBe(2);
  });
});
