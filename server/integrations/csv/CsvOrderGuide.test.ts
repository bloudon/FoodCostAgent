import { describe, it, expect } from 'vitest';
import { CsvOrderGuide } from './CsvOrderGuide';

/**
 * Helpers to build minimal CSV strings for testing.
 */
function buildCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.join(',');
  const dataLines = rows.map(r => r.join(','));
  return [headerLine, ...dataLines].join('\n');
}

/**
 * All parse() calls use vendorKey: 'generic' so the vendor-specific column
 * mapping is never applied; every column is supplied via columnMapping instead.
 */
const GENERIC_OPTS = { vendorKey: 'generic' as const };

// ─── parseCaseWeightLbs (via EA+LB derivation) ───────────────────────────────

describe('parseCaseWeightLbs — tested through the EA+LB derivation path', () => {
  it('accepts a bare number (assumes LB for weight-designated columns)', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight', 'Price'],
      [['SKU001', 'Test Item', '24', 'EA', '18', '9.99']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
        price: 'Price',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeCloseTo(18 / 24);
    expect(p.unit).toBe('LB');
  });

  it('accepts "18 LB" (number + LB suffix)', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight', 'Price'],
      [['SKU001', 'Test Item', '24', 'EA', '18 LB', '9.99']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
        price: 'Price',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeCloseTo(0.75);
    expect(p.unit).toBe('LB');
  });

  it('accepts "18 LBS" (LBS plural suffix)', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '18 LBS']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeCloseTo(0.75);
  });

  it('accepts "18 POUNDS" (full word)', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '18 POUNDS']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeCloseTo(0.75);
  });

  it('converts OZ weight to LB and derives eaPerCase', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '18 OZ']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    // 18 OZ → 1.125 LB total; 1.125 / 24 = 0.046875 LB/each
    expect(p.eaPerCase).toBeCloseTo(0.046875);
    expect(p.unit).toBe('LB');
  });

  it('converts OUNCE (singular) weight to LB and derives eaPerCase', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '18 OUNCE']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    // 18 OUNCE → 1.125 LB total; 1.125 / 24 = 0.046875 LB/each
    expect(p.eaPerCase).toBeCloseTo(0.046875);
    expect(p.unit).toBe('LB');
  });

  it('converts OUNCES (plural) weight to LB and derives eaPerCase', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '18 OUNCES']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    // 18 OUNCES → 1.125 LB total; 1.125 / 24 = 0.046875 LB/each
    expect(p.eaPerCase).toBeCloseTo(0.046875);
    expect(p.unit).toBe('LB');
  });

  it('converts KG weight to LB and derives eaPerCase', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '8 KG']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    // 8 KG → 17.63696 LB total; 17.63696 / 24 ≈ 0.734873 LB/each
    expect(p.eaPerCase).toBeCloseTo(17.63696 / 24);
    expect(p.unit).toBe('LB');
  });

  it('converts KGS (plural) weight to LB and derives eaPerCase', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '8 KGS']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    // 8 KGS → 17.63696 LB total; 17.63696 / 24 ≈ 0.734873 LB/each
    expect(p.eaPerCase).toBeCloseTo(17.63696 / 24);
    expect(p.unit).toBe('LB');
  });

  it('converts KILOGRAM (singular) weight to LB and derives eaPerCase', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '8 KILOGRAM']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    // 8 KILOGRAM → 17.63696 LB total; 17.63696 / 24 ≈ 0.734873 LB/each
    expect(p.eaPerCase).toBeCloseTo(17.63696 / 24);
    expect(p.unit).toBe('LB');
  });

  it('converts KILOGRAMS (plural) weight to LB and derives eaPerCase', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '8 KILOGRAMS']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    // 8 KILOGRAMS → 17.63696 LB total; 17.63696 / 24 ≈ 0.734873 LB/each
    expect(p.eaPerCase).toBeCloseTo(17.63696 / 24);
    expect(p.unit).toBe('LB');
  });

  it('accepts "18 POUND" (singular full word)', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '18 POUND']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeCloseTo(0.75);
    expect(p.unit).toBe('LB');
  });

  it('converts G (grams) weight to LB and derives eaPerCase', async () => {
    // 500 G ÷ 453.592 ≈ 1.10231 LB total; ÷ 24 EA ≈ 0.04593 LB/each
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '500 G']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeCloseTo(500 / 453.592 / 24);
    expect(p.unit).toBe('LB');
  });

  it('returns null / skips derivation for zero weight value', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '0']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeUndefined();
  });

  it('returns null / skips derivation for empty weight string', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeUndefined();
    expect(p.unit).toBe('EA');
  });
});

