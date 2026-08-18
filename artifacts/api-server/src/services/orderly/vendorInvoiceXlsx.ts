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
  const totalsSheet = wb.Sheets['Invoice Totals'];
  if (!totalsSheet) {
    throw new VendorInvoiceParseError('The workbook has no "Invoice Totals" sheet, which is required for per-invoice reconciliation.');
  }

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
