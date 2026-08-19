/**
 * Parser for per-vendor invoice line-item XLSX exports (Orderly).
 *
 * Workbook shape (sample: Community Coffee):
 *   Summary        — informational; "Vendor" row used for vendor-name detection
 *   Line Items     — Invoice #, Date, Item Code, Item Description, Pack Size,
 *                    Qty, Extended $, Category, GL Code
 *   Invoice Totals — Invoice #, Date, Amount (per-invoice reconciliation)
 *
 * Pure parsing only — no DB access. Raw values are preserved verbatim in
 * `raw`; normalization (dates → YYYY-MM-DD, numbers) is additive.
 */
import * as XLSX from 'xlsx';

export const VENDOR_INVOICE_PARSER_VERSION = '1.0';

export interface VendorInvoiceParsedLine {
  rowIndex: number;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  itemCode: string | null;
  description: string | null;
  packSizeRaw: string | null;
  qty: number | null;
  extendedAmount: number | null;
  category: string | null;
  glCode: string | null;
  raw: Record<string, unknown>;
}

export interface VendorInvoiceTotal {
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  amount: number;
}

export interface VendorInvoiceParseResult {
  vendorNameDetected: string | null;
  lines: VendorInvoiceParsedLine[];
  invoiceTotals: VendorInvoiceTotal[];
  invoiceCount: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  totalAmount: number;
  warnings: string[];
}

export class VendorInvoiceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VendorInvoiceParseError';
  }
}

/** Normalize a source date cell (string MM/DD/YYYY, ISO, or Excel serial) to YYYY-MM-DD. */
export function normalizeInvoiceDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial date (1900 epoch)
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const s = String(value).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function toTextOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Detect which parser format a workbook uses — without fully parsing it.
 *
 * Returns:
 *   'multi_sheet'   — has a "Line Items" sheet (canonical Orderly bulk export)
 *   'single_sheet'  — no "Line Items" sheet but has at least one sheet
 *                     (Cheney Brothers / per-invoice single-sheet format)
 *
 * Throws VendorInvoiceParseError when the buffer cannot be read or is empty.
 */
export function detectWorkbookFormat(buffer: Buffer): 'multi_sheet' | 'single_sheet' {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (err: any) {
    throw new VendorInvoiceParseError(`Could not read workbook: ${err?.message ?? err}`);
  }
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new VendorInvoiceParseError('Workbook has no sheets.');
  }
  return wb.SheetNames.includes('Line Items') ? 'multi_sheet' : 'single_sheet';
}

/**
 * Auto-detect the workbook format and dispatch to the appropriate parser.
 * This is the recommended entry point when the caller does not know in advance
 * which format the uploaded file uses.
 */
export function parseVendorInvoiceWorkbookAuto(buffer: Buffer): VendorInvoiceParseResult & { format: 'multi_sheet' | 'single_sheet' } {
  const format = detectWorkbookFormat(buffer);
  const parsed = format === 'multi_sheet'
    ? parseVendorInvoiceWorkbook(buffer)
    : parseSingleSheetInvoiceWorkbook(buffer);
  return { ...parsed, format };
}

/** Detect vendor name from the Summary sheet's "Vendor" label row. */
function detectVendorName(wb: XLSX.WorkBook): string | null {
  const sheet = wb.Sheets['Summary'];
  if (!sheet) return null;
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  for (const row of rows) {
    if (Array.isArray(row) && String(row[0] ?? '').trim().toLowerCase() === 'vendor') {
      const name = toTextOrNull(row[1]);
      if (name) return name;
    }
  }
  return null;
}

/**
 * Detect vendor name and invoice metadata from a single-sheet header block.
 * Scans the first `scanRows` rows looking for "Vendor", "Invoice #",
 * "Delivery Date" / "Invoice Date" label-value pairs.
 */
