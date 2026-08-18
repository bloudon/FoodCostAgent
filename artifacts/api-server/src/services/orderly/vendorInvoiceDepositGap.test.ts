/**
 * Unit tests for deposit-aware gap classification (PM guardrails, Task #1183).
 *
 * The classifier is intentionally narrow: explained_deposit_flow requires
 * (1) a configured rate, (2) effective on the invoice business date,
 * (3) exactly one effective rate, (4) gap is an exact signed integer
 * multiple. Everything else fails closed to a normal reconciliation warning.
 */
import { describe, it, expect } from "vitest";
import { classifyDepositGap, type DepositRateWindow } from "./vendorInvoiceImport";

const RATE_50: DepositRateWindow = { ratePerKeg: 50, effectiveFrom: "2025-01-01", effectiveTo: null };

describe("classifyDepositGap", () => {
  it("explains an exact positive multiple (kegs charged out)", () => {
    expect(classifyDepositGap(150, "2025-10-29", [RATE_50])).toEqual({
      ratePerKeg: 50,
      signedAmount: 150,
      kegCount: 3,
    });
  });

  it("explains an exact negative multiple (kegs returned/credited)", () => {
    expect(classifyDepositGap(-200, "2025-09-10", [RATE_50])).toEqual({
      ratePerKeg: 50,
      signedAmount: -200,
      kegCount: -4,
    });
  });

  it("NEGATIVE CONTROL (PM-required): $55 gap with a $50 rate stays a warning", () => {
    expect(classifyDepositGap(55, "2025-10-29", [RATE_50])).toBeNull();
  });

  it("fails closed with no configured rate", () => {
    expect(classifyDepositGap(50, "2025-10-29", [])).toBeNull();
  });

  it("fails closed when the rate is not effective on the invoice date", () => {
    const rate: DepositRateWindow = { ratePerKeg: 50, effectiveFrom: "2026-01-01", effectiveTo: null };
    expect(classifyDepositGap(50, "2025-10-29", [rate])).toBeNull();
    const ended: DepositRateWindow = { ratePerKeg: 50, effectiveFrom: "2024-01-01", effectiveTo: "2024-12-31" };
    expect(classifyDepositGap(50, "2025-10-29", [ended])).toBeNull();
  });

  it("fails closed on overlapping/ambiguous effective rates", () => {
    const other: DepositRateWindow = { ratePerKeg: 30, effectiveFrom: "2025-06-01", effectiveTo: null };
    // 150 is a multiple of BOTH 50 and 30 — must not guess.
    expect(classifyDepositGap(150, "2025-10-29", [RATE_50, other])).toBeNull();
  });

  it("respects effective dating boundaries inclusively", () => {
    const windowed: DepositRateWindow = { ratePerKeg: 50, effectiveFrom: "2025-09-10", effectiveTo: "2025-09-10" };
    expect(classifyDepositGap(50, "2025-09-10", [windowed])).not.toBeNull();
    expect(classifyDepositGap(50, "2025-09-11", [windowed])).toBeNull();
  });

  it("a rate change does not reinterpret old invoices", () => {
    const old: DepositRateWindow = { ratePerKeg: 50, effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" };
    const next: DepositRateWindow = { ratePerKeg: 60, effectiveFrom: "2026-01-01", effectiveTo: null };
    expect(classifyDepositGap(100, "2025-10-29", [old, next])).toEqual({ ratePerKeg: 50, signedAmount: 100, kegCount: 2 });
    expect(classifyDepositGap(120, "2026-02-01", [old, next])).toEqual({ ratePerKeg: 60, signedAmount: 120, kegCount: 2 });
    // $100 in 2026 is NOT a multiple of the effective $60 rate.
    expect(classifyDepositGap(100, "2026-02-01", [old, next])).toBeNull();
  });

  it("never explains a zero gap and never divides by an invalid rate", () => {
    expect(classifyDepositGap(0, "2025-10-29", [RATE_50])).toBeNull();
    expect(classifyDepositGap(50, "2025-10-29", [{ ratePerKeg: 0, effectiveFrom: "2025-01-01", effectiveTo: null }])).toBeNull();
  });

  it("uses integer-cent arithmetic (float noise cannot fake a multiple)", () => {
    expect(classifyDepositGap(49.999999999, "2025-10-29", [RATE_50])).not.toBeNull(); // rounds to 5000 cents
    expect(classifyDepositGap(50.01, "2025-10-29", [RATE_50])).toBeNull();
  });
});
