/**
 * Orderly Inventory Export Parser — v1.0
 *
 * Parses the Orderly "Inventory Detail" Excel sheet into immutable staged rows.
 * Handles the 22-column Bay Hill Country Club format (and compatible exports).
 *
 * Detected column order (0-based indices):
 *  0  Location           5  Counting Unit 1    10  Count (3)         15  Previous Pack
 *  1  Item Code          6  Count (1)          11  Total Units       16  Previous UOM
 *  2  Item Description   7  Counting Unit 2    12  Par Order Target  17  Previous Cost
 *  3  Pack Size          8  Count (2)          13  Total Cost        18  Supplier
 *  4  Package Price      9  Counting Unit 3    14  Previous Case     19  Purchase Date
 *                                                                    20  Category
 *                                                                    21  GL Code
 *
 * Note: The header row contains "Count" three times (positions 6, 8, 10).
 * We use index-based access (header: 1) to avoid column-name collisions.
 */

import * as XLSX from 'xlsx';
import crypto from 'crypto';
import { parseCompoundPackSize } from '../../integrations/csv/CsvOrderGuide';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ORDERLY_PARSER_VERSION = '1.0';

/** 0-based column indices for the Orderly Inventory Detail sheet */
const COL = {
  LOCATION: 0,
  ITEM_CODE: 1,
  ITEM_DESCRIPTION: 2,
  PACK_SIZE: 3,
  PACKAGE_PRICE: 4,
  COUNTING_UNIT_1: 5,
  COUNT_1: 6,
  COUNTING_UNIT_2: 7,
  COUNT_2: 8,
  COUNTING_UNIT_3: 9,
  COUNT_3: 10,
  TOTAL_UNITS: 11,
  PAR_ORDER_TARGET: 12,
  TOTAL_COST: 13,
  PREVIOUS_CASE: 14,
  PREVIOUS_PACK: 15,
  PREVIOUS_UOM: 16,
  PREVIOUS_COST: 17,
  SUPPLIER: 18,
  PURCHASE_DATE: 19,
  CATEGORY: 20,
  GL_CODE: 21,
} as const;

/**
 * Header fingerprint — all must be present (case-insensitive) in the sheet's
 * first row to confirm this is an Orderly Inventory Detail export.
 */