function detectSingleSheetMeta(rows: unknown[][]): {
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceTotal: number | null;
} {
  let vendorName: string | null = null;
  let invoiceNumber: string | null = null;
  let invoiceDate: string | null = null;
  let invoiceTotal: number | null = null;

  for (const row of rows.slice(0, 15)) {
    if (!Array.isArray(row)) continue;
    const label = String(row[0] ?? '').trim().toLowerCase();
    const value = row[1];
    if (label === 'vendor') vendorName = toTextOrNull(value);
    else if (label === 'invoice #' || label === 'invoice#') invoiceNumber = toTextOrNull(value);
    else if (label === 'delivery date' || label === 'invoice date') invoiceDate = normalizeInvoiceDate(value);
    else if (label === 'invoice total') invoiceTotal = toNumber(value);
  }
  return { vendorName, invoiceNumber, invoiceDate, invoiceTotal };
}

/**
 * Identify the first row index whose columns contain the expected product-line
 * headers (case-insensitive partial match on the known Cheney single-sheet
 * columns: Description, Quantity / Qty, Line Total / Extended $).
 * Returns -1 when not found.
 */
function findSingleSheetHeaderRow(rows: unknown[][]): number {
  const REQUIRED = new Set(['description', 'quantity', 'qty', 'line total', 'extended $']);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const cells = row.map(c => String(c ?? '').trim().toLowerCase()).filter(c => c.length > 0);
    const matched = cells.filter(c => REQUIRED.has(c)).length;
    if (matched >= 2) return i;
  }
  return -1;
}

/**
 * Parse a single-sheet invoice workbook in the Cheney Brothers / per-vendor
 * Orderly single-invoice export format.
 *
 * Sheet shape (one sheet named "Invoice Line Items" or similar):
 *   Rows 1-N  — label/value metadata pairs (Vendor, Invoice #, Delivery Date, …)
 *   Row H     — column headers: Item Code, Description, Pack, Size, UOM, Quantity, Line Total, Catch Weight
 *   Rows H+1… — product data rows
 *
 * Key differences from the multi-sheet format:
 *   - No separate "Invoice Totals" sheet — total is derived from the header block or
 *     by summing Line Total values.
 *   - Price column is "Line Total" (extended amount for the quantity ordered), not a
 *     per-case price. extendedAmount is set from "Line Total"; per-line case price is
 *     NOT derived here — callers use extendedAmount ÷ qty at apply time.
 *   - Pack geometry comes from two separate columns: "Pack" (outer count) + "Size"
 *     (inner size / weight). These are joined into packSizeRaw as "Pack/Size UOM".
 *   - Warning added to signal absence of a reconciliation sheet.
 *
 * Returns a VendorInvoiceParseResult so the existing import pipeline is unchanged.
 */
