/**
 * Thin, source-specific acquisition adapter for the approved Bay Hill Orderly
 * exit extract. It only acquires and normalizes source evidence; persistence
 * remains exclusively in historicalInvoiceImport.stageHistoricalInvoiceImport.
 *
 * The caller supplies the browser-authenticated session headers at runtime.
 * This module neither stores, refreshes, logs, nor guesses session credentials.
 */
import {
  BAY_HILL_ORDERLY_PROPERTY_ID,
  deriveHistoricalInvoiceWindow,
  historicalInvoicePayloadSchema,
  ORDERLY_SOURCE_SYSTEM,
  type HistoricalInvoicePayload,
} from './historicalInvoiceImport';

const ORDERLY_ORIGIN = 'https://app.bepbackoffice.com';
const SPECS_PATH = `/data/restaurantv2/spec/allSpecsForRestaurant/${BAY_HILL_ORDERLY_PROPERTY_ID}`;
const INVOICES_PATH = `/data/restaurantv2/invoice/forRest/${BAY_HILL_ORDERLY_PROPERTY_ID}`;

type UnknownRecord = Record<string, unknown>;

export class BayHillOrderlyAdapterError extends Error {
  constructor(
    public readonly code: 'AUTHENTICATION_FAILED' | 'SOURCE_RESPONSE_INVALID' | 'SOURCE_RESPONSE_UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'BayHillOrderlyAdapterError';
  }
}

export interface BayHillOrderlySession {
  /**
   * Header names and values are supplied by the authenticated runtime. The
   * adapter deliberately does not prescribe a cookie/header name.
   */
  headers: Readonly<Record<string, string>>;
}

export interface FetchBayHillHistoricalInvoicesOptions {
  cutoverDate: string;
  session: BayHillOrderlySession;
  /** Injectable for tests and the authenticated browser/session bridge. */
  fetchImplementation?: typeof fetch;
}

export interface FetchBayHillOrderlySpecsOptions {
  session: BayHillOrderlySession;
  /** Injectable for tests and authenticated browser/session bridges. */
  fetchImplementation?: typeof fetch;
}

export interface BayHillOrderlyInvoiceRange {
  start: string;
  end: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceRecord(value: unknown, description: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new BayHillOrderlyAdapterError(
      'SOURCE_RESPONSE_INVALID',
      `Orderly ${description} must be an object.`,
    );
  }
  return value;
}

function sourceArray(value: unknown, description: string): unknown[] {
  // Only a root array is confirmed. Do not unwrap data/results/items envelopes
  // or silently follow pagination conventions that have not been verified.
  if (!Array.isArray(value)) {
    throw new BayHillOrderlyAdapterError(
      'SOURCE_RESPONSE_UNSUPPORTED',
      `Orderly ${description} must be a root array; response envelopes and pagination are not verified.`,
    );
  }
  return value;
}

function requiredId(value: unknown, description: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new BayHillOrderlyAdapterError('SOURCE_RESPONSE_INVALID', `Orderly ${description} is required.`);
  }
  return String(value);
}

function optionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredId(value, 'identity');
}

function requiredNumber(value: unknown, description: string): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number)) {
    throw new BayHillOrderlyAdapterError('SOURCE_RESPONSE_INVALID', `Orderly ${description} must be a finite number.`);
  }
  return number;
}

function optionalNumber(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  return requiredNumber(value, 'amount');
}

function dateOnly(value: unknown, description: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    throw new BayHillOrderlyAdapterError(
      'SOURCE_RESPONSE_INVALID',
      `Orderly ${description} must begin with a date-only YYYY-MM-DD value.`,
    );
  }
  return value.slice(0, 10);
}

function rawPackSizeId(line: UnknownRecord): string | null {
  if (!isRecord(line.packSize)) return null;
  return optionalId(line.packSize.id);
}

function specPackSizes(specs: unknown[]): Map<string, UnknownRecord> {
  const indexed = new Map<string, UnknownRecord>();
  for (const rawSpec of specs) {
    const spec = sourceRecord(rawSpec, 'spec record');
    if (!Array.isArray(spec.packSizes)) {
      throw new BayHillOrderlyAdapterError(
        'SOURCE_RESPONSE_INVALID',
        'Orderly spec records must contain a packSizes array.',
      );
    }
    for (const rawPackSize of spec.packSizes) {
      const packSize = sourceRecord(rawPackSize, 'pack-size record');
      const id = requiredId(packSize.id, 'pack-size identity');
      if (indexed.has(id)) {
        throw new BayHillOrderlyAdapterError(
          'SOURCE_RESPONSE_INVALID',
          `Orderly specs contain duplicate packSize.id "${id}".`,
        );
      }
      indexed.set(id, packSize);
    }
  }
  return indexed;
}

