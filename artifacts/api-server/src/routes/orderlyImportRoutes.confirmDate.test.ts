/**
 * Unit tests for the inventory-date validation logic used by the
 * PATCH .../confirm-date route.
 *
 * The validator is exported as `validateInventoryDateString` from
 * orderlyImportRoutes.ts so it can be tested directly — no HTTP layer, no DB,
 * no auth mocking required.
 *
 * Two regression targets:
 *
 *   1. Year 0026 — a two-digit "26" misread as an ISO year by some date pickers
 *      arrives as "0026-MM-DD".  The year-range guard (< 2000) must reject it.
 *
 *   2. 2026-02-30 — passes the YYYY-MM-DD regex but is not a real calendar date.
 *      JavaScript overflows this to March 2 and the ISO round-trip check
 *      detects the mismatch.
 */

import { describe, it, expect } from "vitest";
import { validateInventoryDateString } from "./orderlyImportRoutes";

// ── Format validation ─────────────────────────────────────────────────────────

describe("validateInventoryDateString — format check", () => {
  it("rejects undefined (field omitted from body)", () => {
    expect(validateInventoryDateString(undefined).valid).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateInventoryDateString("").valid).toBe(false);
  });

  it("rejects MM/DD/YYYY (slash-separated)", () => {
    expect(validateInventoryDateString("07/31/2026").valid).toBe(false);
  });

  it("rejects DD-MM-YYYY (wrong field order)", () => {
    expect(validateInventoryDateString("31-07-2026").valid).toBe(false);
  });

  it("rejects a bare year", () => {
    expect(validateInventoryDateString("2026").valid).toBe(false);
  });

  it("rejects a datetime string (includes T separator)", () => {
    expect(validateInventoryDateString("2026-07-31T00:00:00Z").valid).toBe(false);
  });

  it("rejects alphabetic month names", () => {
    expect(validateInventoryDateString("2026-Jul-31").valid).toBe(false);
  });
});

// ── Year-range guard ──────────────────────────────────────────────────────────

describe("validateInventoryDateString — year range", () => {
  it("rejects year 0026 — regression: two-digit year zero-padded to ISO year", () => {
    const result = validateInventoryDateString("0026-07-31");
    expect(result.valid).toBe(false);
    // The error message must reference the allowed range so the caller can
    // surface it to the user.
    if (!result.valid) expect(result.reason).toMatch(/2000/);
  });

  it("rejects year 0001", () => {
    expect(validateInventoryDateString("0001-01-01").valid).toBe(false);
  });

  it("rejects year 1999 (one below the floor)", () => {
    expect(validateInventoryDateString("1999-12-31").valid).toBe(false);
  });

  it("accepts year 2000 (lower boundary)", () => {
    expect(validateInventoryDateString("2000-01-01").valid).toBe(true);
  });

  it("accepts year 2100 (upper boundary)", () => {
    expect(validateInventoryDateString("2100-12-31").valid).toBe(true);
  });

  it("rejects year 2101 (one above the ceiling)", () => {
    expect(validateInventoryDateString("2101-01-01").valid).toBe(false);
  });
});

// ── Non-calendar date guard ───────────────────────────────────────────────────

describe("validateInventoryDateString — non-calendar dates", () => {
  it("rejects 2026-02-30 — February never has 30 days", () => {
    // JS overflows this to 2026-03-02; the ISO round-trip detects the mismatch.
    const result = validateInventoryDateString("2026-02-30");
    expect(result.valid).toBe(false);
  });

  it("rejects 2026-02-29 — 2026 is not a leap year", () => {
    // 2026 ÷ 4 = 506.5, so no leap day; overflows to 2026-03-01.
    expect(validateInventoryDateString("2026-02-29").valid).toBe(false);
  });

  it("rejects 2026-13-01 — month 13 does not exist", () => {
    expect(validateInventoryDateString("2026-13-01").valid).toBe(false);
  });

  it("rejects 2026-00-15 — month 0 does not exist", () => {
    expect(validateInventoryDateString("2026-00-15").valid).toBe(false);
  });

  it("rejects 2026-04-31 — April has only 30 days", () => {
    expect(validateInventoryDateString("2026-04-31").valid).toBe(false);
  });

  it("rejects 2026-07-00 — day 0 does not exist", () => {
    expect(validateInventoryDateString("2026-07-00").valid).toBe(false);
  });
});

// ── Valid dates accepted ──────────────────────────────────────────────────────

describe("validateInventoryDateString — valid dates accepted", () => {
  const valid = [
    "2026-01-01",
    "2026-07-31",
    "2024-02-29", // 2024 is a leap year
    "2025-02-28",
    "2026-12-31",
    "2000-01-01",
    "2100-12-31",
    "2026-09-30",
    "2026-03-15",
    "2026-06-01",
  ];

  for (const d of valid) {
    it(`accepts ${d}`, () => {
      expect(validateInventoryDateString(d).valid).toBe(true);
    });
  }
});
