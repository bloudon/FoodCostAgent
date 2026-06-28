import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
// pdf-parse is CJS and has no ESM default export — createRequire bypasses Node ESM interop entirely.
// We load from the lib path to avoid the test-runner wrapper in pdf-parse's index.js.
const pdfParse = _require('pdf-parse/lib/pdf-parse.js') as (
  buf: Buffer,
  opts?: object
) => Promise<{ text: string; numpages: number }>;

export interface PdfProduct {
  productName: string;
  vendorSku: string;
  price: number | null;
  caseSize: number | null;
  caseSizeRaw: string | null;
  innerPack: number | null;
  unit: string | null;
}

export interface PdfParseResult {
  products: PdfProduct[];
  pageCount: number;
}

/**
 * Extracts vendor product catalog data from a PDF buffer using text extraction.
 *
 * Handles catalog-style PDFs where each product block follows the pattern:
 *   Product Name [possibly multi-line]
 *   SKU: VENDOR-SKU
 *   [Status line — In Stock / Out of Stock / Call for Availability]
 *   $XX.XX
 *   Qty:
 *
 * All pages are extracted in a single pass — no page-by-page looping needed.
 */
export async function parsePdfOrderGuide(pdfBuffer: Buffer): Promise<PdfParseResult> {
  const data = await pdfParse(pdfBuffer);
  const products = extractProductsFromText(data.text);
  return { products, pageCount: data.numpages };
}

const GARBAGE_PATTERNS: RegExp[] = [
  /^qty:?$/i,
  /^add to cart$/i,
  /^\d+ to \d+ of \d+ results$/i,
  /^prev(\s+\d+)+/i,
  /^(\d+\s+)+next$/i,
  /^prev\s*$/i,
  /^next\s*$/i,
  /^[\d\s]+$/,
  /^all products$/i,
  /^(in stock|out of stock|call for availability|check availability)$/i,
  /^home\s*[/>]/i,
  /^search$/i,
  /^sort\s+by/i,
  /^view:/i,
  /^filter/i,
  /^category:/i,
  /^showing\s+\d+/i,
  /^price:/i,
];

function isGarbage(line: string): boolean {
  return GARBAGE_PATTERNS.some(p => p.test(line));
}

/**
 * Maps a raw unit string (from vendor pack strings) to a canonical system unit.
 * Returns null for sale-only units (cs, case, pkg, pack, can, bag) and unknowns.
 */
export function normalizeVendorUnit(raw: string): string | null {
  const u = raw.trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, '');
  const MAP: Record<string, string | null> = {
    // Weight
    lb: 'lb.',
    lbs: 'lb.',
    pound: 'lb.',
    pounds: 'lb.',
    oz: 'oz',
    ounce: 'oz',
    ounces: 'oz',
    kg: 'kg',
    kilogram: 'kg',
    kilograms: 'kg',
    g: 'g',
    gram: 'g',
    grams: 'g',
    // Volume
    gal: 'gal',
    gallon: 'gal',
    gallons: 'gal',
    qt: 'qt',
    quart: 'qt',
    quarts: 'qt',
    pt: 'pt',
    pint: 'pt',
    pints: 'pt',
    floz: 'fl oz',
    'fl.oz': 'fl oz',
    'fluidoz': 'fl oz',
    ml: 'ml',
    milliliter: 'ml',
    milliliters: 'ml',
    l: 'l',
    liter: 'l',
    litre: 'l',
    liters: 'l',
    litres: 'l',
    // Count-like (meaningful measurement)
    ea: 'each',
    each: 'each',
    ct: 'each',
    count: 'each',
    pc: 'each',
    pcs: 'each',
    piece: 'each',
    pieces: 'each',
    // Sale-only (not a useful measurement unit for recipes)
    cs: null,
    case: null,
    pkg: null,
    pack: null,
    pk: null,
    can: null,
    bag: null,
  };
  return u in MAP ? MAP[u] : null;
}

// Units that represent a sales/purchasing denomination, not a measurable quantity.
// When these appear after the slash (e.g. "4/1CS"), they carry no recipe-useful unit info.
const SALE_ONLY_UNITS = new Set(['cs', 'case', 'pkg', 'pack', 'pk', 'can', 'bag']);