function normalizeLine(rawLine: unknown, specsByPackSizeId: Map<string, UnknownRecord>) {
  const line = sourceRecord(rawLine, 'invoice line');
  const packSizeId = rawPackSizeId(line);
  const matchedPackSize = packSizeId ? specsByPackSizeId.get(packSizeId) ?? null : null;
  const quantity = requiredNumber(line.quantity, 'invoice line quantity');
  const lineTotal = requiredNumber(line.total, 'invoice line total');
  const unitPrice = line.price === undefined || line.price === null
    ? quantity === 0 ? 0 : lineTotal / quantity
    : requiredNumber(line.price, 'invoice line price');

  return {
    sourceLineId: requiredId(line.id, 'invoice line identity'),
    packSizeId,
    productName: typeof line.itemDesc === 'string'
      ? line.itemDesc
      : typeof matchedPackSize?.itemDesc === 'string' ? matchedPackSize.itemDesc : null,
    quantity,
    unitPrice,
    lineTotal,
    creditAmount: optionalNumber(line.creditAmount),
    pack: {
      pack: line.pack ?? null,
      size: line.size ?? null,
      uom: line.uom ?? null,
      packSizeDesc: matchedPackSize?.packSizeDesc ?? null,
      matchedPackSizeId: packSizeId,
    },
    catchWeight: {
      catchWeight: line.catchWeight ?? null,
      catchWeightData: line.catchWeightData ?? null,
    },
    gl: { category: line.category ?? null, gl: line.gl ?? null },
    financial: {
      total: line.total,
      price: line.price ?? null,
      invoiceIsEDI: line.invoiceIsEDI ?? null,
      invoiceIsFromDataManager: line.invoiceIsFromDataManager ?? null,
    },
    source: { orderlyLine: line, matchedSpecPackSize: matchedPackSize },
  };
}

function normalizeInvoice(rawInvoice: unknown, specsByPackSizeId: Map<string, UnknownRecord>) {
  const invoice = sourceRecord(rawInvoice, 'invoice');
  if (!Array.isArray(invoice.items) || invoice.items.length === 0) {
    throw new BayHillOrderlyAdapterError('SOURCE_RESPONSE_INVALID', 'Orderly invoice items must be a non-empty array.');
  }
  if (String(invoice.restaurantId) !== BAY_HILL_ORDERLY_PROPERTY_ID) {
    throw new BayHillOrderlyAdapterError(
      'SOURCE_RESPONSE_INVALID',
      `Orderly invoice restaurantId must be ${BAY_HILL_ORDERLY_PROPERTY_ID}.`,
    );
  }

  const taxAmount = optionalNumber(invoice.tax);
  const chargeAmount = optionalNumber(invoice.kegCharges)
    + optionalNumber(invoice.deliveryCharges)
    + optionalNumber(invoice.otherCharges);
  const creditAmount = optionalNumber(invoice.creditAmount);
  const totalAmount = requiredNumber(invoice.total, 'invoice total');
  const subtotal = invoice.subtotal === undefined || invoice.subtotal === null
    ? totalAmount - taxAmount - chargeAmount + creditAmount
    : requiredNumber(invoice.subtotal, 'invoice subtotal');

  return {
    sourceInvoiceId: requiredId(invoice.id, 'invoice identity'),
    invoiceNumber: typeof invoice.invoiceNumber === 'string' || typeof invoice.invoiceNumber === 'number'
      ? String(invoice.invoiceNumber)
      : null,
    invoiceDate: dateOnly(invoice.deliveryDate, 'invoice deliveryDate'),
    vendorName: typeof invoice.supplierName === 'string' ? invoice.supplierName : null,
    vendorExternalId: optionalId(invoice.supplierId),
    subtotal,
    taxAmount,
    chargeAmount,
    creditAmount,
    totalAmount,
    source: { orderlyInvoice: invoice },
    lines: invoice.items.map(line => normalizeLine(line, specsByPackSizeId)),
  };
}

export function normalizeBayHillOrderlyHistoricalInvoices(
  input: {
    cutoverDate: string;
    specs: unknown;
    invoices: unknown;
    invoiceRange?: BayHillOrderlyInvoiceRange;
  },
): HistoricalInvoicePayload {
  const specsByPackSizeId = specPackSizes(sourceArray(input.specs, 'specs response'));
  const invoices = sourceArray(input.invoices, 'invoice-history response')
    .map(invoice => normalizeInvoice(invoice, specsByPackSizeId));
  const window = input.invoiceRange ?? deriveHistoricalInvoiceWindow(input.cutoverDate);
  for (const invoice of invoices) {
    if (invoice.invoiceDate < window.start || invoice.invoiceDate > window.end) {
      throw new BayHillOrderlyAdapterError(
        'SOURCE_RESPONSE_INVALID',
        `Orderly invoice "${invoice.sourceInvoiceId}" is outside the requested ${window.start} through ${window.end} window.`,
      );
    }
  }
  const payload = {
    sourceSystem: ORDERLY_SOURCE_SYSTEM,
    sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
    cutoverDate: input.cutoverDate,
    invoices,
  };
  const parsed = historicalInvoicePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BayHillOrderlyAdapterError(
      'SOURCE_RESPONSE_INVALID',
      `Orderly normalized payload is invalid: ${parsed.error.issues.map(issue => issue.message).join('; ')}`,
    );
  }
  return parsed.data;
}