// ─── isCountUnit (via EA+LB derivation trigger) ──────────────────────────────

describe('isCountUnit — only EA-like units trigger per-each derivation', () => {
  const COUNT_UNITS = ['EA', 'each', 'EACH', 'unit', 'UNIT', 'units', 'UNITS',
    'piece', 'PIECE', 'pieces', 'PIECES', 'pc', 'PC', 'pcs', 'PCS', 'ct', 'CT',
    'count', 'COUNT'];

  for (const uom of COUNT_UNITS) {
    it(`triggers derivation for UOM="${uom}"`, async () => {
      const csv = buildCsv(
        ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
        [['SKU001', 'Test Item', '24', uom, '18 LB']],
      );
      const guide = await CsvOrderGuide.parse(csv, {
        ...GENERIC_OPTS,
        columnMapping: {
          vendorSku: 'SKU',
          productName: 'Name',
          caseSize: 'Pack',
          unit: 'UOM',
          caseWeight: 'Weight',
        },
      });
      const p = guide.products[0];
      expect(p.eaPerCase).toBeCloseTo(0.75);
      expect(p.unit).toBe('LB');
    });
  }

  const NON_COUNT_UNITS = ['LB', 'OZ', 'KG', 'CS', 'CS', 'case', 'CASE', 'GAL', 'ML', 'L'];

  for (const uom of NON_COUNT_UNITS) {
    it(`does NOT trigger derivation for UOM="${uom}"`, async () => {
      const csv = buildCsv(
        ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
        [['SKU001', 'Test Item', '24', uom, '18 LB']],
      );
      const guide = await CsvOrderGuide.parse(csv, {
        ...GENERIC_OPTS,
        columnMapping: {
          vendorSku: 'SKU',
          productName: 'Name',
          caseSize: 'Pack',
          unit: 'UOM',
          caseWeight: 'Weight',
        },
      });
      const p = guide.products[0];
      expect(p.eaPerCase).toBeUndefined();
    });
  }
});

// ─── Core integration scenario ────────────────────────────────────────────────

describe('EA+LB derivation — core integration scenario', () => {
  it('caseSize=24, unit=EA, weight=18 → eaPerCase=0.75, innerPack=0.75, unit=LB, innerPackRaw=each', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight', 'Price'],
      [['SKU001', 'Chicken Breast', '24', 'EA', '18', '45.00']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
        price: 'Price',
      },
    });

    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];

    expect(p.eaPerCase).toBeCloseTo(0.75);
    expect(p.innerPack).toBeCloseTo(0.75);
    expect(p.unit).toBe('LB');
    expect(p.innerPackRaw).toBe('each');

    // Core fields still present
    expect(p.caseSize).toBe(24);
    expect(p.vendorSku).toBe('SKU001');
    expect(p.price).toBeCloseTo(45.0);
  });

  it('derives correctly with decimal result (caseSize=12, weight=9 → 0.75)', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU002', 'Salmon Fillet', '12', 'EA', '9 LB']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeCloseTo(0.75);
    expect(p.innerPack).toBeCloseTo(0.75);
    expect(p.unit).toBe('LB');
    expect(p.innerPackRaw).toBe('each');
  });

  it('derives correctly for non-round result (caseSize=8, weight=13 → 1.625)', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU003', 'Strip Steak', '8', 'EA', '13 LB']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeCloseTo(1.625);
    expect(p.unit).toBe('LB');
    expect(p.innerPackRaw).toBe('each');
  });
});

