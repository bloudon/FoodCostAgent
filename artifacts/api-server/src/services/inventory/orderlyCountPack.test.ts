import { describe, expect, it } from 'vitest';
import { derivePhysicalCountPack } from './orderlyCountPack';

describe('physical count pack from retained Orderly evidence', () => {
  it.each([
    ['24/2 OZ', 'OZ', 2, 24, 48],
    ['1/250 ML', 'ML', 250, 1, 250],
    ['6/700 ML', 'ML', 700, 6, 4200],
    ['1/5 LB', 'OZ', 80, 1, 80],
    ['1/6 EA', 'EA', 1, 6, 6],
    ['12/1 750ML', 'ML', 750, 12, 9000],
    ['1/1 750ML', 'ML', 750, 1, 750],
    ['1/24 EA', 'EA', 1, 24, 24],
  ])('%s counts physical packages rather than measurement units', (raw, unit, size, count, total) => {
    expect(derivePhysicalCountPack(raw)).toMatchObject({
      canonicalUnit: unit, containerSize: size, casePkgCount: count, caseSize: total,
    });
  });

  it.each(['1/1 Case', '12/1 Case', '', 'junk', '1/0 OZ'])('holds unknown pack %s', raw => {
    expect(derivePhysicalCountPack(raw)).toBeNull();
  });
  it('carries actual inner-package size without using it as the count', () => {
    expect(derivePhysicalCountPack('24/2 OZ')).toMatchObject({ sourceSizeLabel: '2 oz', casePkgCount: 24 });
    expect(derivePhysicalCountPack('1/250 ML')).toMatchObject({ sourceSizeLabel: '250 mL', casePkgCount: 1 });
    expect(derivePhysicalCountPack('1/6 EA')).toMatchObject({ sourceSizeLabel: null, casePkgCount: 6 });
  });
  it('retains explicitly named can and keg shapes', () => {
    expect(derivePhysicalCountPack('6/1 #10 CAN')).toMatchObject({ casePkgCount: 6, explicitLabel: 'can' });
    expect(derivePhysicalCountPack('1/1 KEG 5.16G')).toMatchObject({ casePkgCount: 1, explicitLabel: 'keg' });
  });
});