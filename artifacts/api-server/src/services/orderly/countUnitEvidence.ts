import type { InventoryImportRow } from '@workspace/db';

export type CountUnitFinding = {
  rowIndex: number;
  inventoryItemId: string;
  inventoryItemName: string;
  sourcePack: string | null;
  sourceUnit: string | null;
  savedUnit: string | null;
  sourceTotal: number | null;
  reason: 'unit_mismatch' | 'unit_unverified';
  detail: string;
};

type SourceRow = Pick<InventoryImportRow,
  'rowIndex' | 'rawData' | 'caseQuantity' | 'innerPackQuantity' |
  'baseUnitQuantity' | 'baseUnit' | 'countUnit3' | 'count1' |
  'countUnit1' | 'countUnit2' | 'count2' | 'count3' | 'totalUnits'
>;

function normalized(unit: string | null | undefined): string {
  const value = unit?.trim().toLowerCase() ?? '';
  return ({ each: 'ea', pound: 'lb', pounds: 'lb', ounce: 'oz', ounces: 'oz' } as Record<string, string>)[value] ?? value;
}

/** A source total is evidence of a unit only when its dated tiers and pack produce that total. */
export function assessCountUnitEvidence(
  row: SourceRow,
  item: { id: string; name: string; unit: string | null } | undefined,
): CountUnitFinding | null {
  const raw = row.rawData as Record<string, unknown> | null;
  const sourcePack = typeof raw?.['Pack Size'] === 'string' ? raw['Pack Size'] : null;
  const sourceUnit = normalized(row.countUnit3);
  const baseUnit = normalized(row.baseUnit);
  const savedUnit = normalized(item?.unit);
  const base = { rowIndex: row.rowIndex, inventoryItemId: item?.id ?? '', inventoryItemName: item?.name ?? 'Unknown item',
    sourcePack, sourceUnit: row.countUnit3?.trim() ?? null, savedUnit: item?.unit ?? null, sourceTotal: row.totalUnits };
  const unverified = (detail: string): CountUnitFinding => ({ ...base, reason: 'unit_unverified', detail });

  if (!row.totalUnits || row.totalUnits <= 0) {
    return (row.count1 ?? 0) > 0 || (row.count2 ?? 0) > 0 || (row.count3 ?? 0) > 0
      ? unverified('Positive count tiers have no positive source total.')
      : null;
  }
  const rawTotal = Number(raw?.['Total Units']);
  if (raw?.['Total Units'] == null || !Number.isFinite(rawTotal) ||
      Math.abs(rawTotal - row.totalUnits) > 0.0001 * Math.max(1, Math.abs(rawTotal))) {
    return unverified('Raw source total is missing or differs from the parsed total.');
  }
  const { caseQuantity: cases, innerPackQuantity: inner, baseUnitQuantity: quantity } = row;
  if (((row.count1 ?? 0) > 0 && normalized(row.countUnit1) !== 'case') ||
      ((row.count2 ?? 0) > 0 && normalized(row.countUnit2) !== 'pack')) {
    return unverified('Positive case/pack tier has a missing or contradictory dated tier label.');
  }
  if (!sourceUnit || !baseUnit || !savedUnit || sourceUnit === 'case' ||
      baseUnit === 'case' || sourceUnit !== baseUnit ||
      !cases || !inner || !quantity || cases <= 0 || inner <= 0 || quantity <= 0) {
    return unverified('Case/Pack/UOM tier or dated pack does not establish a measured source unit.');
  }
  const implied = (row.count1 ?? 0) * cases * inner * quantity +
    (row.count2 ?? 0) * inner * quantity + (row.count3 ?? 0) * quantity;
  if (!Number.isFinite(implied) ||
      Math.abs(implied - row.totalUnits) > 0.0001 * Math.max(1, Math.abs(row.totalUnits))) {
    return unverified(`Dated pack and tiers imply ${implied}, but the source total is ${row.totalUnits}.`);
  }
  if (sourceUnit !== savedUnit) {
    return { ...base, reason: 'unit_mismatch',
      detail: `Source total is in ${row.countUnit3?.trim()}; the item would save the same number as ${item?.unit}. No conversion is authorized.` };
  }
  return null;
}