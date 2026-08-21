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

interface NormalizedUnit {
  dimension: string;
  multiplier: number;
  label: string;
}

function normalizeUnit(value: string | null | undefined): NormalizedUnit | null {
  const raw = (value ?? '').trim().toLowerCase().replace(/[._-]/g, ' ').replace(/\s+/g, ' ');
  const amountMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
  const amount = amountMatch ? Number(amountMatch[1]) : 1;
  const unit = amountMatch ? amountMatch[2] : raw;
  if (!unit) return null;
  if (['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(unit)) {
    return { dimension: 'volume', multiplier: amount, label: 'ML' };
  }
  if (['l', 'lt', 'liter', 'liters', 'litre', 'litres'].includes(unit)) {
    return { dimension: 'volume', multiplier: amount * 1000, label: 'ML' };
  }
  if (['fl oz', 'floz', 'fluid ounce', 'fluid ounces'].includes(unit)) {
    return { dimension: 'volume', multiplier: amount * 29.5735295625, label: 'ML' };
  }
  if (['ea', 'each', 'unit', 'units', 'ct', 'count'].includes(unit)) {
    return { dimension: 'each', multiplier: amount, label: 'EA' };
  }
  if (['oz', 'ounce', 'ounces'].includes(unit)) {
    return { dimension: 'weight', multiplier: amount, label: 'OZ' };
  }
  if (['lb', 'lbs', 'pound', 'pounds'].includes(unit)) {
    return { dimension: 'weight', multiplier: amount * 16, label: 'OZ' };
  }
  return { dimension: `other:${unit}`, multiplier: amount, label: unit.toUpperCase() };
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Reduce an XLSX three-tier pack to a comparable total in a normalized unit.
 * Missing parse evidence is intentionally unknown rather than guessed.
 */
export function normalizePackGeometry(geometry: SourcePackGeometry): PackCompatibilityResult {
  const unit = normalizeUnit(geometry.baseUnit);
  if (!unit || !isPositiveFinite(geometry.caseQuantity)) {
    return {
      status: 'unknown',
      reason: 'complete parsed pack geometry and base unit are required',
      normalizedUnit: unit?.label ?? null,
      totalBaseUnits: null,
    };
  }
  const innerPackQuantity = isPositiveFinite(geometry.innerPackQuantity) ? geometry.innerPackQuantity : 1;
  const baseUnitQuantity = isPositiveFinite(geometry.baseUnitQuantity) ? geometry.baseUnitQuantity : 1;
  return {
    status: 'compatible',
    reason: '',
    normalizedUnit: unit.label,
    totalBaseUnits: geometry.caseQuantity * innerPackQuantity * baseUnitQuantity * unit.multiplier,
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
    return {
      status: 'unknown',
      reason: 'the existing source mapping lacks complete pack evidence',
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