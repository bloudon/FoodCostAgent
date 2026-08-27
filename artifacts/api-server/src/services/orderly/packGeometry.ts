export interface SourcePackGeometry {
  caseQuantity: number | null | undefined;
  innerPackQuantity: number | null | undefined;
  baseUnitQuantity: number | null | undefined;
  baseUnit: string | null | undefined;
}

export type PackCompatibility = 'compatible' | 'incompatible' | 'unknown';

export interface PackCompatibilityResult {
  status: PackCompatibility;
  reason: string;
  normalizedUnit: string | null;
  totalBaseUnits: number | null;
}

export interface CatalogPackGeometry {
  canonicalUnit: string;
  containerSize: number;
  casePkgCount: number;
  caseSize: number;
}

interface NormalizedUnit {
  dimension: string;
  multiplier: number;
  label: string;
}

export function normalizePackUnit(value: string | null | undefined): NormalizedUnit | null {
  // Keep decimal points because quantities such as 5.16G are meaningful, while
  // still treating punctuation after a unit token (LB., FL.OZ) as a separator.
  const raw = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return null;

  // A keg's trailing "G" means gallons, not grams. The keg label supplies the
  // context that makes this otherwise ambiguous single-letter unit safe.
  const kegVolumeMatch = raw.match(/\bkeg\s+(\d+(?:\.\d+)?)\s*g\b/);
  if (kegVolumeMatch) {
    const amount = Number(kegVolumeMatch[1]);
    if (Number.isFinite(amount) && amount > 0) {
      return { dimension: 'volume', multiplier: amount * 3785.41, label: 'ML' };
    }
  }

  // Source labels can precede the measurable token (for example, "PACK 5 LB").
  // Extract only a complete number + known unit pair; a label without such a
  // pair remains unknown rather than being guessed as a unit.
  const unitPattern = String.raw`(?:fl\s*oz|fluid\s+ounces?|milliliters?|millilitres?|liters?|litres?|gallons?|quarts?|pints?|cups?|ounces?|pounds?|kilograms?|grams?|ml|lt|l|gal|qt|pt|cup|oz|lb|kg|gr|g|ea|each|unit|units|ct|count|dz|dozen|dozens|#10(?:\s*can)?)`;
  const embeddedAmountMatch = raw.match(
    new RegExp(String.raw`(?:^|\s)(\d+(?:\.\d+)?)\s*(${unitPattern})(?=$|\s)`, 'i'),
  );
  const amountMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
  const amount = embeddedAmountMatch
    ? Number(embeddedAmountMatch[1])
    : amountMatch
      ? Number(amountMatch[1])
      : 1;
  const unit = embeddedAmountMatch
    ? embeddedAmountMatch[2]
    : amountMatch
      ? amountMatch[2]
      : raw;
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  if (['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(unit)) {
    return { dimension: 'volume', multiplier: amount, label: 'ML' };
  }
  if (['l', 'lt', 'liter', 'liters', 'litre', 'litres'].includes(unit)) {
    return { dimension: 'volume', multiplier: amount * 1000, label: 'ML' };
  }
  if (['fl oz', 'floz', 'fluid ounce', 'fluid ounces'].includes(unit)) {
    return { dimension: 'volume', multiplier: amount * 29.5735295625, label: 'ML' };
  }
  if (['gal', 'gallon', 'gallons'].includes(unit)) {
    return { dimension: 'volume', multiplier: amount * 3785.41, label: 'ML' };
  }
  if (['qt', 'quart', 'quarts'].includes(unit)) {
    return { dimension: 'volume', multiplier: amount * 946.353, label: 'ML' };
  }
  if (['pt', 'pint', 'pints'].includes(unit)) {
    return { dimension: 'volume', multiplier: amount * 473.176, label: 'ML' };
  }
  if (['cup', 'cups'].includes(unit)) {
    return { dimension: 'volume', multiplier: amount * 236.588, label: 'ML' };
  }
  if (['ea', 'each', 'unit', 'units', 'ct', 'count', '#10', '#10 can'].includes(unit)) {
    return { dimension: 'each', multiplier: amount, label: 'EA' };
  }
  if (['dz', 'dozen', 'dozens'].includes(unit)) {
    return { dimension: 'each', multiplier: amount * 12, label: 'EA' };
  }
  if (['oz', 'ounce', 'ounces'].includes(unit)) {
    return { dimension: 'weight', multiplier: amount, label: 'OZ' };
  }
  if (['lb', 'lbs', 'pound', 'pounds'].includes(unit)) {
    return { dimension: 'weight', multiplier: amount * 16, label: 'OZ' };
  }
  if (['kg', 'kilogram', 'kilograms'].includes(unit)) {
    return { dimension: 'weight', multiplier: amount * 35.27396195, label: 'OZ' };
  }
  if (['g', 'gr', 'gram', 'grams'].includes(unit)) {
    return { dimension: 'weight', multiplier: amount * 0.03527396195, label: 'OZ' };
  }
  return null;
}

export function isSupportedPackUnit(value: string | null | undefined): boolean {
  return normalizePackUnit(value) !== null;
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Reduce an XLSX three-tier pack to a comparable total in a normalized unit.
 * Every parsed tier must be explicit. Missing evidence is intentionally
 * unknown rather than silently assuming a multiplier of one.
 */
export function normalizePackGeometry(geometry: SourcePackGeometry): PackCompatibilityResult {
  const unit = normalizePackUnit(geometry.baseUnit);
  if (
    !unit ||
    !isPositiveFinite(geometry.caseQuantity) ||
    !isPositiveFinite(geometry.innerPackQuantity) ||
    !isPositiveFinite(geometry.baseUnitQuantity)
  ) {
    return {
      status: 'unknown',
      reason: 'complete parsed case, inner-pack, base-unit quantity, and base unit are required',
      normalizedUnit: unit?.label ?? null,
      totalBaseUnits: null,
    };
  }
  const totalBaseUnits =
    geometry.caseQuantity *
    geometry.innerPackQuantity *
    geometry.baseUnitQuantity *
    unit.multiplier;
  if (!isPositiveFinite(totalBaseUnits)) {
    return {
      status: 'unknown',
      reason: 'normalized pack total must be a positive finite number',
      normalizedUnit: unit.label,
      totalBaseUnits: null,
    };
  }
  return {
    status: 'compatible',
    reason: '',
    normalizedUnit: unit.label,
    totalBaseUnits,
  };
}

/**
 * Convert complete source geometry into the inventory_items hierarchy.
 *
 * Catalog quantities use the same normalized base unit as pack comparisons, so
 * a source liter becomes 1,000 ML and a source pound becomes 16 OZ. This keeps
 * caseSize, containerSize, and per-unit costs on one canonical basis.
 */
export function toCatalogPackGeometry(
  geometry: SourcePackGeometry,
): CatalogPackGeometry | null {
  const unit = normalizePackUnit(geometry.baseUnit);
  if (
    !unit ||
    !isPositiveFinite(geometry.caseQuantity) ||
    !isPositiveFinite(geometry.innerPackQuantity) ||
    !isPositiveFinite(geometry.baseUnitQuantity)
  ) {
    return null;
  }

  const casePkgCount = geometry.caseQuantity * geometry.innerPackQuantity;
  const containerSize = geometry.baseUnitQuantity * unit.multiplier;
  const caseSize = casePkgCount * containerSize;
  if (
    !Number.isFinite(casePkgCount) ||
    !Number.isFinite(containerSize) ||
    !Number.isFinite(caseSize) ||
    casePkgCount <= 0 ||
    containerSize <= 0 ||
    caseSize <= 0
  ) {
    return null;
  }

  return {
    canonicalUnit: unit.label,
    containerSize,
    casePkgCount,
    caseSize,
  };
}

/**
 * Compatibility is strict: source packs must reduce to the same normalized
 * unit dimension and total quantity. Name evidence is evaluated elsewhere and
 * never makes incompatible or unknown geometry safe.
 */
export function comparePackGeometry(
  source: SourcePackGeometry,
  candidate: SourcePackGeometry,
): PackCompatibilityResult {
  const left = normalizePackGeometry(source);
  const right = normalizePackGeometry(candidate);
  if (left.status === 'unknown' || right.status === 'unknown' || left.totalBaseUnits == null || right.totalBaseUnits == null) {
    const reason = left.status === 'unknown' && right.status === 'unknown'
      ? 'both the incoming source row and existing source mapping lack complete pack evidence'
      : left.status === 'unknown'
        ? 'the incoming source row lacks complete pack evidence'
        : 'the existing source mapping lacks complete pack evidence';
    return {
      status: 'unknown',
      reason,
      normalizedUnit: left.normalizedUnit ?? right.normalizedUnit,
      totalBaseUnits: left.totalBaseUnits,
    };
  }
  if (left.normalizedUnit !== right.normalizedUnit) {
    return {
      status: 'incompatible',
      reason: `base-unit dimensions differ (${left.normalizedUnit} versus ${right.normalizedUnit})`,
      normalizedUnit: left.normalizedUnit,
      totalBaseUnits: left.totalBaseUnits,
    };
  }
  const difference = Math.abs(left.totalBaseUnits - right.totalBaseUnits);
  const tolerance = Math.max(left.totalBaseUnits, right.totalBaseUnits) * 0.01;
  if (difference > tolerance) {
    return {
      status: 'incompatible',
      reason: `normalized pack totals differ (${left.totalBaseUnits} ${left.normalizedUnit} versus ${right.totalBaseUnits} ${right.normalizedUnit})`,
      normalizedUnit: left.normalizedUnit,
      totalBaseUnits: left.totalBaseUnits,
    };
  }
  return {
    status: 'compatible',
    reason: `both packs normalize to ${left.totalBaseUnits} ${left.normalizedUnit}`,
    normalizedUnit: left.normalizedUnit,
    totalBaseUnits: left.totalBaseUnits,
  };
}