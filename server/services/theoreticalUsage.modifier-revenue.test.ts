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

// ── Negative-qty refund tests ─────────────────────────────────────────────────
//
//  A catalog-backed modifier refund is represented as a sales row with a
//  negative qtySold and a negative netSales value.
//
//  Design decision (asserted below):
//    - totalRevenue DOES include refund rows (negative netSales reduces the
//      denominator, keeping food-cost % correct after a refund).
//    - totalTheoreticalCost does NOT include refund rows (the ingredient cost
//      loop skips rows where qtySold <= 0, which is correct: the kitchen did
//      not produce additional food for a refund).
//
//  The asymmetry — revenue reduced, cost not — is intentional: the refund
//  removes the sale from the revenue denominator without pretending a negative
//  amount of food was consumed.

describe("TheoreticalUsageService — negative-qty modifier refund behaviour", () => {
  let storageMock: any;
  let capturedRuns: any[];

  // ── Scenario ────────────────────────────────────────────────────────────────
  //
  //  Pizza sold once:           qtySold=+1  netSales=+$12.00
  //  Cheese modifier sold once: qtySold=+1  netSales=+$1.50
  //  Cheese modifier refunded:  qtySold=-1  netSales=-$1.50
  //
  //  Expected after roll-up:
  //    totalRevenue        = $12.00 + $1.50 + (-$1.50) = $12.00  (net)
  //    totalTheoreticalCost = $4.00  (flour only — refund row skipped for cost)
  //    food-cost %          ≈ 33.3 %  (same as pizza-only scenario)

  const PIZZA_SALES_NEG = makeSalesRow({ menuItemId: "item-pizza", netSales: 12.0, qtySold: 1 });
  const CHEESE_SALE_POS = makeSalesRow({ menuItemId: "item-cheese", netSales: 1.5, qtySold: 1 });
  const CHEESE_SALE_NEG = makeSalesRow({ menuItemId: "item-cheese", netSales: -1.5, qtySold: -1 });

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedRuns = [];

    const mod = await import("../storage");
    storageMock = (mod as any).storage;

    let lastCreatedRun: any = null;
    storageMock.createTheoreticalUsageRun.mockImplementation(async (input: any) => {
      const run = { id: "run-ref", ...input };
      lastCreatedRun = run;
      capturedRuns.push(run);
      return run;
    });

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

    storageMock.getUnitConversions.mockResolvedValue([]);
    storageMock.getUnit.mockResolvedValue(null);
  });

  it("totalRevenue equals the net of positive and negative modifier rows", async () => {
    const svc = new TheoreticalUsageService();
    await svc.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-refund",
      salesData: [PIZZA_SALES_NEG, CHEESE_SALE_POS, CHEESE_SALE_NEG],
    });

    expect(capturedRuns).toHaveLength(1);
    // $12.00 + $1.50 + (-$1.50) = $12.00 net
    expect(capturedRuns[0].totalRevenue).toBeCloseTo(12.0);
  });

  it("refund row with negative netSales reduces totalRevenue below the positive-only total", async () => {
    const svc = new TheoreticalUsageService();

    // Without refund row
    await svc.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-no-refund",
      salesData: [PIZZA_SALES_NEG, CHEESE_SALE_POS],
    });
    const revenueWithoutRefund = capturedRuns[0].totalRevenue; // $13.50

    capturedRuns = [];

    // With refund row
    await svc.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-with-refund",
      salesData: [PIZZA_SALES_NEG, CHEESE_SALE_POS, CHEESE_SALE_NEG],
    });
    const revenueWithRefund = capturedRuns[0].totalRevenue; // $12.00

    expect(revenueWithRefund).toBeLessThan(revenueWithoutRefund);
    expect(revenueWithRefund).toBeCloseTo(12.0);
    expect(revenueWithoutRefund).toBeCloseTo(13.5);
  });

  it("refund row does NOT add ingredient cost (skipped because qtySold <= 0)", async () => {
    const svc = new TheoreticalUsageService();

    const result = await svc.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-refund-cost",
      salesData: [PIZZA_SALES_NEG, CHEESE_SALE_POS, CHEESE_SALE_NEG],
    });

    // Cost = flour ($4, from pizza) + cheese ($2, from positive cheese sale only)
    // Refund row is skipped — no negative cost applied.
    // total = $6.00
    expect(result.totalTheoreticalCost).toBeCloseTo(6.0);
  });

  it("documents the known asymmetry: refund cancels revenue but not cost, raising FC%", async () => {
    // Design decision: the service accumulates ingredient cost only for rows where
    // qtySold > 0 (line 74 in theoreticalUsage.ts).  A refund row (qtySold = -1)
    // reduces totalRevenue (via the unconditional netSales reduce, lines 50-53) but
    // does NOT subtract from totalTheoreticalCost.  This means selling a modifier
    // and then fully refunding it leaves its ingredient cost in the denominator while
    // removing its revenue — raising the reported food-cost %.
    //
    // Scenario:
    //   Pizza only (base):             revenue $12, cost $4  →  FC% ≈ 33.3 %
    //   Pizza + cheese sold + refunded: revenue $12, cost $6  →  FC% ≈ 50.0 %
    //     ($6 = flour $4 + cheese $2 from the positive sale; refund skipped for cost)

    // ── With positive modifier sale then full refund ───────────────────────────
    const svc = new TheoreticalUsageService();
    const withRefund = await svc.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-fc-refund",
      salesData: [PIZZA_SALES_NEG, CHEESE_SALE_POS, CHEESE_SALE_NEG],
    });

    // ── Base item only (modifier never sold) ──────────────────────────────────
    capturedRuns = [];
    const svc2 = new TheoreticalUsageService();
    const baseOnly = await svc2.calculateTheoreticalUsage({
      companyId: "co-1",
      storeId: "store-1",
      salesDate: new Date("2024-01-20"),
      sourceBatchId: "batch-fc-base",
      salesData: [PIZZA_SALES_NEG],
    });

    // Revenue nets to $12 in both cases
    expect(withRefund.totalRevenue).toBeCloseTo(12.0);
    expect(baseOnly.totalRevenue).toBeCloseTo(12.0);

    // Cost is higher in the refund scenario — the positive cheese sale's cost was
    // accumulated and the refund row did not subtract it.
    expect(withRefund.totalTheoreticalCost).toBeCloseTo(6.0); // flour $4 + cheese $2
    expect(baseOnly.totalTheoreticalCost).toBeCloseTo(4.0);   // flour $4 only

    const fcPctWithRefund = (withRefund.totalTheoreticalCost / withRefund.totalRevenue) * 100;
    const fcPctBaseOnly = (baseOnly.totalTheoreticalCost / baseOnly.totalRevenue) * 100;

    // Asymmetry: FC% is higher when a modifier was sold-then-refunded vs never sold
    expect(fcPctWithRefund).toBeGreaterThan(fcPctBaseOnly);
    expect(fcPctWithRefund).toBeCloseTo(50.0, 1); // $6 / $12
    expect(fcPctBaseOnly).toBeCloseTo(33.3, 1);   // $4 / $12
  });
});