export function parseSingleSheetInvoiceWorkbook(buffer: Buffer): VendorInvoiceParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (err: any) {
    throw new VendorInvoiceParseError(`Could not read workbook: ${err?.message ?? err}`);
  }

  // Accept the first sheet regardless of name (Cheney uses "Invoice Line Items")
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new VendorInvoiceParseError('Workbook has no sheets.');
  const sheet = wb.Sheets[sheetName];

  // Read as raw rows (header:1) so we can locate the header row ourselves
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Extract invoice-level metadata from the top of the sheet
  const meta = detectSingleSheetMeta(allRows);
  if (!meta.invoiceNumber) {
    throw new VendorInvoiceParseError(
      'Could not find an "Invoice #" label row in the single-sheet workbook. ' +
      'Expected a label/value pair in the first 15 rows.',
    );
  }
  if (!meta.invoiceDate) {
    throw new VendorInvoiceParseError(
      'Could not find a parseable "Delivery Date" or "Invoice Date" in the single-sheet workbook.',
    );
  }

  // Find the product-header row
  const headerRowIdx = findSingleSheetHeaderRow(allRows);
  if (headerRowIdx === -1) {
    throw new VendorInvoiceParseError(
      'Could not locate a product-header row containing "Description" and "Quantity"/"Line Total" columns.',
    );
  }

  // Build a header→column-index map (case-insensitive)
  const headerCells = allRows[headerRowIdx] as unknown[];
  const colIndex: Record<string, number> = {};
  for (let c = 0; c < headerCells.length; c++) {
    const key = String(headerCells[c] ?? '').trim().toLowerCase();
    if (key) colIndex[key] = c;
  }

  const getCol = (row: unknown[], ...keys: string[]): unknown => {
    for (const k of keys) {
      const idx = colIndex[k.toLowerCase()];
      if (idx !== undefined) return (row as unknown[])[idx] ?? null;
    }
    return null;
  };

  const warnings: string[] = [
    'Single-sheet format: no "Invoice Totals" reconciliation sheet present. ' +
    'Invoice total is derived from the header block or summed from line totals.',
  ];

  const invoiceNum = meta.invoiceNumber;
  const invoiceDate = meta.invoiceDate;

  const lines: VendorInvoiceParsedLine[] = [];
  const dataRows = allRows.slice(headerRowIdx + 1);
  for (const [i, row] of dataRows.entries()) {
    if (!Array.isArray(row)) continue;
    // Skip rows where Description is empty (surcharges / blank trailing rows without item codes are still accepted)
    const description = toTextOrNull(getCol(row, 'Description'));
    if (!description) {
      // Allow surcharge rows that at least have a line total
      const lt = toNumber(getCol(row, 'Line Total'));
      if (lt == null) continue;
    }

    // Item Code
    const itemCode = toTextOrNull(getCol(row, 'Item Code'));

    // Pack geometry: Pack (outer) + Size (inner) + UOM → join as "Pack/Size UOM"
    const packOuter = toNumber(getCol(row, 'Pack'));
    const packSize = toNumber(getCol(row, 'Size'));
    const packUom = toTextOrNull(getCol(row, 'UOM', 'Uom'));
    let packSizeRaw: string | null = null;
    if (packOuter != null && packSize != null && packUom) {
      packSizeRaw = `${packOuter}/${packSize} ${packUom}`;
    } else if (packOuter != null && packSize != null) {
      packSizeRaw = `${packOuter}/${packSize}`;
    } else if (packOuter != null) {
      packSizeRaw = packUom ? `${packOuter} ${packUom}` : String(packOuter);
    }

    const qty = toNumber(getCol(row, 'Quantity', 'Qty'));
    const extendedAmount = toNumber(getCol(row, 'Line Total', 'Extended $'));

    // Skip rows with no meaningful content
    if (itemCode == null && description == null) {
      warnings.push(`Row ${headerRowIdx + 2 + i}: no item code or description — skipped.`);
      continue;
    }

    lines.push({
      rowIndex: i,
      invoiceNumber: invoiceNum,
      invoiceDate,
      itemCode,
      description,
      packSizeRaw,
      qty,
      extendedAmount,
      category: null,
      glCode: null,
      raw: Object.fromEntries(headerCells.map((h, c) => [String(h ?? c), (row as unknown[])[c] ?? null])),
    });
  }

  if (lines.length === 0) {
    throw new VendorInvoiceParseError('No parseable product rows found in the single-sheet workbook.');
  }

  // Derive invoice total: prefer metadata block value, fall back to sum of line totals
  const derivedTotal = lines.reduce((sum, l) => sum + (l.extendedAmount ?? 0), 0);
  const totalAmount = meta.invoiceTotal ?? derivedTotal;
  if (meta.invoiceTotal != null) {
    const gap = Math.abs(meta.invoiceTotal - derivedTotal);
    if (gap > 0.02) {
      warnings.push(
        `Header invoice total ${meta.invoiceTotal.toFixed(2)} differs from sum of line totals ` +
        `${derivedTotal.toFixed(2)} by ${gap.toFixed(2)}.`,
      );
    }
  }

  const invoiceTotals: VendorInvoiceTotal[] = [{ invoiceNumber: invoiceNum, invoiceDate, amount: totalAmount }];

  return {
    vendorNameDetected: meta.vendorName,
    lines,
    invoiceTotals,
    invoiceCount: 1,
    dateRangeStart: invoiceDate,
    dateRangeEnd: invoiceDate,
    totalAmount,
    warnings,
  };
}