// ─── No regression when weight column is absent ───────────────────────────────

describe('rows without a weight column are unaffected', () => {
  it('EA item without weight column keeps unit=EA, eaPerCase undefined', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Price'],
      [['SKU001', 'Paper Cups', '500', 'EA', '12.00']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        price: 'Price',
        // no caseWeight mapping supplied
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeUndefined();
    expect(p.unit).toBe('EA');
    expect(p.caseSize).toBe(500);
  });

  it('LB item without weight column keeps unit=LB, eaPerCase undefined', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Price'],
      [['SKU002', 'Ground Beef', '40', 'LB', '95.00']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        price: 'Price',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeUndefined();
    expect(p.unit).toBe('LB');
  });

  it('multiple rows — only the EA+weight row gets derivation applied', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight', 'Price'],
      [
        ['SKU001', 'Chicken Wings', '24', 'EA', '18 LB', '40.00'],
        ['SKU002', 'Flour',         '50', 'LB', '',      '22.00'],
        ['SKU003', 'Plates',        '200','CS', '15 LB', '35.00'],
      ],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
        price: 'Price',
      },
    });

    expect(guide.products).toHaveLength(3);

    // Row 0 — EA + weight → derived
    const wings = guide.products[0];
    expect(wings.eaPerCase).toBeCloseTo(0.75);
    expect(wings.unit).toBe('LB');
    expect(wings.innerPackRaw).toBe('each');

    // Row 1 — LB unit, no weight → untouched
    const flour = guide.products[1];
    expect(flour.eaPerCase).toBeUndefined();
    expect(flour.unit).toBe('LB');

    // Row 2 — CS unit (excluded from isCountUnit) → derivation skipped even though weight present
    const plates = guide.products[2];
    expect(plates.eaPerCase).toBeUndefined();
    expect(plates.unit).toBe('CS');
  });
});

// ─── Zero / invalid caseSize guard ────────────────────────────────────────────

describe('edge cases — invalid caseSize prevents derivation', () => {
  it('caseSize=0 — derivation skipped to avoid divide-by-zero', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '0', 'EA', '18 LB']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeUndefined();
  });

  it('missing caseSize — derivation skipped', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '', 'EA', '18 LB']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeUndefined();
  });
});

// ─── parseCaseWeightLbs — invalid / unrecognised inputs skip derivation ──────

describe('parseCaseWeightLbs — invalid inputs skip derivation', () => {
  const INVALID_WEIGHTS = ['N/A', 'n/a', 'TBD', 'abc', '??', '--', 'none', 'null'];

  for (const bad of INVALID_WEIGHTS) {
    it(`"${bad}" — derivation skipped (eaPerCase undefined)`, async () => {
      const csv = buildCsv(
        ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
        [['SKU001', 'Test Item', '24', 'EA', bad]],
      );
      const guide = await CsvOrderGuide.parse(csv, {
        ...GENERIC_OPTS,
        columnMapping: {
          vendorSku: 'SKU',
          productName: 'Name',
          caseSize: 'Pack',
          unit: 'UOM',
          caseWeight: 'Weight',
        },
      });
      const p = guide.products[0];
      expect(p.eaPerCase).toBeUndefined();
    });
  }

  it('negative number — derivation skipped', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '-5 LB']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeUndefined();
  });

  it('converts G (grams) weight to LB and derives eaPerCase (suffix coverage)', async () => {
    // Duplicate coverage via the suffix-test suite — 500 G → ~1.10231 LB ÷ 24 = ~0.04593 LB/each
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Test Item', '24', 'EA', '500 G']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    expect(p.eaPerCase).toBeCloseTo(500 / 453.592 / 24);
    expect(p.unit).toBe('LB');
  });
});

// ─── CS UOM override — compound measurement unit preferred over "CS" ───────────

