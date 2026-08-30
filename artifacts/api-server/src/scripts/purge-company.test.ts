import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transactionCalls: 0,
  txCalls: 0,
  rootCalls: 0,
  rolledBack: false,
  failDelete: false,
}));

function queryExecutor(isTransaction: boolean) {
  return {
    select: () => ({
      from: () => ({
        where: async () => {
          if (isTransaction) state.txCalls++;
          else state.rootCalls++;
          return [];
        },
      }),
    }),
    execute: async () => {
      if (isTransaction) state.txCalls++;
      else state.rootCalls++;
      return { rows: [{ c: 0, count: 0 }] };
    },
    delete: () => ({
      where: () => ({
        returning: async () => {
          if (isTransaction) state.txCalls++;
          else state.rootCalls++;
          if (state.failDelete) throw new Error("injected dependent delete failure");
          return [];
        },
      }),
    }),
  };
}

const transactionExecutor = queryExecutor(true);
const rootExecutor = {
  ...queryExecutor(false),
  transaction: async (callback: (tx: typeof transactionExecutor) => Promise<unknown>) => {
    state.transactionCalls++;
    try {
      return await callback(transactionExecutor);
    } catch (error) {
      state.rolledBack = true;
      throw error;
    }
  },
};

vi.mock("../db", () => ({ db: rootExecutor }));

const { purgeCompanyData } = await import("./purge-company");

describe("purgeCompanyData transaction boundary", () => {
  beforeEach(() => {
    state.transactionCalls = 0;
    state.txCalls = 0;
    state.rootCalls = 0;
    state.rolledBack = false;
    state.failDelete = false;
  });

  it("uses the transaction executor for destructive discovery and deletion", async () => {
    const stats = await purgeCompanyData("target-company");

    expect(state.transactionCalls).toBe(1);
    expect(state.txCalls).toBeGreaterThan(0);
    expect(state.rootCalls).toBe(0);
    expect(stats.map(({ tableName }) => tableName)).toEqual(
      expect.arrayContaining([
        "shelf_scan_sessions",
        "historical_session_unresolved_rows",
        "inventory_count_entries",
        "inventory_count_lines",
        "inventory_counts",
      ]),
    );
    expect(stats.findIndex(({ tableName }) => tableName === "shelf_scan_sessions"))
      .toBeLessThan(stats.findIndex(({ tableName }) => tableName === "inventory_counts"));
    expect(stats.findIndex(({ tableName }) => tableName === "historical_session_unresolved_rows"))
      .toBeLessThan(stats.findIndex(({ tableName }) => tableName === "inventory_count_lines"));
    expect(stats.findIndex(({ tableName }) => tableName === "inventory_counts"))
      .toBeLessThan(stats.findIndex(({ tableName }) => tableName === "inventory_import_batches"));
    expect(stats.findIndex(({ tableName }) => tableName === "orderly_import_review_decisions"))
      .toBeLessThan(stats.findIndex(({ tableName }) => tableName === "inventory_import_rows"));
    expect(stats.findIndex(({ tableName }) => tableName === "inventory_import_rows"))
      .toBeLessThan(stats.findIndex(({ tableName }) => tableName === "inventory_import_batches"));
    expect(stats.findIndex(({ tableName }) => tableName === "inventory_import_batches"))
      .toBeLessThan(stats.findIndex(({ tableName }) => tableName === "import_source_property_bindings"));
    expect(stats.findIndex(({ tableName }) => tableName === "import_source_property_bindings"))
      .toBeLessThan(stats.findIndex(({ tableName }) => tableName === "company_stores"));
  });

  it("rolls back when a dependent deletion fails", async () => {
    state.failDelete = true;

    await expect(purgeCompanyData("target-company")).rejects.toThrow(
      "injected dependent delete failure",
    );
    expect(state.rolledBack).toBe(true);
  });

  it("does not open a transaction for a dry run", async () => {
    await purgeCompanyData("target-company", true);

    expect(state.transactionCalls).toBe(0);
  });
});