/**
 * Extracts pack size information from a product name.
 *
 * Handles two formats found embedded in product name strings:
 *
 * Pass 1 — slash+digit format (e.g. "4/1gal", "12/32oz", "2/5lb"):
 *   Left number  = caseSize (units per case)
 *   Right number = innerPack (size of each unit)
 *   Alpha suffix = unit (normalized via normalizeVendorUnit)
 *   - Sale-only suffix (cs, case, pack…) → caseSize only, innerPack dropped
 *   - Unknown suffix → innerPack preserved, unit set to null
 *
 * Pass 2 — named-unit format (e.g. "2,500/Case", "500/CS", "24/Pack"):
 *   Left number = caseSize only; innerPack and unit stay null
 *   (sale-unit words are not meaningful measurement units)
 */
export function extractPackInfoFromName(name: string): {
  caseSize: number | null;
  caseSizeRaw: string | null;
  innerPack: number | null;
  unit: string | null;
} {
  const NULL_RESULT = { caseSize: null, caseSizeRaw: null, innerPack: null, unit: null };

  // Pre-normalize known two-word unit sequences so the single-token regex captures them.
  // "FL OZ", "fl. oz", "Fl Oz" → "floz"  (normalizeVendorUnit maps floz → "fl oz")
  const searchName = name.replace(/\bfl\.?\s+oz\b/gi, 'floz');

  // Pass 1: N/N[unit] — right side starts with a digit
  // Matches: "4/1gal", "12/32oz", "2/5 lb", "4/1 CS", "12/32floz"
  const slashDigitRe = /([\d,]+)\s*\/\s*([\d.]+)\s*([A-Za-z][A-Za-z.]*)?/g;
  let match: RegExpExecArray | null;
  while ((match = slashDigitRe.exec(searchName)) !== null) {
    const csRaw = match[1].replace(/,/g, '');
    const ipRaw = match[2];
    const unitRaw = (match[3] ?? '').trim();
    const cs = parseFloat(csRaw);
    const ip = parseFloat(ipRaw);
    if (!isFinite(cs) || cs <= 0 || !isFinite(ip)) continue;

    const unitLower = unitRaw.toLowerCase();

    if (unitRaw && SALE_ONLY_UNITS.has(unitLower)) {
      // "4/1CS", "6/1Case" — sale-only suffix: caseSize only, innerPack not meaningful
      return { caseSize: cs, caseSizeRaw: match[0], innerPack: null, unit: null };
    }

    // Known or unknown measurement unit — keep innerPack, normalize unit (null if unknown)
    const normalizedUnit = unitRaw ? normalizeVendorUnit(unitRaw) : null;
    return { caseSize: cs, caseSizeRaw: match[0], innerPack: ip, unit: normalizedUnit };
  }

  // Pass 2: N/WORD — right side is a named sale unit word (no leading digit)
  const namedUnitRe = /([\d,]+)\s*\/\s*(case|cs|ea|each|pk|pack|ct|count|bag|can)/i;
  const namedMatch = searchName.match(namedUnitRe);
  if (namedMatch) {
    const cs = parseFloat(namedMatch[1].replace(/,/g, ''));
    if (!isFinite(cs) || cs <= 0) return NULL_RESULT;
    return { caseSize: cs, caseSizeRaw: namedMatch[0], innerPack: null, unit: null };
  }

  return NULL_RESULT;
}

function extractProductsFromText(text: string): PdfProduct[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const products: PdfProduct[] = [];
  const skuRegex = /^sku:\s*(.+)$/i;
  const priceRegex = /^\$(\d[\d,]*(?:\.\d+)?)$/;

  let nameLines: string[] = [];
  let currentSku: string | null = null;

  for (const line of lines) {
    if (isGarbage(line)) continue;

    const skuMatch = line.match(skuRegex);
    if (skuMatch) {
      currentSku = skuMatch[1].trim();
      continue;
    }

    if (currentSku !== null) {
      const priceMatch = line.match(priceRegex);
      if (priceMatch) {
        const productName = nameLines.join(' ').trim();
        if (productName) {
          const { caseSize, caseSizeRaw, innerPack, unit } = extractPackInfoFromName(productName);
          products.push({
            productName,
            vendorSku: currentSku,
            price: parseFloat(priceMatch[1].replace(/,/g, '')),
            caseSize,
            caseSizeRaw,
            innerPack,
            unit,
          });
        }
        nameLines = [];
        currentSku = null;
      }
      // Lines between SKU and price (status, availability) are silently skipped
      continue;
    }

    // Not a SKU line and not between SKU and price → accumulate as product name
    nameLines.push(line);
  }

  return products;
}