function assertDateOnly(value: string, description: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new BayHillOrderlyAdapterError('SOURCE_RESPONSE_INVALID', `${description} must be YYYY-MM-DD.`);
  }
  const [, yearText, monthText, dayText] = match;
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  if (
    date.getUTCFullYear() !== Number(yearText)
    || date.getUTCMonth() !== Number(monthText) - 1
    || date.getUTCDate() !== Number(dayText)
  ) {
    throw new BayHillOrderlyAdapterError('SOURCE_RESPONSE_INVALID', `${description} must be a valid calendar date.`);
  }
  return value;
}

async function fetchJson(
  fetchImplementation: typeof fetch,
  url: URL,
  session: BayHillOrderlySession,
  description: string,
): Promise<unknown> {
  const response = await fetchImplementation(url, {
    method: 'GET',
    headers: session.headers,
  });
  if (response.status === 401 || response.status === 403) {
    throw new BayHillOrderlyAdapterError('AUTHENTICATION_FAILED', `Orderly ${description} request was not authorized.`);
  }
  if (!response.ok) {
    throw new BayHillOrderlyAdapterError(
      'SOURCE_RESPONSE_INVALID',
      `Orderly ${description} request failed with HTTP ${response.status}.`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new BayHillOrderlyAdapterError('SOURCE_RESPONSE_INVALID', `Orderly ${description} response is not JSON.`);
  }
}

async function fetchBayHillOrderlyInvoiceRange(
  options: {
    cutoverDate: string;
    invoiceRange: BayHillOrderlyInvoiceRange;
    session: BayHillOrderlySession;
    fetchImplementation?: typeof fetch;
  },
): Promise<HistoricalInvoicePayload> {
  const start = assertDateOnly(options.invoiceRange.start, 'Invoice range start');
  const end = assertDateOnly(options.invoiceRange.end, 'Invoice range end');
  if (start > end) {
    throw new BayHillOrderlyAdapterError('SOURCE_RESPONSE_INVALID', 'Invoice range start must not be after its end.');
  }
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const specsUrl = new URL(SPECS_PATH, ORDERLY_ORIGIN);
  const invoicesUrl = new URL(INVOICES_PATH, ORDERLY_ORIGIN);
  invoicesUrl.searchParams.set('startDate', start);
  invoicesUrl.searchParams.set('endDate', end);

  const [specs, invoices] = await Promise.all([
    fetchJson(fetchImplementation, specsUrl, options.session, 'specs'),
    fetchJson(fetchImplementation, invoicesUrl, options.session, 'invoice-history'),
  ]);
  return normalizeBayHillOrderlyHistoricalInvoices({
    cutoverDate: options.cutoverDate,
    invoiceRange: { start, end },
    specs,
    invoices,
  });
}

/**
 * Read-only limited-range probe for a controlled dry run. This is separate
 * from the twelve-month historical helper so a small range can be checked
 * before any historical staging is attempted.
 */
export async function fetchBayHillOrderlyInvoiceRangePayload(
  options: {
    cutoverDate: string;
    startDate: string;
    endDate: string;
    session: BayHillOrderlySession;
    fetchImplementation?: typeof fetch;
  },
): Promise<HistoricalInvoicePayload> {
  return fetchBayHillOrderlyInvoiceRange({
    cutoverDate: options.cutoverDate,
    invoiceRange: { start: options.startDate, end: options.endDate },
    session: options.session,
    fetchImplementation: options.fetchImplementation,
  });
}

export async function fetchBayHillOrderlyHistoricalInvoicePayload(
  options: FetchBayHillHistoricalInvoicesOptions,
): Promise<HistoricalInvoicePayload> {
  const window = deriveHistoricalInvoiceWindow(options.cutoverDate);
  return fetchBayHillOrderlyInvoiceRange({
    cutoverDate: options.cutoverDate,
    invoiceRange: window,
    session: options.session,
    fetchImplementation: options.fetchImplementation,
  });
}

/**
 * Fetch the authoritative Bay Hill restaurant-spec catalog without invoices.
 * The response contract remains deliberately strict: only a root array is
 * accepted, and no source data is persisted by this adapter.
 */
export async function fetchBayHillOrderlySpecs(
  options: FetchBayHillOrderlySpecsOptions,
): Promise<unknown[]> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const specsUrl = new URL(SPECS_PATH, ORDERLY_ORIGIN);
  const specs = await fetchJson(fetchImplementation, specsUrl, options.session, 'specs');
  return sourceArray(specs, 'specs response');
}