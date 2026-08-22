import { normalizeForMatch } from './OrderlyMatcher';
import type { SourcePackGeometry } from './packGeometry';

export const ORDERLY_ALTERNATE_ID_PREFIX = 'ALT|';

export interface OrderlyIdentityGroup {
  key: string;
  alternateSourceId: string | null;
  normalizedName: string;
  packKey: string;
  rowIndexes: number[];
}

function normalizedNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'null';
  return Number(value.toFixed(6)).toString();
}

function normalizedPackUnit(value: string | null | undefined): string {
  const normalized = normalizeForMatch(value ?? '');
  return normalized || 'null';
}

/**
 * Stable, inspectable pack evidence for an Orderly alternate source identity.
 * Nulls are explicit so incomplete geometry never aliases complete geometry.
 */
export function canonicalOrderlyPackKey(geometry: SourcePackGeometry): string {
  return [
    `case=${normalizedNumber(geometry.caseQuantity)}`,
    `inner=${normalizedNumber(geometry.innerPackQuantity)}`,
    `base=${normalizedNumber(geometry.baseUnitQuantity)}`,
    `unit=${normalizedPackUnit(geometry.baseUnit)}`,
  ].join('|');
}

export function normalizeOrderlyProductName(value: string | null | undefined): string {
  return normalizeForMatch(value ?? '');
}

/**
 * Derived identities are source identities only. They must be scoped by the
 * existing ORDERLY + source-property mapping columns at persistence time.
 */
export function deriveOrderlyAlternateSourceId(
  cleanedDescription: string | null | undefined,
  geometry: SourcePackGeometry,
): string | null {
  const normalizedName = normalizeOrderlyProductName(cleanedDescription);
  if (!normalizedName) return null;
  return `${ORDERLY_ALTERNATE_ID_PREFIX}${normalizedName}|${canonicalOrderlyPackKey(geometry)}`;
}

export function buildOrderlyIdentityGroup(
  row: Pick<{ rowIndex: number; cleanedDescription: string | null; caseQuantity: number | null; innerPackQuantity: number | null; baseUnitQuantity: number | null; baseUnit: string | null }, 'rowIndex' | 'cleanedDescription' | 'caseQuantity' | 'innerPackQuantity' | 'baseUnitQuantity' | 'baseUnit'>,
): OrderlyIdentityGroup | null {
  const normalizedName = normalizeOrderlyProductName(row.cleanedDescription);
  if (!normalizedName) return null;
  const geometry = {
    caseQuantity: row.caseQuantity,
    innerPackQuantity: row.innerPackQuantity,
    baseUnitQuantity: row.baseUnitQuantity,
    baseUnit: row.baseUnit,
  };
  const packKey = canonicalOrderlyPackKey(geometry);
  return {
    key: `${normalizedName}|${packKey}`,
    alternateSourceId: deriveOrderlyAlternateSourceId(normalizedName, geometry),
    normalizedName,
    packKey,
    rowIndexes: [row.rowIndex],
  };
}