describe('CS UOM in separate column — measurement unit from compound string wins', () => {
  it('"12/10 Oz" pack + UOM="CS" → unit=OZ, caseSize=12, innerPack=10 (not lb. fallback)', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack Size', 'UOM', 'Price'],
      [['PA312', 'Pretzel Bavarian Soft', '12/10 Oz', 'CS', '40.53']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack Size',
        unit: 'UOM',
        price: 'Price',
      },
    });
    const p = guide.products[0];
    expect(p.caseSize).toBe(12);
    expect(p.innerPack).toBe(10);
    // Measurement unit from compound string must win over "CS" ordering unit
    expect(p.unit).toBe('OZ');
    // EA+LB derivation must NOT fire (CS is not a count unit)
    expect(p.eaPerCase).toBeUndefined();
  });

  it('"6/5 LB" pack + UOM="CS" → unit=LB, caseSize=6, innerPack=5', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM'],
      [['SKU001', 'Butter Blend', '6/5 LB', 'CS']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
      },
    });
    const p = guide.products[0];
    expect(p.caseSize).toBe(6);
    expect(p.innerPack).toBe(5);
    expect(p.unit).toBe('LB');
  });
});

// ─── Compound pack string guard ────────────────────────────────────────────────

describe('compound pack string already provides inner-pack — weight column skipped', () => {
  it('"6/5 LB" in Pack column — weight column not used for EA derivation', async () => {
    const csv = buildCsv(
      ['SKU', 'Name', 'Pack', 'UOM', 'Weight'],
      [['SKU001', 'Butter', '6/5 LB', '', '30 LB']],
    );
    const guide = await CsvOrderGuide.parse(csv, {
      ...GENERIC_OPTS,
      columnMapping: {
        vendorSku: 'SKU',
        productName: 'Name',
        caseSize: 'Pack',
        unit: 'UOM',
        caseWeight: 'Weight',
      },
    });
    const p = guide.products[0];
    // innerPack=5 comes from compound string, not weight-derivation
    expect(p.eaPerCase).toBeUndefined();
    expect(p.caseSize).toBe(6);
    expect(p.innerPack).toBe(5);
    expect(p.unit).toBe('LB');
  });
});

// ─── extractNameCount — new pattern coverage ──────────────────────────────────

import { extractNameCount, hasNameCountSuspiciousRatio } from '../../services/orderGuideProcessor';

describe('extractNameCount — weight-based suffix patterns', () => {
  it('extracts count from "16 oz" suffix', () => {
    expect(extractNameCount('Ribeye Steak 16 oz')).toBe(16);
  });

  it('extracts count from "16 OZ" (uppercase)', () => {
    expect(extractNameCount('Sirloin 16 OZ')).toBe(16);
  });

  it('extracts count from "8 oz." (with trailing period)', () => {
    expect(extractNameCount('Chicken Breast 8 oz.')).toBe(8);
  });

  it('extracts count from "5 lb" suffix', () => {
    expect(extractNameCount('Ground Beef 5 lb')).toBe(5);
  });

  it('extracts count from "5 lb bag"', () => {
    expect(extractNameCount('Butter 5 lb bag')).toBe(5);
  });

  it('extracts count from "5 LB" (uppercase)', () => {
    expect(extractNameCount('Pork Shoulder 5 LB')).toBe(5);
  });

  it('extracts count from "5 lbs" (plural)', () => {
    expect(extractNameCount('Flour 5 lbs')).toBe(5);
  });

  it('extracts count from "10 pound" (full word)', () => {
    expect(extractNameCount('Salmon Fillet 10 pound')).toBe(10);
  });

  it('extracts count from "500 g" (gram abbreviation)', () => {
    expect(extractNameCount('Yogurt Cup 500 g')).toBe(500);
  });

  it('extracts count from "250 grams" (full word plural)', () => {
    expect(extractNameCount('Cheese Wedge 250 grams')).toBe(250);
  });

  it('extracts count from "100 gram" (full word singular)', () => {
    expect(extractNameCount('Smoked Salmon 100 gram')).toBe(100);
  });

  it('extracts count from "16 ounces" (full word plural)', () => {
    expect(extractNameCount('Cream Cheese 16 ounces')).toBe(16);
  });

  it('extracts count from "32 fl oz" (fluid ounce)', () => {
    expect(extractNameCount('Orange Juice 32 fl oz')).toBe(32);
  });

  it('extracts count from "32 FL OZ" (uppercase fluid ounce)', () => {
    expect(extractNameCount('Apple Cider 32 FL OZ')).toBe(32);
  });
});