const ORDERLY_HEADER_FINGERPRINT = [
  'item description',
  'pack size',
  'counting unit 1',
  'supplier',
  'gl code',
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type ItemCodeStatus = 'valid' | 'blank' | 'placeholder' | 'non_unique';
export type SupplierStatus = 'valid' | 'blank' | 'placeholder' | 'ambiguous';
export type PackParseStatus = 'ok' | 'partial' | 'unparseable';
export type CleaningMethod =
  | 'none'
  | 'supplier_suffix_strip'
  | 'dash_supplier_strip'
  | 'pack_text_strip';

export type RowStatus =
  | 'new_item_candidate'
  | 'matched_item'
  | 'new_vendor_item'
  | 'location_assignment'
  | 'ambiguous'
  | 'invalid_code'
  | 'invalid_supplier'
  | 'duplicate_source_row';

export interface OrderlyRow {
  rowIndex: number;                     // 1-based (header = 0)
  rawData: Record<string, unknown>;     // all 22 cell values, immutable
  // Description
  rawDescription: string;
  cleanedDescription: string;
  cleaningMethod: CleaningMethod;
  cleaningConfidence: number;           // 0–1
  removedSuffix: string;
  // Pack geometry (three-tier)
  caseQuantity: number | null;
  innerPackQuantity: number | null;
  baseUnitQuantity: number | null;
  caseUnit: string | null;
  innerUnit: string | null;
  baseUnit: string | null;
  packParseStatus: PackParseStatus;
  // Item code
  sourceItemCode: string;
  itemCodeStatus: ItemCodeStatus;
  // Supplier
  supplierRaw: string;
  supplierStatus: SupplierStatus;
  // Location & metadata
  storageLocation: string;
  sourceCategory: string;
  sourceGlCode: string;
  sourceParTarget: number | null;
  packagePrice: number | null;
  // Counting tiers
  countUnit1: string;
  count1: number | null;
  countUnit2: string;
  count2: number | null;
  countUnit3: string;
  count3: number | null;
  totalUnits: number | null;
  totalCost: number | null;
  // Previous period
  previousCase: number | null;
  previousPack: number | null;
  previousUom: number | null;
  previousCost: number | null;
  // Row classification
  rowStatus: RowStatus;
}

export interface InventoryDateResult {
  detectedDate: string | null;          // ISO YYYY-MM-DD or null
  detectedFrom: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface OrderlyPreviewSummary {
  sourceRows: number;
  uniqueItemCandidates: number;
  itemLocationAssignments: number;
  vendorItemRelationships: number;
  estimatedNewVendors: number;
  ambiguousRows: number;
  packParseWarnings: number;
  nonAuthoritativeCodes: number;
  invalidSuppliers: number;
  snapshotValueTotal: number;
}

export interface OrderlyParseResult {
  sheetName: string;
  sourceRowCount: number;
  rows: OrderlyRow[];
  inventoryDate: InventoryDateResult;
  snapshotTotal: number;
  summary: OrderlyPreviewSummary;
}

// ─── Pack size parsing ────────────────────────────────────────────────────────

export function parseOrderlyPackSize(packSizeStr: string): Pick<
  OrderlyRow,
  'caseQuantity' | 'innerPackQuantity' | 'baseUnitQuantity' | 'caseUnit' | 'innerUnit' | 'baseUnit' | 'packParseStatus'
> {
  const empty = {
    caseQuantity: null,
    innerPackQuantity: null,
    baseUnitQuantity: null,
    caseUnit: null,
    innerUnit: null,
    baseUnit: null,
    packParseStatus: 'unparseable' as PackParseStatus,
  };

  if (!packSizeStr || !packSizeStr.trim()) return empty;

  // Orderly commonly exports a three-tier physical pack as
  // "case/inner base-unit", e.g. "1/1 750ML" or "12/1 750ML".
  // This is complete evidence: 1 case × 1 bottle × 750 mL, not an
  // ambiguous variant or an unparseable free-text value.
  const threeTier = packSizeStr.trim().match(
    /^([\d.]+)\s*\/\s*([\d.]+)\s+([\d.]+)\s*([A-Za-z]+)$/i,
  );
  if (threeTier) {
    const caseQuantity = Number(threeTier[1]);
    const innerPackQuantity = Number(threeTier[2]);
    const baseUnitQuantity = Number(threeTier[3]);
    if (
      Number.isFinite(caseQuantity) &&
      Number.isFinite(innerPackQuantity) &&
      Number.isFinite(baseUnitQuantity)
    ) {
      return {
        caseQuantity,
        innerPackQuantity,
        baseUnitQuantity,
        caseUnit: 'Case',
        innerUnit: 'Pack',
        baseUnit: threeTier[4].toUpperCase(),
        packParseStatus: 'ok',
      };
    }
  }

  // Reuse the existing CsvOrderGuide compound pack parser
  // e.g. "6/2.5 LB" → {caseSize: 6, innerPack: 2.5, unit: "LB"}
  const parsed = parseCompoundPackSize(packSizeStr.trim());
  if (!parsed) return empty;

  const hasUnit = !!parsed.unit;
  const hasInner = parsed.innerPack != null;

  return {
    caseQuantity: parsed.caseSize,
    innerPackQuantity: parsed.innerPack ?? null,
    baseUnitQuantity: null,              // not derivable from Pack Size string alone
    caseUnit: 'Case',
    innerUnit: hasInner ? 'Pack' : null,
    baseUnit: parsed.unit ?? null,
    packParseStatus: hasUnit ? 'ok' : hasInner ? 'partial' : 'partial',
  };
}

// ─── Supplier / item-code classification ─────────────────────────────────────

/** Known non-authoritative supplier value patterns */
const SUPPLIER_PLACEHOLDER_RE = [
  /^$/,
  /^\s+$/,
  /^n\/a$/i,
  /^none$/i,
  /^unknown$/i,
  /^misc(ellaneous)?$/i,
  /^general$/i,
  /^\d+$/,          // purely numeric
  /^[a-z]$/i,       // single character
  /^test$/i,
];

function classifySupplier(raw: string): SupplierStatus {
  const s = raw.trim();
  if (!s) return 'blank';
  for (const re of SUPPLIER_PLACEHOLDER_RE) {
    if (re.test(s)) return 'placeholder';
  }
  if (s.length < 2) return 'placeholder';
  return 'valid';
}

// ─── Generalized placeholder detection ───────────────────────────────────────

/**
 * Returns the set of item codes that are non-authoritative (i.e. act as
 * department/default codes rather than individual item IDs).
 *
 * A code is flagged as non-authoritative when it matches ANY of:
 *  - blank / single-character
 *  - short numeric (≤4 digits) appearing on >3 rows OR >5 distinct descriptions
 *  - medium numeric (≤6 digits) appearing in >3 distinct categories AND >10 rows
 */
export function detectNonAuthoritativeCodes(
  rows: Array<{ sourceItemCode: string; rawDescription: string; sourceCategory: string }>,
): Set<string> {
  type CodeStats = {
    rowCount: number;
    descriptions: Set<string>;
    categories: Set<string>;
  };

  const stats = new Map<string, CodeStats>();
  const totalRows = rows.length;

  for (const row of rows) {
    const code = row.sourceItemCode?.trim() ?? '';
    if (!code) continue;  // blank codes handled below after Set is created

    let s = stats.get(code);
    if (!s) {
      s = { rowCount: 0, descriptions: new Set(), categories: new Set() };
      stats.set(code, s);
    }
    s.rowCount++;
    // Normalize description to a short fingerprint for comparison
    const descKey = (row.rawDescription ?? '').trim().toLowerCase().slice(0, 40);
    s.descriptions.add(descKey);
    s.categories.add((row.sourceCategory ?? '').trim());
  }

  const nonAuthoritative = new Set<string>();

  // Blank codes are inherently non-authoritative
  nonAuthoritative.add('');

  for (const [code, s] of stats) {
    const reuse = s.rowCount / Math.max(totalRows, 1);
    const isNonAuth =
      !code ||
      code.trim().length === 0 ||
      code.trim().length === 1 ||
      // Short numeric with high reuse or many distinct items behind it
      (/^\d{1,4}$/.test(code.trim()) && (
        s.rowCount > Math.max(3, totalRows * 0.005) ||
        s.descriptions.size > 5
      )) ||
      // Medium numeric spanning many categories and many rows
      (/^\d{1,6}$/.test(code.trim()) && s.categories.size > 3 && s.rowCount > 10);

    if (isNonAuth) nonAuthoritative.add(code);
  }

  return nonAuthoritative;
}

// ─── Description cleaning ─────────────────────────────────────────────────────

/**
 * Two independent transforms applied in priority order:
 *
 * Transform 1 — supplier suffix strip
 *   "12 Year Single Malt Southern Glazer's 1 / 0 750ML"
 *   → cleaned: "12 Year Single Malt"
 *   → removed: " Southern Glazer's 1 / 0 750ML"
 *
 * Transform 2 — dash separator strip (when description uses " - Supplier ...")
 *   "1800 Tequila - Republic National Distributing Company 6 / 0 ML"
 *   → cleaned: "1800 Tequila"
 *
 * Transform 3 — pack-text strip only (no supplier found)
 *   "Chicken Breast 6 / 5 LB"
 *   → cleaned: "Chicken Breast"
 */
export function cleanDescription(
  raw: string,
  supplierName: string,
): {
  cleanedDescription: string;
  cleaningMethod: CleaningMethod;
  cleaningConfidence: number;
  removedSuffix: string;
} {
  const noOp = {
    cleanedDescription: raw,
    cleaningMethod: 'none' as CleaningMethod,
    cleaningConfidence: 1.0,
    removedSuffix: '',
  };

  if (!raw || !raw.trim()) return noOp;

  const supplier = supplierName?.trim();

  let current = raw;
  let cleaningMethod: CleaningMethod = 'none';
  let cleaningConfidence = 1.0;
  let removedSuffix = '';

  if (supplier && supplier.length >= 2) {
    // Use only the structured Supplier value, but tolerate capitalization
    // differences in the export. The final literal occurrence is the source
    // suffix; supplier-like words elsewhere are never guessed away.
    const escapedSupplier = supplier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const supplierRe = new RegExp(escapedSupplier, 'ig');
    let lastIndex = -1;
    let match: RegExpExecArray | null;
    while ((match = supplierRe.exec(current)) !== null) lastIndex = match.index;
    if (lastIndex > 0) {
      const hadDashSeparator = /[\s]*[-–][\s]*$/.test(current.slice(0, lastIndex));
      const before = current.slice(0, lastIndex).replace(/[\s\-–]+$/, '').trim();
      if (before.length >= 2) {
        removedSuffix = current.slice(lastIndex);
        current = before;
        cleaningMethod = hadDashSeparator ? 'dash_supplier_strip' : 'supplier_suffix_strip';
        cleaningConfidence = cleaningMethod === 'dash_supplier_strip' ? 0.85 : 0.9;
      }
    }
  }

  // Strip a trailing numeric pack reference only after supplier cleanup.
  // This deliberately removes no ordinary product words.
  const packRefMatch = current.match(/(\s+\d+(?:\.\d+)?\s*[/]\s*\d+(?:\.\d+)?\s*[A-Za-z]*(?:\s+[A-Za-z]+)?\s*)$/);
  if (packRefMatch) {
    const before = current.slice(0, packRefMatch.index!).trim();
    if (before.length >= 2) {
      removedSuffix = `${removedSuffix}${packRefMatch[0]}`;
      current = before;
      if (cleaningMethod === 'none') {
        cleaningMethod = 'pack_text_strip';
        cleaningConfidence = 0.6;
      }
    }
  }

  return cleaningMethod === 'none'
    ? noOp
    : { cleanedDescription: current, cleaningMethod, cleaningConfidence, removedSuffix };
}

// ─── Inventory date detection ─────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Returns the last calendar day of the given year/month as YYYY-MM-DD */
function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0); // day=0 of next month = last day of this month
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function detectInventoryDate(
  filename: string,
  workbookProps: XLSX.FullProperties | undefined,
  purchaseDates: string[],
): InventoryDateResult {
  // Strategy 1: Parse "Month YYYY" from filename (highest confidence).
  // Note: use [^a-zA-Z] boundary — \b fails when preceded by underscore.
  const fnMatch = filename.match(
    /(?:^|[^a-zA-Z])(January|February|March|April|May|June|July|August|September|October|November|December)[_\s\-]+(\d{4})(?:[^a-zA-Z]|$)/i,
  );
  if (fnMatch) {
    const m = MONTH_MAP[fnMatch[1].toLowerCase()];
    const y = parseInt(fnMatch[2], 10);
    if (m && y) {
      return { detectedDate: lastDayOfMonth(y, m), detectedFrom: 'filename', confidence: 'high' };
    }
  }

  // Strategy 2: Cluster purchase dates — find the most recent month with ≥5 entries
  if (purchaseDates.length > 0) {
    const counts = new Map<string, number>();
    for (const ds of purchaseDates) {
      if (!ds?.trim()) continue;
      const m = ds.trim().match(
        /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,\s+(\d{4})$/i,
      );
      if (m) {
        const key = `${m[2]}-${String(MONTH_MAP[m[1].toLowerCase()]).padStart(2, '0')}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const qualifying = Array.from(counts.entries())
      .filter(([, cnt]) => cnt >= 5)
      .sort((a, b) => b[0].localeCompare(a[0]));
    if (qualifying.length > 0) {
      const [key] = qualifying[0];
      const [y, mo] = key.split('-').map(Number);
      return {
        detectedDate: lastDayOfMonth(y, mo),
        detectedFrom: 'purchase_date_cluster',
        confidence: 'medium',
      };
    }
  }

  // Strategy 3: Workbook modification date → assume previous month
  if (workbookProps?.ModifiedDate) {
    // @ts-ignore
    const mod = new Date(workbookProps.ModifiedDate as string);
    if (!isNaN(mod.getTime())) {
      const mo = mod.getMonth(); // 0-based
      const y = mod.getFullYear();
      const prevMo = mo === 0 ? 12 : mo;
      const prevY = mo === 0 ? y - 1 : y;
      return {
        detectedDate: lastDayOfMonth(prevY, prevMo),
        detectedFrom: 'workbook_modified_date',
        confidence: 'low',
      };
    }
  }

  return { detectedDate: null, detectedFrom: 'undetected', confidence: 'low' };
}

// ─── Format detection ─────────────────────────────────────────────────────────

export function detectOrderlyFormat(headerRow: unknown[]): boolean {
  const normalized = headerRow.map(h => String(h ?? '').trim().toLowerCase());
  return ORDERLY_HEADER_FINGERPRINT.every(req =>
    normalized.some(h => h === req),
  );
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseOrderlyWorkbook(
  buffer: Buffer,
  filename: string,
): OrderlyParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });

  // Find "Inventory Detail" sheet
  const targetSheet =
    workbook.SheetNames.find(n => n.toLowerCase().includes('inventory detail')) ??
    workbook.SheetNames[1] ??
    workbook.SheetNames[0];

  const sheet = workbook.Sheets[targetSheet];
  if (!sheet) {
    throw new Error(
      `No sheet found. Available: ${workbook.SheetNames.join(', ')}`,
    );
  }

  // Use header:1 (array mode) to handle the three duplicate "Count" columns
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
  });

  if (allRows.length === 0) throw new Error('Sheet is empty');

  const headerRow = allRows[0] as unknown[];
  if (!detectOrderlyFormat(headerRow)) {
    throw new Error(
      `Sheet "${targetSheet}" does not match Orderly inventory format. ` +
      `First 5 headers: ${headerRow.slice(0, 5).join(', ')}`,
    );
  }

  // Drop the header row and filter out blank rows
  const dataRows = allRows.slice(1).filter(r =>
    (r as unknown[]).some(
      c => c !== '' && c !== null && c !== undefined,
    ),
  );

  // Pre-scan for placeholder detection (requires all rows first)
  const preScan = dataRows.map(r => {
    const row = r as unknown[];
    return {
      sourceItemCode: String(row[COL.ITEM_CODE] ?? '').trim(),
      rawDescription: String(row[COL.ITEM_DESCRIPTION] ?? '').trim(),
      sourceCategory: String(row[COL.CATEGORY] ?? '').trim(),
    };
  });
  const placeholderCodes = detectNonAuthoritativeCodes(preScan);

  // Collect purchase dates for inventory date detection
  const purchaseDates = dataRows
    .map(r => String((r as unknown[])[COL.PURCHASE_DATE] ?? ''))
    .filter(Boolean);

  const inventoryDate = detectInventoryDate(filename, workbook.Props, purchaseDates);

  // Parse rows
  const toNum = (v: unknown): number | null => {
    const n = parseFloat(String(v ?? ''));
    return isNaN(n) ? null : n;
  };

  const parsedRows: OrderlyRow[] = dataRows.map((dataRow, idx) => {
    const row = dataRow as unknown[];

    const rawDescription = String(row[COL.ITEM_DESCRIPTION] ?? '').trim();
    const supplierRaw = String(row[COL.SUPPLIER] ?? '').trim();
    const sourceItemCode = String(row[COL.ITEM_CODE] ?? '').trim();
    const packSizeStr = String(row[COL.PACK_SIZE] ?? '').trim();

    const cleaned = cleanDescription(rawDescription, supplierRaw);
    const packGeom = parseOrderlyPackSize(packSizeStr);

    const itemCodeStatus: ItemCodeStatus = !sourceItemCode
      ? 'blank'
      : placeholderCodes.has(sourceItemCode)
      ? 'placeholder'
      : 'valid';

    const supplierStatus = classifySupplier(supplierRaw);

    // Row status classification
    let rowStatus: RowStatus = 'new_item_candidate';
    if (!rawDescription.trim()) {
      rowStatus = 'duplicate_source_row';
    } else if (itemCodeStatus === 'blank' && supplierStatus === 'blank') {
      rowStatus = 'invalid_supplier';
    } else if (supplierStatus === 'blank') {
      rowStatus = 'invalid_supplier';
    }

    // Build immutable rawData record
    // Use col_N keys for the duplicate-named "Count" columns (6, 8, 10)
    // plus named keys for all others.
    const rawData: Record<string, unknown> = {};
    headerRow.forEach((h, i) => {
      const key = [6, 8, 10].includes(i) ? `count_${i}` : String(h ?? `col_${i}`);
      rawData[key] = row[i] ?? '';
    });
    rawData['_row_index'] = idx + 1;

    return {
      rowIndex: idx + 1,
      rawData,
      rawDescription,
      cleanedDescription: cleaned.cleanedDescription,
      cleaningMethod: cleaned.cleaningMethod,
      cleaningConfidence: cleaned.cleaningConfidence,
      removedSuffix: cleaned.removedSuffix,
      ...packGeom,
      sourceItemCode,
      itemCodeStatus,
      supplierRaw,
      supplierStatus,
      storageLocation: String(row[COL.LOCATION] ?? '').trim(),
      sourceCategory: String(row[COL.CATEGORY] ?? '').trim(),
      sourceGlCode: String(row[COL.GL_CODE] ?? '').trim(),
      sourceParTarget: toNum(row[COL.PAR_ORDER_TARGET]) || null,
      packagePrice: toNum(row[COL.PACKAGE_PRICE]),
      countUnit1: String(row[COL.COUNTING_UNIT_1] ?? '').trim(),
      count1: toNum(row[COL.COUNT_1]),
      countUnit2: String(row[COL.COUNTING_UNIT_2] ?? '').trim(),
      count2: toNum(row[COL.COUNT_2]),
      countUnit3: String(row[COL.COUNTING_UNIT_3] ?? '').trim(),
      count3: toNum(row[COL.COUNT_3]),
      totalUnits: toNum(row[COL.TOTAL_UNITS]),
      totalCost: toNum(row[COL.TOTAL_COST]),
      previousCase: toNum(row[COL.PREVIOUS_CASE]),
      previousPack: toNum(row[COL.PREVIOUS_PACK]),
      previousUom: toNum(row[COL.PREVIOUS_UOM]),
      previousCost: toNum(row[COL.PREVIOUS_COST]),
      rowStatus,
    };
  });

  // Build summary counts
  // Unique item candidates: by valid code, then by normalized cleaned description for blank/placeholder rows
  const seenCodes = new Set<string>();
  const seenDescriptions = new Set<string>();
  let uniqueItemCandidates = 0;

  for (const r of parsedRows) {
    if (r.itemCodeStatus === 'valid') {
      if (!seenCodes.has(r.sourceItemCode)) {
        seenCodes.add(r.sourceItemCode);
        uniqueItemCandidates++;
      }
    } else {
      const key = r.cleanedDescription.toLowerCase().trim();
      if (key && !seenDescriptions.has(key)) {
        seenDescriptions.add(key);
        uniqueItemCandidates++;
      }
    }
  }

  const uniqueSuppliers = new Set(
    parsedRows
      .filter(r => r.supplierStatus === 'valid')
      .map(r => r.supplierRaw),
  );

  const snapshotTotal = parsedRows.reduce(
    (sum, r) => sum + (r.totalCost ?? 0),
    0,
  );

  const summary: OrderlyPreviewSummary = {
    sourceRows: parsedRows.length,
    uniqueItemCandidates,
    itemLocationAssignments: parsedRows.length,  // each row = one item+location pair
    vendorItemRelationships: parsedRows.filter(r => r.supplierStatus === 'valid').length,
    estimatedNewVendors: uniqueSuppliers.size,
    ambiguousRows: parsedRows.filter(r => r.rowStatus === 'ambiguous').length,
    packParseWarnings: parsedRows.filter(r => r.packParseStatus !== 'ok').length,
    nonAuthoritativeCodes: parsedRows.filter(r => r.itemCodeStatus === 'placeholder').length,
    invalidSuppliers: parsedRows.filter(
      r => r.supplierStatus === 'blank' || r.supplierStatus === 'placeholder',
    ).length,
    snapshotValueTotal: snapshotTotal,
  };

  return {
    sheetName: targetSheet,
    sourceRowCount: parsedRows.length,
    rows: parsedRows,
    inventoryDate,
    snapshotTotal,
    summary,
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

export function computeFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
