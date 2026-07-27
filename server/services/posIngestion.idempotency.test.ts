/**
 * POS ingestion idempotency tests — task #543.
 *
 * Verifies that:
 *   1. Running ingestSalesBatch twice with the same input does NOT double rows.
 *   2. A refund (negative-qty) line is stored as-is and reduces net usage.
 *   3. A custom-dollar refund (no variationId) is skipped and counted in rowsSkipped.
 *
 * vi.mock factories are hoisted, so no top-level const refs inside them.
 * State is held in a plain Map that both the factory and tests share.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ingestSalesBatch } from "./posIngestion";
import type { PosSalesBatch } from "../integrations/pos/types";

// ── Shared state (not referenced inside vi.mock factory) ──────────────────────

// Simulated DB: key → row, mirrors ON CONFLICT DO UPDATE behaviour
const rowStore = new Map<string, any>();

// ── Module mocks (factories must be self-contained — no outer const refs) ────

vi.mock("../storage", () => ({
  storage: {
    getPosLocationMappings: vi.fn(),
    getPosItemMappings: vi.fn(),
    createSalesUploadBatch: vi.fn(),
    updateSalesUploadBatchStatus: vi.fn(),
    upsertPosDailyMenuItemSales: vi.fn(),
  },
}));

vi.mock("./theoreticalUsage", () => {
  // Use a stable class (not vi.fn as constructor) so clearAllMocks doesn't break new TUS()
  class MockTheoreticalUsageService {
    calculateTheoreticalUsage = vi.fn().mockResolvedValue(undefined);
  }
  return { TheoreticalUsageService: MockTheoreticalUsageService };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const opts = {
  companyId: "co-1",
  connectionId: "conn-1",
  connectedByUserId: "user-1",
};

const LOCATION_MAPPINGS = [{ externalLocationId: "loc-1", storeId: "store-1" }];
const ITEM_MAPPINGS = [
  { externalVariationId: "var-pizza", menuItemId: "item-pizza" },
  { externalVariationId: "var-drink", menuItemId: "item-drink" },
];

function makeUpsertImpl(store: Map<string, any>) {
  return async (rows: any[]) => {
    for (const row of rows) {
      const key = `${row.connectionId}|${row.externalOrderId}|${row.externalLineItemId}`;
      store.set(key, { ...row });
    }
    return rows;
  };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const saleBatch: PosSalesBatch = {
  locationId: "loc-1",
  businessDate: "2024-01-15",
  lines: [
    {
      provider: "square",
      externalLocationId: "loc-1",
      externalOrderId: "order-abc",
      externalLineId: "line-1",
      businessDate: "2024-01-15",
      closedAt: "2024-01-15T22:00:00Z",
      externalVariationId: "var-pizza",
      itemName: "Margherita Pizza",
      quantity: 2,
      grossSalesMoney: 2400,
      discountsMoney: 0,
      netSalesMoney: 2400,
      rawPayloadReference: "{}",
    },
    {
      provider: "square",
      externalLocationId: "loc-1",
      externalOrderId: "order-abc",
      externalLineId: "line-2",
      businessDate: "2024-01-15",
      closedAt: "2024-01-15T22:00:00Z",
      externalVariationId: "var-drink",
      itemName: "Soda",
      quantity: 1,
      grossSalesMoney: 300,
      discountsMoney: 0,
      netSalesMoney: 300,
      rawPayloadReference: "{}",
    },
  ],
};

/** Same base lines as saleBatch + an itemized refund + a custom-dollar refund */
const refundBatch: PosSalesBatch = {
  locationId: "loc-1",
  businessDate: "2024-01-15",
  lines: [
    // Original lines (re-ingested — same keys → upsert)
    {
      provider: "square",
      externalLocationId: "loc-1",
      externalOrderId: "order-abc",
      externalLineId: "line-1",
      businessDate: "2024-01-15",
      closedAt: "2024-01-15T22:00:00Z",
      externalVariationId: "var-pizza",
      itemName: "Margherita Pizza",
      quantity: 2,
      grossSalesMoney: 2400,
      discountsMoney: 0,
      netSalesMoney: 2400,
      rawPayloadReference: "{}",
    },
    {
      provider: "square",
      externalLocationId: "loc-1",
      externalOrderId: "order-abc",
      externalLineId: "line-2",
      businessDate: "2024-01-15",
      closedAt: "2024-01-15T22:00:00Z",
      externalVariationId: "var-drink",
      itemName: "Soda",
      quantity: 1,
      grossSalesMoney: 300,
      discountsMoney: 0,
      netSalesMoney: 300,
      rawPayloadReference: "{}",
    },
    // Itemized refund — reverses one pizza (has variationId → maps to menu item)
    {
      provider: "square",
      externalLocationId: "loc-1",
      externalOrderId: "order-abc",
      externalLineId: "return-line-1",
      businessDate: "2024-01-15",
      closedAt: "2024-01-15T22:00:00Z",
      externalVariationId: "var-pizza",
      itemName: "Margherita Pizza",
      quantity: -1,
      grossSalesMoney: -1200,
      discountsMoney: 0,
      netSalesMoney: -1200,
      rawPayloadReference: "{}",
    },
    // Custom-dollar refund — no variationId → must be skipped
    {
      provider: "square",
      externalLocationId: "loc-1",
      externalOrderId: "order-abc",
      externalLineId: "return-custom-1",
      businessDate: "2024-01-15",
      closedAt: "2024-01-15T22:00:00Z",
      externalVariationId: undefined,
      itemName: "Custom Refund",
      quantity: -1,
      grossSalesMoney: -500,
      discountsMoney: 0,
      netSalesMoney: -500,
      rawPayloadReference: "{}",
    },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

/** A batch with three orders all selling the same pizza — would collide on the old
 *  uniqueSaleAggregate constraint (same menuItemId, same sourceBatchId).  After the
 *  fix (constraint is partial: WHERE connection_id IS NULL), each per-line row has a
 *  unique (connectionId, orderId, lineId) key and all three rows must insert cleanly. */
const multiLineSamePizzaBatch: PosSalesBatch = {
  locationId: "loc-1",
  businessDate: "2024-01-15",
  lines: [
    {
      provider: "square",
      externalLocationId: "loc-1",
      externalOrderId: "order-1",
      externalLineId: "line-a",
      businessDate: "2024-01-15",
      closedAt: "2024-01-15T20:00:00Z",
      externalVariationId: "var-pizza",
      itemName: "Margherita Pizza",
      quantity: 1,
      grossSalesMoney: 1200,
      discountsMoney: 0,
      netSalesMoney: 1200,
      rawPayloadReference: "{}",
    },
    {
      provider: "square",
      externalLocationId: "loc-1",
      externalOrderId: "order-2",
      externalLineId: "line-b",
      businessDate: "2024-01-15",
      closedAt: "2024-01-15T21:00:00Z",
      externalVariationId: "var-pizza",
      itemName: "Margherita Pizza",
      quantity: 2,
      grossSalesMoney: 2400,
      discountsMoney: 0,
      netSalesMoney: 2400,
      rawPayloadReference: "{}",
    },
    {
      provider: "square",
      externalLocationId: "loc-1",
      externalOrderId: "order-3",
      externalLineId: "line-c",
      businessDate: "2024-01-15",
      closedAt: "2024-01-15T22:00:00Z",
      externalVariationId: "var-pizza",
      itemName: "Margherita Pizza",
      quantity: 1,
      grossSalesMoney: 1200,
      discountsMoney: 0,
      netSalesMoney: 1200,
      rawPayloadReference: "{}",
    },
  ],
};

describe("POS ingestion — idempotency", () => {
  let storageMock: any;

  beforeEach(async () => {
    rowStore.clear();
    vi.clearAllMocks();

    const mod = await import("../storage");
    storageMock = (mod as any).storage;

    storageMock.getPosLocationMappings.mockResolvedValue(LOCATION_MAPPINGS);
    storageMock.getPosItemMappings.mockResolvedValue(ITEM_MAPPINGS);
    storageMock.createSalesUploadBatch.mockResolvedValue({ id: "batch-x" });
    storageMock.updateSalesUploadBatchStatus.mockResolvedValue(undefined);
    storageMock.upsertPosDailyMenuItemSales.mockImplementation(makeUpsertImpl(rowStore));
  });

  it("running the same batch twice does not double the row count", async () => {
    const r1 = await ingestSalesBatch(saleBatch, opts);
    const r2 = await ingestSalesBatch(saleBatch, opts);

    expect(r1.rowsIngested).toBe(2);
    expect(r2.rowsIngested).toBe(2);

    // Simulated upsert store should have exactly 2 unique rows, not 4
    expect(rowStore.size).toBe(2);
  });

  it("each row carries connectionId, externalOrderId and externalLineItemId", async () => {
    await ingestSalesBatch(saleBatch, opts);

    for (const row of rowStore.values()) {
      expect(row.connectionId).toBe("conn-1");
      expect(row.externalOrderId).toBe("order-abc");
      expect(row.externalLineItemId).toMatch(/^line-/);
    }
  });

  it("itemized refund produces a negative-qty row; custom-dollar refund is skipped", async () => {
    await ingestSalesBatch(saleBatch, opts);           // 2 rows
    const r2 = await ingestSalesBatch(refundBatch, opts); // 2 upserts + 1 refund insert + 1 skipped

    // Custom-dollar refund counted in rowsSkipped
    expect(r2.rowsSkipped).toBe(1);

    // Total unique keys: line-1, line-2, return-line-1 = 3
    expect(rowStore.size).toBe(3);

    const refundRow = rowStore.get("conn-1|order-abc|return-line-1");
    expect(refundRow).toBeDefined();
    expect(refundRow!.qtySold).toBe(-1);
    expect(refundRow!.netSales).toBeCloseTo(-12); // -1200 cents → -12 dollars
  });

  it("net qty for pizza after sale + refund equals 1 (2 sold minus 1 refunded)", async () => {
    await ingestSalesBatch(saleBatch, opts);
    await ingestSalesBatch(refundBatch, opts);

    const pizzaRows = [...rowStore.values()].filter((r) => r.menuItemId === "item-pizza");
    const netQty = pizzaRows.reduce((s: number, r: any) => s + r.qtySold, 0);
    expect(netQty).toBe(1); // 2 + (-1)
  });

  it("multiple orders selling the same menu item in one batch insert separate per-line rows without colliding", async () => {
    // This is the regression guard for the uniqueSaleAggregate constraint bug:
    // before the fix, three orders all selling var-pizza within one batch would
    // share (companyId, storeId, menuItemId, salesDate, daypartId, sourceBatchId)
    // and collide on the old full unique constraint.  After the fix the constraint
    // is partial (WHERE connection_id IS NULL) so per-line POS rows are free.
    const result = await ingestSalesBatch(multiLineSamePizzaBatch, opts);

    // All three lines must be ingested — no constraint collision
    expect(result.rowsIngested).toBe(3);
    expect(result.rowsSkipped).toBe(0);
    expect(rowStore.size).toBe(3);

    // Each row has its own unique POS identity
    expect(rowStore.has("conn-1|order-1|line-a")).toBe(true);
    expect(rowStore.has("conn-1|order-2|line-b")).toBe(true);
    expect(rowStore.has("conn-1|order-3|line-c")).toBe(true);

    // Total pizza qty across the three rows = 1 + 2 + 1 = 4
    const netQty = [...rowStore.values()].reduce((s: number, r: any) => s + r.qtySold, 0);
    expect(netQty).toBe(4);
  });

  it("re-ingesting a multi-order batch still does not double rows", async () => {
    await ingestSalesBatch(multiLineSamePizzaBatch, opts);
    expect(rowStore.size).toBe(3);

    await ingestSalesBatch(multiLineSamePizzaBatch, opts);
    // Second run upserts (overwrites) — still exactly 3 rows
    expect(rowStore.size).toBe(3);
  });
});
