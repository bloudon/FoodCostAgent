/**
 * Shared utilities for the Orderly import wizard.
 *
 * Extracted so they can be unit-tested independently of the component.
 */

/**
 * Format a date string for display in the import wizard.
 *
 * Plain YYYY-MM-DD strings are calendar dates, not instants — the parts are
 * parsed directly with the local-date constructor so the displayed day never
 * shifts with the viewer's timezone.
 *
 * Background: `new Date("2026-07-31")` is UTC midnight, which lands on
 * 2026-07-30 in any UTC-negative timezone (US/Eastern, US/Pacific, etc.).
 * Using `new Date(year, month - 1, day)` anchors the date to local time and
 * is always July 31 regardless of offset.
 */
export function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    // Plain YYYY-MM-DD strings are calendar dates, not instants — parse the
    // parts directly so the displayed date never shifts with the viewer's
    // timezone (new Date("2026-07-31") is UTC midnight, which renders as
    // 7/30/2026 in US timezones).
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString();
    }
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}