describe('extractNameCount — "Box/Pack/Bag/Tray of N" patterns', () => {
  it('extracts count from "Box of 12"', () => {
    expect(extractNameCount('Dinner Rolls Box of 12')).toBe(12);
  });

  it('extracts count from "Pack of 24"', () => {
    expect(extractNameCount('Water Bottles Pack of 24')).toBe(24);
  });

  it('extracts count from "Bag of 6"', () => {
    expect(extractNameCount('Pretzel Buns Bag of 6')).toBe(6);
  });

  it('extracts count from "Tray of 48"', () => {
    expect(extractNameCount('Mini Muffins Tray of 48')).toBe(48);
  });

  it('extracts count from "BOX OF 12" (uppercase)', () => {
    expect(extractNameCount('Croissants BOX OF 12')).toBe(12);
  });

  it('returns null for "Box of 1" (count ≤ 1 is filtered)', () => {
    expect(extractNameCount('Sample Box of 1')).toBeNull();
  });
});

describe('extractNameCount — legacy count-unit patterns still work', () => {
  it('still extracts from "16 Slices"', () => {
    expect(extractNameCount('Cheesecake Strawberry Swirl 16 Slices Frozen')).toBe(16);
  });

  it('still extracts from "12 CT"', () => {
    expect(extractNameCount('Burger Buns 12 CT')).toBe(12);
  });

  it('still extracts from "24 Pcs"', () => {
    expect(extractNameCount('Dinner Rolls 24 Pcs')).toBe(24);
  });

  it('returns null for a plain product name with no hint', () => {
    expect(extractNameCount('Fresh Atlantic Salmon')).toBeNull();
  });

  it('returns null for count ≤ 1', () => {
    expect(extractNameCount('Single Serve 1 oz')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractNameCount(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractNameCount('')).toBeNull();
  });
});

describe('hasNameCountSuspiciousRatio — >5× detection', () => {
  it('flags nameCount=16, caseSize=2 (ratio=8, suspicious)', () => {
    expect(hasNameCountSuspiciousRatio(16, 2)).toBe(true);
  });

  it('flags nameCount=500, caseSize=24 (ratio≈20.8, suspicious)', () => {
    expect(hasNameCountSuspiciousRatio(500, 24)).toBe(true);
  });

  it('does NOT flag nameCount=16, caseSize=12 (ratio≈1.33, fine)', () => {
    expect(hasNameCountSuspiciousRatio(16, 12)).toBe(false);
  });

  it('does NOT flag nameCount=24, caseSize=24 (ratio=1, identical)', () => {
    expect(hasNameCountSuspiciousRatio(24, 24)).toBe(false);
  });

  it('flags nameCount=2, caseSize=12 (ratio=6, suspicious)', () => {
    expect(hasNameCountSuspiciousRatio(2, 12)).toBe(true);
  });

  it('returns false when nameCount is null', () => {
    expect(hasNameCountSuspiciousRatio(null, 12)).toBe(false);
  });

  it('returns false when caseSize is null', () => {
    expect(hasNameCountSuspiciousRatio(16, null)).toBe(false);
  });

  it('returns false when caseSize is 0', () => {
    expect(hasNameCountSuspiciousRatio(16, 0)).toBe(false);
  });

  it('boundary: ratio exactly 5 is NOT flagged (must be strictly >5)', () => {
    expect(hasNameCountSuspiciousRatio(10, 2)).toBe(false);
  });

  it('boundary: ratio of 5.1 IS flagged', () => {
    expect(hasNameCountSuspiciousRatio(51, 10)).toBe(true);
  });
});
