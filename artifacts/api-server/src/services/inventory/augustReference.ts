import type { InventoryImportRow } from '@workspace/db';

export type AugustSourceStatus =
  | 'comparable'
  | 'unresolved_unit'
  | 'unresolved_location'
  | 'duplicate_source'
  | 'unresolved_tiers'
  | 'unmatched_item';

export function normalizeAugustLocation(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function normalizeAugustUnit(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toLocaleLowerCase().replace(/\./g, '');
  const aliases: Record<string, string> = {
    each: 'ea', eaches: 'ea', piece: 'ea', pieces: 'ea',
    pound: 'lb', pounds: 'lb', lbs: 'lb',
    ounce: 'oz', ounces: 'oz',
  };
  return aliases[normalized] ?? normalized;
}

export interface AugustEvidenceRow extends Pick<InventoryImportRow,
  | 'rawData' | 'caseQuantity' | 'innerPackQuantity'
  | 'baseUnitQuantity' | 'baseUnit' | 'countUnit1' | 'count1'
  | 'countUnit2' | 'count2' | 'countUnit3' | 'count3' | 'totalUnits'
> {}

export interface UnitEvidence {
  quantity: number;
  sourceUnit: string;
  status: 'evidenced' | 'unresolved';
  explanation?: string;
}

/**
 * Reconstructs an Orderly row's dated quantity from its retained tier parts and
 * parsed pack geometry. The source total is only a consistency check; it never
 * supplies a unit on its own.
 */
export function assessAugustSourceQuantity(row: AugustEvidenceRow): UnitEvidence {
  const raw = row.rawData as Record<string, unknown> | null;
  const rawTotalValue = raw?.['Total Units'];
  const sourceTotal = Number(row.totalUnits);
  const rawTotal = Number(rawTotalValue);
  if (row.totalUnits == null || rawTotalValue == null ||
      (typeof rawTotalValue === 'string' && !rawTotalValue.trim())) {
    return { quantity: 0, sourceUnit: normalizeAugustUnit(row.countUnit3 || row.baseUnit), status: 'unresolved', explanation: 'The dated source total is blank; blank is not treated as zero.' };
  }
  if ([row.count1, row.count2, row.count3].some((quantity) => quantity == null)) {
    return { quantity: 0, sourceUnit: normalizeAugustUnit(row.countUnit3 || row.baseUnit), status: 'unresolved', explanation: 'One or more dated case/pack/base tier counts are blank; blank tiers are not treated as zero.' };
  }
  const tiers = [
    { quantity: Number(row.count1), label: normalizeAugustUnit(row.countUnit1), expected: 'case' },
    { quantity: Number(row.count2), label: normalizeAugustUnit(row.countUnit2), expected: 'pack' },
    { quantity: Number(row.count3), label: normalizeAugustUnit(row.countUnit3), expected: null },
  ];
  const sourceUnit = normalizeAugustUnit(row.countUnit3 || row.baseUnit);
  const baseUnit = normalizeAugustUnit(row.baseUnit);
  if (!Number.isFinite(sourceTotal) || sourceTotal < 0 ||
      !Number.isFinite(rawTotal) || Math.abs(rawTotal - sourceTotal) > 0.0001 * Math.max(1, Math.abs(sourceTotal))) {
    return { quantity: 0, sourceUnit, status: 'unresolved', explanation: 'Retained raw and parsed source totals are missing or inconsistent.' };
  }
  if (!sourceUnit || sourceUnit !== baseUnit) {
    return { quantity: 0, sourceUnit, status: 'unresolved', explanation: 'The dated base UOM and counted UOM do not establish one source unit.' };
  }
  if (tiers.some((tier) => tier.quantity > 0 && tier.expected && tier.label !== tier.expected)) {
    return { quantity: 0, sourceUnit, status: 'unresolved', explanation: 'A positive source tier has a missing or contradictory Case/Pack label.' };
  }
  if (tiers.some((tier) => !Number.isFinite(tier.quantity) || tier.quantity < 0)) {
    return { quantity: 0, sourceUnit, status: 'unresolved', explanation: 'A source tier quantity is invalid.' };
  }
  const base = Number(row.baseUnitQuantity);
  const inner = Number(row.innerPackQuantity);
  const cases = Number(row.caseQuantity);
  if (!Number.isFinite(base) || base <= 0) {
    return { quantity: 0, sourceUnit, status: 'unresolved', explanation: 'Dated base-unit pack quantity is absent or invalid.' };
  }
  if (tiers[2].quantity > 0 && (!Number.isFinite(base) || base <= 0)) {
    return { quantity: 0, sourceUnit, status: 'unresolved', explanation: 'Dated base-unit pack quantity is absent or invalid.' };
  }
  if (tiers[1].quantity > 0 && (!Number.isFinite(base) || base <= 0 || !Number.isFinite(inner) || inner <= 0)) {
    return { quantity: 0, sourceUnit, status: 'unresolved', explanation: 'Dated Pack tier geometry is absent or invalid.' };
  }
  if (tiers[0].quantity > 0 && (!Number.isFinite(base) || base <= 0 || !Number.isFinite(inner) || inner <= 0 || !Number.isFinite(cases) || cases <= 0)) {
    return { quantity: 0, sourceUnit, status: 'unresolved', explanation: 'Dated Case tier geometry is absent or invalid.' };
  }
  const implied = tiers[0].quantity * cases * inner * base +
    tiers[1].quantity * inner * base +
    tiers[2].quantity * base;
  if (!Number.isFinite(implied) || Math.abs(implied - sourceTotal) > 0.0001 * Math.max(1, Math.abs(sourceTotal))) {
    return { quantity: 0, sourceUnit, status: 'unresolved', explanation: `Dated tiers and pack imply ${implied}, not the retained total ${sourceTotal}.` };
  }
  return { quantity: implied, sourceUnit, status: 'evidenced' };
}

export function sourceToCanonicalFactor(
  sourceUnit: string,
  itemUnit: string,
  sourceUnitKind?: string | null,
  itemUnitKind?: string | null,
): number | null {
  const source = normalizeAugustUnit(sourceUnit);
  const canonical = normalizeAugustUnit(itemUnit);
  if (!source || !canonical) return null;
  if (source === canonical) return 1;
  if (sourceUnitKind !== 'weight' || itemUnitKind !== 'weight') return null;
  if (source === 'lb' && canonical === 'oz') return 16;
  if (source === 'oz' && canonical === 'lb') return 1 / 16;
  return null;
}

export function hasPhysicalCountEvidence(line: {
  quantity: number;
  hasEntry: boolean;
  caseQty: number | null;
  containerQty: number | null;
  looseUnits: number | null;
}): boolean {
  return line.hasEntry ||
    line.quantity !== 0 ||
    line.caseQty != null ||
    line.containerQty != null ||
    line.looseUnits != null;
}

// The retained Bay Hill draft contains September test/unknown entries that
// predate the operator's August-reading handoff. They are preserved, but cannot
// establish that a value was physically measured on August 31. A fresh save
// after the handoff is required before the read-only comparison shows a delta.
export const AUGUST_READING_HANDOFF = new Date('2026-09-29T00:00:00.000Z');

export function hasConfirmedAugustEntry(enteredAt: Date | string | null | undefined): boolean {
  if (!enteredAt) return false;
  const timestamp = new Date(enteredAt).getTime();
  return Number.isFinite(timestamp) && timestamp >= AUGUST_READING_HANDOFF.getTime();
}
