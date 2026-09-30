import { describe, expect, it } from 'vitest';
import type { InventoryImportRow } from '@workspace/db';
import { assessCountUnitEvidence } from './countUnitEvidence';

const item = { id: 'cheese', name: 'American Yellow Sliced', unit: 'lb' };

function source(overrides: Record<string, unknown> = {}) {
  return {
    rowIndex: 4179,
    rawData: { 'Pack Size': '1/5 LB', 'Total Units': 5 },
    caseQuantity: 1, innerPackQuantity: 5, baseUnitQuantity: 1, baseUnit: 'LB',
    countUnit1: 'Case', countUnit2: 'Pack', countUnit3: ' LB', count1: 1, count2: 0, count3: 0, totalUnits: 5,
    ...overrides,
  } as InventoryImportRow;
}

describe('dated count-unit evidence', () => {
  it('accepts an evidenced pound total as pounds, not as a case', () => {
    expect(assessCountUnitEvidence(source(), item)).toBeNull();
    expect(assessCountUnitEvidence(source({ count1: 0, count3: 3, totalUnits: 3,
      rawData: { 'Pack Size': '1/5 LB', 'Total Units': 3 } }), item)).toBeNull();
  });

  it('blocks relabeling 5 LB as 5 oz without a conversion, retaining the source number', () => {
    expect(assessCountUnitEvidence(source(), { ...item, unit: 'oz' })).toMatchObject({
      reason: 'unit_mismatch', sourceTotal: 5, sourceUnit: 'LB', savedUnit: 'oz', rowIndex: 4179,
    });
  });

  it('accepts a dated 30-EA case without using a newer 60-EA case', () => {
    expect(assessCountUnitEvidence(source({
      rawData: { 'Pack Size': '1/30 EA', 'Total Units': 30 }, innerPackQuantity: 30,
      baseUnit: 'EA', countUnit3: ' EA', totalUnits: 30,
    }), { ...item, unit: 'ea' })).toBeNull();
  });

  it('does not invent physical meaning for an opaque Case or contradictory source total', () => {
    expect(assessCountUnitEvidence(source({ rawData: { 'Pack Size': '1/1 Case', 'Total Units': 1 },
      innerPackQuantity: 1, baseUnit: 'CASE', countUnit3: ' Case', totalUnits: 1 }), { ...item, unit: 'ea' })?.reason)
      .toBe('unit_unverified');
    expect(assessCountUnitEvidence(source({ totalUnits: 1,
      rawData: { 'Pack Size': '1/5 LB', 'Total Units': 1 } }), item)?.reason).toBe('unit_unverified');
  });

  it('does not certify a numeric match when a positive tier is mislabeled', () => {
    expect(assessCountUnitEvidence(source({ countUnit1: 'Pack' }), item)?.reason).toBe('unit_unverified');
    expect(assessCountUnitEvidence(source({ count1: 0, count2: 1, countUnit2: 'Case',
      rawData: { 'Pack Size': '1/5 LB', 'Total Units': 5 } }), item)?.reason).toBe('unit_unverified');
  });

  it('does not save a positive tier with zero total or trust a changed parsed total', () => {
    expect(assessCountUnitEvidence(source({ totalUnits: 0, rawData: { 'Total Units': 0 } }), item)?.reason)
      .toBe('unit_unverified');
    expect(assessCountUnitEvidence(source({ rawData: { 'Total Units': 80 } }), item)?.reason)
      .toBe('unit_unverified');
    expect(assessCountUnitEvidence(source({ count1: 0, totalUnits: 0,
      rawData: { 'Total Units': 0 } }), item)).toBeNull();
  });
});