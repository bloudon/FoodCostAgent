/**
 * Shared vendor pack-string parsing utilities.
 *
 * Single source of truth used by both CsvOrderGuide and PdfOrderGuide
 * so that raw unit strings always normalize to the same canonical form
 * regardless of which importer produced the data.
 */

/**
 * Units that represent a sales/purchasing denomination, not a measurable
 * quantity. When these appear in pack strings they carry no recipe-useful
 * unit information.
 */
export const SALE_ONLY_UNITS = new Set([
  'cs', 'case', 'cases', 'pkg', 'pack', 'pk', 'can', 'bag',
]);

/**
 * Maps a raw unit string (from any vendor pack string or UOM column) to the
 * canonical system unit used throughout the application.
 *
 * Returns null for sale-only denominations (cs, case, pack…) and for
 * unrecognised strings — callers decide whether to fall back to the raw value.
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
    fluidoz: 'fl oz',
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
    unit: 'each',
    units: 'each',
    // Sale-only (not a useful measurement unit for recipes)
    cs: null,
    case: null,
    cases: null,
    pkg: null,
    pack: null,
    pk: null,
    can: null,
    bag: null,
    // Agricultural / specialty packaging
    bshl: 'bu.',
    bushel: 'bu.',
    bushels: 'bu.',
    bx: 'each',
    box: 'each',
    boxes: 'each',
    '#10': 'each',  // #10 can (standard 106 oz commercial can) — treat as single-unit container
  };
  return u in MAP ? MAP[u] : null;
}

/**
 * Returns true when the UOM string represents a per-item count unit
 * (EA, each, ct, pc…) rather than a case, weight, or volume measure.
 *
 * "CS" (case) is intentionally excluded: a row with UOM=CS and a net-weight
 * column means the net weight IS the case weight in the base unit, not a
 * per-each weight that needs derivation. Including CS would incorrectly label
 * every case-UOM row as an "each" product.
 */
export function isCountUnit(unit: string): boolean {
  if (!unit) return false;
  const u = unit.trim().toLowerCase();
  return ['ea', 'each', 'unit', 'units', 'piece', 'pieces', 'pc', 'pcs', 'ct', 'count'].includes(u);
}

/**
 * Extracts pack size information from a product name string.
 *
 * Handles two formats found embedded in PDF catalog product names:
 *
 * Pass 1 — slash+digit format (e.g. "4/1gal", "12/32oz", "2/5lb", "12/32 FL OZ"):
 *   Left number  = caseSize (units per case)
 *   Right number = innerPack (size of each unit)
 *   Alpha suffix = unit (normalized via normalizeVendorUnit)
 *   - Sale-only suffix (cs, case, pack…) → caseSize only, innerPack dropped
 *   - Unknown suffix → innerPack preserved, unit set to null
 *
 * Pass 2 — named-unit format (e.g. "2,500/Case", "500/CS", "24/Pack"):
 *   Left number = caseSize only; innerPack and unit stay null
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
  const namedUnitRe = /([\d,]+)\s*\/\s*(case|cases|cs|ea|each|pk|pack|ct|count|bag|can)/i;
  const namedMatch = searchName.match(namedUnitRe);
  if (namedMatch) {
    const cs = parseFloat(namedMatch[1].replace(/,/g, ''));
    if (!isFinite(cs) || cs <= 0) return NULL_RESULT;
    return { caseSize: cs, caseSizeRaw: namedMatch[0], innerPack: null, unit: null };
  }

  return NULL_RESULT;
}
