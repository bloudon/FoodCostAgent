import { parseOrderlyPackSize } from '../orderly/OrderlyParser';
import { normalizePackUnit, toCatalogPackGeometry } from '../orderly/packGeometry';

export type PhysicalCountPack = {
  canonicalUnit: string;
  containerSize: number;
  casePkgCount: number;
  caseSize: number;
  explicitLabel: 'can' | 'keg' | null;
  sourceSizeLabel: string | null;
};

function describeSourceSize(quantity: number, unit: string): string {
  const normalized = unit.toUpperCase();
  const name = normalized === 'ML' ? 'mL' : normalized === 'LT' ? 'L' : normalized.toLowerCase();
  return `${quantity.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${name}`;
}

/**
 * Orderly's two-tier measured notation (24/2 OZ) describes 24 packages of
 * 2 oz, NOT 48 packages of 1 oz. Its normalized source geometry is still
 * suitable for costing, but not for naming physical count parts.
 */
export function derivePhysicalCountPack(raw: string): PhysicalCountPack | null {
  const pack = raw.trim();
  const parsed = parseOrderlyPackSize(pack);
  if (parsed.packParseStatus !== 'ok') return null;

  const twoTier = pack.match(/^([\d,]+(?:\.\d+)?)\s*\/\s*([\d,]+(?:\.\d+)?)\s+([a-z]+)$/i);
  if (twoTier) {
    const outer = Number(twoTier[1].replace(/,/g, ''));
    const inner = Number(twoTier[2].replace(/,/g, ''));
    const unit = normalizePackUnit(twoTier[3]);
    if (!unit || !Number.isFinite(outer) || !Number.isFinite(inner) || outer <= 0 || inner <= 0) return null;
    // "1/6 EA" counts six individual each, but "1/250 ML" counts one
    // physical 250-mL package. Neither rule asserts a bottle/bag shape.
    const containerSize = unit.dimension === 'each' ? 1 : inner * unit.multiplier;
    const casePkgCount = unit.dimension === 'each' ? outer * inner * unit.multiplier : outer;
    const caseSize = containerSize * casePkgCount;
    if (![containerSize, casePkgCount, caseSize].every(v => Number.isFinite(v) && v > 0)) return null;
    return {
      canonicalUnit: unit.label, containerSize, casePkgCount, caseSize, explicitLabel: null,
      sourceSizeLabel: unit.dimension === 'each'
        ? null : describeSourceSize(inner, twoTier[3]),
    };
  }

  // 1/1 Case has no physical content evidence. Counted "Case" notation
  // likewise cannot name the item-level package; do not invent one.
  if (/\bcase\s*$/i.test(pack)) return null;
  const geometry = toCatalogPackGeometry(parsed);
  if (!geometry) return null;
  return {
    ...geometry,
    explicitLabel: /#10(?:\s*can)?\s*$/i.test(pack) ? 'can' :
      /\bkeg\b/i.test(pack) ? 'keg' : null,
    sourceSizeLabel: normalizePackUnit(parsed.baseUnit)?.dimension === 'each'
      ? null : describeSourceSize(parsed.baseUnitQuantity!, parsed.baseUnit!),
  };
}