export function parseVendorInvoiceWorkbook(buffer: Buffer): VendorInvoiceParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (err: any) {
    throw new VendorInvoiceParseError(`Could not read workbook: ${err?.message ?? err}`);
  }

  const lineSheet = wb.Sheets['Line Items'];
  if (!lineSheet) {
    throw new VendorInvoiceParseError('The workbook has no "Line Items" sheet. This importer expects a per-vendor invoice line-item export.');
  }
  // Accept the canonical "Invoice Totals" sheet or a single unambiguous
  // variant whose name begins with "Invoice Totals" (e.g. "Invoice Totals
  // (Deposit Ledger)"). Fail closed when multiple candidates exist — never
  // guess between totals sheets.
  const totalsCandidates = wb.SheetNames.filter(
    n => n === 'Invoice Totals' || n.startsWith('Invoice Totals'),
  );
  if (totalsCandidates.length === 0) {
    throw new VendorInvoiceParseError('The workbook has no "Invoice Totals" sheet, which is required for per-invoice reconciliation.');
  }
  if (totalsCandidates.length > 1) {
    throw new VendorInvoiceParseError(
      `The workbook has multiple candidate totals sheets (${totalsCandidates.map(n => `"${n}"`).join(', ')}); exactly one "Invoice Totals" sheet is required.`,
    );
  }
  const totalsSheet = wb.Sheets[totalsCandidates[0]];

  const warnings: string[] = [];
  const rawLines: Record<string, unknown>[] = XLSX.utils.sheet_to_json(lineSheet, { defval: null });
  const lines: VendorInvoiceParsedLine[] = [];
  for (const [index, raw] of rawLines.entries()) {
    const invoiceNumber = toTextOrNull(raw['Invoice #']);
    const invoiceDate = normalizeInvoiceDate(raw['Date']);
    if (!invoiceNumber || !invoiceDate) {
      warnings.push(`Line Items row ${index + 2}: missing or unparseable Invoice # / Date — row skipped.`);
      continue;
    }
    lines.push({
      rowIndex: index,
      invoiceNumber,
      invoiceDate,
      itemCode: toTextOrNull(raw['Item Code']),
      description: toTextOrNull(raw['Item Description']),
      packSizeRaw: toTextOrNull(raw['Pack Size']),
      qty: toNumber(raw['Qty']),
      extendedAmount: toNumber(raw['Extended $']),
      category: toTextOrNull(raw['Category']),
      glCode: toTextOrNull(raw['GL Code']),
      raw,
    });
  }
  if (lines.length === 0) {
    throw new VendorInvoiceParseError('The "Line Items" sheet contains no parseable rows.');
  }

  const rawTotals: Record<string, unknown>[] = XLSX.utils.sheet_to_json(totalsSheet, { defval: null });
  const invoiceTotals: VendorInvoiceTotal[] = [];
  const seenTotals = new Set<string>();
  for (const [index, raw] of rawTotals.entries()) {
    const invoiceNumber = toTextOrNull(raw['Invoice #']);
    const invoiceDate = normalizeInvoiceDate(raw['Date']);
    const amount = toNumber(raw['Amount']);
    if (!invoiceNumber || !invoiceDate || amount == null) {
      warnings.push(`Invoice Totals row ${index + 2}: missing Invoice # / Date / Amount — row skipped.`);
      continue;
    }
    if (seenTotals.has(invoiceNumber)) {
      warnings.push(`Invoice Totals: duplicate invoice number ${invoiceNumber} — first occurrence kept.`);
      continue;
    }
    seenTotals.add(invoiceNumber);
    invoiceTotals.push({ invoiceNumber, invoiceDate, amount });
  }

  // Lines referencing invoices missing from the Totals sheet (and vice versa)
  const lineInvoices = new Set(lines.map(l => l.invoiceNumber));
  for (const inv of lineInvoices) {
    if (!seenTotals.has(inv)) warnings.push(`Invoice ${inv} has line items but no Invoice Totals row.`);
  }
  for (const t of invoiceTotals) {
    if (!lineInvoices.has(t.invoiceNumber)) warnings.push(`Invoice ${t.invoiceNumber} appears in Invoice Totals but has no line items.`);
  }

  const allDates = [...lines.map(l => l.invoiceDate), ...invoiceTotals.map(t => t.invoiceDate)].sort();
  return {
    vendorNameDetected: detectVendorName(wb),
    lines,
    invoiceTotals,
    invoiceCount: new Set([...lineInvoices, ...seenTotals]).size,
    dateRangeStart: allDates[0] ?? null,
    dateRangeEnd: allDates[allDates.length - 1] ?? null,
    totalAmount: invoiceTotals.reduce((n, t) => n + t.amount, 0),
    warnings,
  };
}

