/**
 * SalesByItemParser
 *
 * Parses a Jonas Encore "Sales by Item" Excel report.
 *
 * Report layout (zero-indexed rows):
 *   Row  8: start date value (col 10)
 *   Row  9: "Start Date :" label
 *   Row 12: ["End Date :", <date>] (date at col 11)
 *   Row 20: ["Sales Areas :", <comma-separated outlet list>]
 *   Row 28: column header row
 *   Row 29+: data rows
 *     - Section header: single non-empty value in col 2 (no numeric cols)
 *     - Item row:       col 2 = QAC, col 12 = description, col 14 = qty,
 *                       col 15 = gross, col 18 = discount, col 20 = net
 *     - Totals row:     description contains "Totals :" — skip
 */

import * as XLSX from 'xlsx';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SalesByItemRow {
  /** Quick Access Code, e.g. "FF-BW BRKF-0062" */
  code: string;
  /** Display name of the menu item */
  description: string;
  /** Section / category name, e.g. "FF-BW Favorites" */
  category: string;
  /** Derived outlet name, e.g. "Bay Window" */
  outlet: string;
  qty: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  reportStart: string; // "YYYY-MM-DD"
  reportEnd: string;   // "YYYY-MM-DD"
}

export interface SalesByItemParseResult {
  reportStart: string;
  reportEnd: string;
  /** Outlet names extracted from the report header row 20 */
  salesAreas: string[];
  rows: SalesByItemRow[];
  /** Unique outlet names derived from QAC prefix (may differ from salesAreas) */
  outletCounts: Record<string, number>;
  /** Unique category/section names */
  categoryCounts: Record<string, number>;
  totalQty: number;
  totalNet: number;
  /**
   * Category strings whose QAC prefix was not recognised by inferOutlet().
   * Rows in these categories are placed into the "Unassigned" outlet so they
   * are visibly separate from known outlets rather than silently folded into
   * "Bay Window".  A non-empty list is a signal to the operator that the
   * prefix table needs updating.
   */
  unrecognizedPrefixCategories: string[];
}

