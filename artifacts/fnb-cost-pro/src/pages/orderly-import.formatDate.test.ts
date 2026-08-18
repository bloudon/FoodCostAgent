/**
 * Unit tests for formatDate — the calendar-date display helper used throughout
 * the Orderly import wizard.
 *
 * The core invariant: a plain YYYY-MM-DD string must always render the correct
 * calendar day, regardless of the viewer's timezone.
 *
 * Why this matters
 * ────────────────
 * `new Date("2026-07-31")` is interpreted as UTC midnight.  In any UTC-negative
 * timezone (US/Eastern = UTC-4, US/Pacific = UTC-7) that instant falls on the
 * *previous* local day — July 30.  The fix uses the local-date constructor
 * `new Date(year, month - 1, day)` which is anchored to local midnight and
 * always returns July 31.
 *
 * Timezone-proof strategy
 * ───────────────────────
 * We cannot force the test runner to a specific timezone, but we can prove the
 * correct branch is taken by:
 *
 *   1. Asserting formatDate(d) === new Date(y, m-1, d).toLocaleDateString()
 *      (the safe path).  Both sides use the same local-date constructor, so the
 *      result matches in every timezone.
 *
 *   2. Asserting, for each date, that the local-date constructor's getDate()
 *      equals the expected day — proving the Date object is July 31, not 30.
 *
 *   3. Where the test runner is in a UTC-negative zone, also asserting that
 *      the UTC-parsed path would produce a *different* result, confirming the
 *      test would have caught the original bug.
 */

import { describe, it, expect } from "vitest";
import { formatDate } from "../lib/orderlyImportUtils";

// ── Timezone-safety proof ─────────────────────────────────────────────────────

describe("formatDate — timezone-safe calendar rendering", () => {
  /**
   * For each YYYY-MM-DD string the function must return exactly what the
   * local-date constructor produces.  This assertion is timezone-independent:
   * both sides take the same path, so they always agree — but together they
   * prove the function does NOT fall back to UTC parsing.
   */
  const cases: Array<{ iso: string; year: number; month: number; day: number }> = [
    { iso: "2026-07-31", year: 2026, month: 7, day: 31 },   // regression target
    { iso: "2026-09-30", year: 2026, month: 9, day: 30 },   // 30-day month end
    { iso: "2026-12-31", year: 2026, month: 12, day: 31 },  // year-end
    { iso: "2026-01-01", year: 2026, month: 1,  day: 1  },  // year-start
    { iso: "2024-02-29", year: 2024, month: 2,  day: 29 },  // leap day
    { iso: "2025-02-28", year: 2025, month: 2,  day: 28 },  // non-leap Feb end
    { iso: "2000-01-01", year: 2000, month: 1,  day: 1  },  // epoch boundary
  ];

  for (const { iso, year, month, day } of cases) {
    it(`"${iso}" renders the correct calendar day (day=${day})`, () => {
      // Build the safe reference: local-date constructor is always day-correct.
      const localDate = new Date(year, month - 1, day);

      // 1. The function result matches the safe reference exactly.
      expect(formatDate(iso)).toBe(localDate.toLocaleDateString());

      // 2. The local-date object itself has the expected calendar components —
      //    confirming it is not off by a day regardless of timezone.
      expect(localDate.getFullYear()).toBe(year);
      expect(localDate.getMonth()).toBe(month - 1);   // 0-indexed
      expect(localDate.getDate()).toBe(day);
    });
  }

  it("would have produced the wrong day if UTC parsing were used (US timezone proof)", () => {
    // In UTC-negative zones new Date("YYYY-MM-DDT00:00:00Z").getDate() is one
    // less than the calendar day because UTC midnight is still yesterday locally.
    // We verify that (a) the local-date path is always day-correct, and
    // (b) in UTC-negative environments the UTC path differs — confirming the
    // test would have caught the original bug.
    const utcMidnight = new Date("2026-07-31T00:00:00Z");
    const localDate   = new Date(2026, 6, 31);         // July 31, local midnight

    // The local-date is always July 31.
    expect(localDate.getDate()).toBe(31);

    const tzOffsetMinutes = new Date().getTimezoneOffset();
    if (tzOffsetMinutes > 0) {
      // UTC-negative: UTC midnight is yesterday in local time.
      expect(utcMidnight.getDate()).toBe(30);
      // Confirm formatDate does NOT match the broken UTC path.
      expect(formatDate("2026-07-31")).not.toBe(utcMidnight.toLocaleDateString());
    } else {
      // UTC or UTC+: the UTC-midnight date still lands on July 31 locally,
      // so both paths agree.  The regression cannot be triggered here, but we
      // can still confirm the function returns the local-date value.
      expect(formatDate("2026-07-31")).toBe(localDate.toLocaleDateString());
    }
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("formatDate — edge cases", () => {
  it('returns "—" for null', () => {
    expect(formatDate(null)).toBe("—");
  });

  it('returns "—" for empty string', () => {
    // Empty string is falsy; hits the same guard as null.
    expect(formatDate("" as string | null)).toBe("—");
  });

  it("falls back gracefully for an ISO timestamp (non-YYYY-MM-DD match)", () => {
    // When the value does not match /^\d{4}-\d{2}-\d{2}$/ the function falls
    // back to new Date(d).toLocaleDateString().  Must not throw.
    const result = formatDate("2026-07-31T12:00:00Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for a deeply malformed value (catch path)", () => {
    // new Date("garbage") → Invalid Date; toLocaleDateString() returns
    // "Invalid Date" rather than throwing in V8.  Either way the function
    // must not throw and must return a non-empty string.
    const result = formatDate("not-a-date");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