// ─── Pack-size cross-check ────────────────────────────────────────────────────

export interface ParsedPackSize {
  outer: number | null;
  inner: number | null;
  uom: string | null;
}

/**
 * Parse a source pack string like "1/12 EACH", "6/4 OZ", "1 CS" into
 * outer/inner/uom. Returns nulls when the shape is unrecognized — callers must
 * treat that as "cannot cross-check", not as a conflict.
 */
export function parsePackSize(raw: string | null | undefined): ParsedPackSize {
  if (!raw) return { outer: null, inner: null, uom: null };
  const s = raw.trim();
  let m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*([A-Za-z ]*)$/.exec(s);
  if (m) return { outer: Number(m[1]), inner: Number(m[2]), uom: m[3].trim() || null };
  m = /^(\d+(?:\.\d+)?)\s*([A-Za-z ]+)$/.exec(s);
  if (m) return { outer: Number(m[1]), inner: null, uom: m[2].trim() || null };
  return { outer: null, inner: null, uom: null };
}

export type PackCrossCheck = 'match' | 'conflict' | 'unverifiable';

/**
 * Cross-check the source pack string against stored vendor-item geometry.
 * Only a *material* disagreement is a conflict: when both sides state a
 * comparable dimension and the values differ beyond 1% tolerance.
 * Missing/degenerate stored geometry (caseSize 1 with no pack UOM — the
 * common state for migrated items) is "unverifiable", not a conflict.
 */
export function crossCheckPackSize(
  sourcePack: ParsedPackSize,
  stored: { caseSize: number | null; innerPackSize: number | null; packUom: string | null },
): PackCrossCheck {
  if (sourcePack.outer == null) return 'unverifiable';
  const storedCase = stored.caseSize ?? null;
  const storedInner = stored.innerPackSize ?? null;
  const storedMeaningful =
    (storedCase != null && storedCase !== 1) ||
    (storedInner != null && storedInner !== 1) ||
    (stored.packUom != null && stored.packUom.trim() !== '');
  if (!storedMeaningful) return 'unverifiable';

  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01 * Math.max(a, b), 1e-9);
  if (storedCase != null && storedCase > 0 && !close(sourcePack.outer, storedCase)) {
    // Some exports encode "1/12 EACH" where stored caseSize is 12 — accept the
    // transposed form before declaring conflict.
    if (!(sourcePack.inner != null && storedCase != null && close(sourcePack.inner, storedCase))) {
      return 'conflict';
    }
  }
  if (
    sourcePack.inner != null &&
    storedInner != null &&
    storedInner > 0 &&
    storedInner !== 1 &&
    !close(sourcePack.inner, storedInner)
  ) {
    return 'conflict';
  }
  return 'match';
}