// ─── Date parsing ──────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** Convert "Jun 01, 2026" → "2026-06-01". Returns null on parse failure. */
function parseReportDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // "Jun 01, 2026"
  const m = trimmed.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) return null;
  const [, mon, day, year] = m;
  const mm = MONTH_MAP[mon];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, '0')}`;
}

// ─── Outlet inference ──────────────────────────────────────────────────────────

/**
 * Infer the outlet name from a category / section header string.
 * Rules ordered from most specific to least specific.
 */
export function inferOutlet(category: string): string {
  const c = category.trim().toUpperCase();
  if (c.startsWith('APS') || c.startsWith('API')) return 'API';
  if (c.startsWith('BQT') || c.startsWith('BTQ')) return 'Banquet';
  if (c.startsWith('EV-')) return 'Member Events';
  if (c.startsWith('FF-AR')) return "Arnie's";
  if (c.startsWith('FF-BW') || c.startsWith('BW ') || c === 'BW BREAKFAST'
      || c === 'BW LUNCH' || c === 'BW LUNCH ADD ONS') return 'Bay Window';
  if (c.startsWith('FF-GR')) return 'Grill';
  if (c.startsWith('FF-ML') || c.startsWith('FF-MLR')) return "Men's Locker Room";
  if (c.startsWith('FF-HWH') || c.startsWith('BC/HWH') || c.startsWith('FB-HWH')) return 'Halfway House';
  if (c.startsWith('FF-SPLASH') || c.startsWith('FF-SPLASH ')) return 'Spa Cafe';
  if (c.startsWith('FF-$ ') || c.startsWith('FF-$$') || c.startsWith('FF-BREAKFAST')
      || c.startsWith('FF-DESSERTS') || c.startsWith('FF-KIDS') || c.startsWith('FF- KIDS')
      || c.startsWith('FF-OPEN')) return 'Bay Window';
  if (c.startsWith('FL-')) return 'Member Lounge';
  if (c.startsWith('FW-')) return 'Member Lounge';
  if (c.startsWith('FB-')) return 'Beverage Cart';
  if (c.startsWith('SPECIALTY')) return 'Member Lounge';
  // Unknown prefix — caller tracks this so the operator is warned.
  return 'Unassigned';
}

// ─── Main parser ───────────────────────────────────────────────────────────────

export function parseSalesByItemWorkbook(
  buffer: Buffer,
  _filename: string,
): SalesByItemParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('No sheets found in workbook');

  const ws = wb.Sheets[sheetName];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const get = (row: unknown[] | undefined, col: number): string =>
    row ? String(row[col] ?? '').trim() : '';

  // ── Dates ────────────────────────────────────────────────────────────────────
  // Row 8 (idx): start date value is in col 10
  // Row 12: end date value is in col 11
  const rawStart = get(raw[8], 10);
  const rawEnd   = get(raw[12], 11);
  const reportStart = parseReportDate(rawStart) ?? rawStart;
  const reportEnd   = parseReportDate(rawEnd)   ?? rawEnd;

  // ── Sales areas ───────────────────────────────────────────────────────────────
  // Row 20, col 11: "Selected (API, Banquet, …)"
  const salesAreaRaw = get(raw[20], 11);
  const salesAreas: string[] = [];
  const areaMatch = salesAreaRaw.match(/Selected\s*\(([^)]+)\)/i);
  if (areaMatch) {
    salesAreas.push(...areaMatch[1].split(',').map(s => s.trim()).filter(Boolean));
  }

  // ── Data rows ─────────────────────────────────────────────────────────────────
  // Header is row 28 (idx). Data starts at row 29.
  const rows: SalesByItemRow[] = [];
  const outletCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const unrecognizedPrefixCategories: string[] = [];
  let currentCategory = '';
  let currentOutlet = '';
  let totalQty = 0;
  let totalNet = 0;

  for (let i = 29; i < raw.length; i++) {
    const row = raw[i];
    if (!row) continue;

    const nonEmpty = (row as unknown[])
      .map((v, idx) => ({ v: String(v ?? '').trim(), idx }))
      .filter(x => x.v !== '');

    if (nonEmpty.length === 0) continue;

    // Totals row — skip (description field contains "Totals :")
    if (nonEmpty.some(x => x.v.endsWith('Totals :') || x.v === 'Totals:')) continue;

    // Section header — single non-empty value at col ≤ 2
    if (nonEmpty.length === 1 && nonEmpty[0].idx <= 2) {
      currentCategory = nonEmpty[0].v;
      currentOutlet = inferOutlet(currentCategory);
      if (currentOutlet === 'Unassigned' && !unrecognizedPrefixCategories.includes(currentCategory)) {
        unrecognizedPrefixCategories.push(currentCategory);
      }
      categoryCounts[currentCategory] = categoryCounts[currentCategory] ?? 0;
      continue;
    }

    // Item row — QAC at col 2, description at col 12, numbers follow
    const qacEntry = nonEmpty.find(x => x.idx === 2);
    const descEntry = nonEmpty.find(x => x.idx >= 5 && x.idx <= 13);
    const qtyEntry  = nonEmpty.find(x => x.idx >= 13 && x.idx <= 16 && !isNaN(Number(x.v)));

    if (!qacEntry || !descEntry) continue;
    // Skip if no numeric qty (might be a label row)
    if (!qtyEntry) continue;

    const code = qacEntry.v;
    const description = descEntry.v;

    // qty at idx 14, gross at 15, discount at 18, net at 20
    const qty          = Number(get(row as unknown[], 14)) || 0;
    const grossAmount  = Number(get(row as unknown[], 15)) || 0;
    const discountAmount = Number(get(row as unknown[], 18)) || 0;
    const netAmount    = Number(get(row as unknown[], 20)) || 0;

    if (!code || !description || qty === 0) continue;

    rows.push({
      code,
      description,
      category: currentCategory,
      outlet: currentOutlet,
      qty,
      grossAmount,
      discountAmount,
      netAmount,
      reportStart,
      reportEnd,
    });

    outletCounts[currentOutlet] = (outletCounts[currentOutlet] ?? 0) + 1;
    categoryCounts[currentCategory] = (categoryCounts[currentCategory] ?? 0) + 1;
    totalQty += qty;
    totalNet += netAmount;
  }

  return {
    reportStart,
    reportEnd,
    salesAreas,
    rows,
    outletCounts,
    categoryCounts,
    totalQty,
    totalNet,
    unrecognizedPrefixCategories,
  };
}
