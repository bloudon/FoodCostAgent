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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('each');
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
      expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('each');
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
    expect(p.unit).toBe('lb.');
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
    expect(wings.unit).toBe('lb.');
    expect(wings.innerPackRaw).toBe('each');

    // Row 1 — LB unit, no weight → untouched
    const flour = guide.products[1];
    expect(flour.eaPerCase).toBeUndefined();
    expect(flour.unit).toBe('lb.');

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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('oz');
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
    expect(p.unit).toBe('lb.');
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
    expect(p.unit).toBe('lb.');
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

// ─── PFS (Performance Foodservice) vendor mapping ────────────────────────────

describe('PFS vendor mapping', () => {
  it('detects PFS format and parses EA-order row — cheesecake 1/4 Lb', async () => {
    const csv = [
      'Custom Product Description,Product Description,Brand,StateOfOrigin,Domestic,Custom Product Number,Product Number,Pack Size,UOM,Price,Last Purchase (qty & date)',
      ',"Cheesecake New York 10"" 16 Count Frozen",Sweet Encore,,No,,CV009,1/4 Lb,EA,$37.48,1 EA 05/21/2026',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfs' });
    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];
    expect(p.vendorSku).toBe('CV009');
    expect(p.caseSize).toBe(1);
    expect(p.innerPack).toBe(4);
    expect(p.unit).toBe('lb.');
    expect(p.price).toBeCloseTo(37.48);
    expect(p.brandName).toBe('Sweet Encore');
  });

  it('parses CS-order row — 48/6 Oz hoagie rolls', async () => {
    const csv = [
      'Custom Product Description,Product Description,Brand,StateOfOrigin,Domestic,Custom Product Number,Product Number,Pack Size,UOM,Price,Last Purchase (qty & date)',
      ',"Roll Hoagie White Unsliced 12"" Approximately 8 Bag 6 Per Bag Frozen",Roma,,No,,FC340,48/6 Oz,CS,$40.36,1 CS 04/23/2026',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfs' });
    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];
    expect(p.vendorSku).toBe('FC340');
    expect(p.caseSize).toBe(48);
    expect(p.innerPack).toBe(6);
    expect(p.unit).toBe('oz');
    expect(p.price).toBeCloseTo(40.36);
  });

  it('detects variable weight from $/lb price suffix', async () => {
    const csv = [
      'Custom Product Description,Product Description,Brand,StateOfOrigin,Domestic,Custom Product Number,Product Number,Pack Size,UOM,Price,Last Purchase (qty & date)',
      ',Cheese Mozzarella Whole Milk Loaf Refrigerated,Leprino Foods,,No,398513,AMV14,8/6 Lb,CS,$2.65/lb,2 CS 05/21/2026',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfs' });
    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];
    expect(p.isVariableWeight).toBe(true);
    expect(p.price).toBeCloseTo(2.65);
    expect(p.vendorSku).toBe('AMV14');
    expect(p.caseSize).toBe(8);
    expect(p.innerPack).toBe(6);
    expect(p.unit).toBe('lb.');
  });

  it('parses #10Can pack size — 6/#10Can mushrooms', async () => {
    const csv = [
      'Custom Product Description,Product Description,Brand,StateOfOrigin,Domestic,Custom Product Number,Product Number,Pack Size,UOM,Price,Last Purchase (qty & date)',
      ',Mushroom Pieces And Stem 68 Ounce Drained Weight,Roma,,No,231802,CK270,6/#10Can,CS,$62.82,1 CS 05/21/2026',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfs' });
    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];
    expect(p.vendorSku).toBe('CK270');
    expect(p.caseSize).toBe(6);
    expect(p.innerPack).toBe(10);
  });

  it('auto-strips 8-row metadata header and finds real column headers', async () => {
    const csv = [
      'Performance Foodservice',
      'Order Guide',
      'Wsp 117 Valrico (PFS Orlando - 03549)',
      '3327 Lithia Pinecrest Rd',
      'Westshore Pizza',
      'Valrico FL 33596',
      'Area Manager: David Whisler',
      '',
      'Custom Product Description,Product Description,Brand,StateOfOrigin,Domestic,Custom Product Number,Product Number,Pack Size,UOM,Price,Last Purchase (qty & date)',
      ',Soda Coke Classic 2 Liter Plastic Bottle,Coca Cola,,No,,75096,8/2 L,CS,$24.76,1 CS 05/21/2026',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfs' });
    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];
    expect(p.vendorSku).toBe('75096');
    expect(p.caseSize).toBe(8);
    expect(p.innerPack).toBe(2);
  });

  it('uses Custom Product Description as description when non-empty', async () => {
    const csv = [
      'Custom Product Description,Product Description,Brand,StateOfOrigin,Domestic,Custom Product Number,Product Number,Pack Size,UOM,Price,Last Purchase (qty & date)',
      '"My Custom Name","Crust Pizza 12"" Gluten Free  Partial Baked Frozen",Elaines,,No,5671901,AMG84,20/7.13,CS,$73.24,1 CS 04/16/2026',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfs' });
    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];
    expect(p.description).toBe('My Custom Name');
    expect(p.vendorProductName).toContain('Crust Pizza');
  });

  it('parses 1/5 Gal pack size', async () => {
    const csv = [
      'Custom Product Description,Product Description,Brand,StateOfOrigin,Domestic,Custom Product Number,Product Number,Pack Size,UOM,Price,Last Purchase (qty & date)',
      ',Beverage Syrup Coca Cola Classic Bag In Box Coke,Coca Cola,,No,,28372,1/5 Gal,CS,$143.20,',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfs' });
    const p = guide.products[0];
    expect(p.caseSize).toBe(1);
    expect(p.innerPack).toBe(5);
    expect(p.unit).toBe('gal');
  });
});

// ─── SOFO Foods vendor mapping ────────────────────────────────────────────────

describe('SOFO Foods vendor mapping', () => {
  it('detects SOFO format — Pack=6, Size=1 LB', async () => {
    const csv = 'Item,Pack,Size,Brand,Description,Price\n20108,6,1 LB,BELLISSIMO,CHEESE MOZZ FRESH LOG SLC 26CT,4.64';
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'sofo' });
    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];
    expect(p.vendorSku).toBe('20108');
    expect(p.caseSize).toBe(6);
    expect(p.innerPack).toBe(1);
    expect(p.unit).toBe('lb.');
    expect(p.price).toBeCloseTo(4.64);
    expect(p.brandName).toBe('BELLISSIMO');
  });

  it('parses Pack=6, Size=6 LB (36 lb case)', async () => {
    const csv = 'Item,Pack,Size,Brand,Description,Price\n20344,6,6 LB,VANTAGGIO,CHEESE MOZZ WISC DICED WM,2.13';
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'sofo' });
    const p = guide.products[0];
    expect(p.caseSize).toBe(6);
    expect(p.innerPack).toBe(6);
    expect(p.unit).toBe('lb.');
    expect(p.price).toBeCloseTo(2.13);
  });

  it('parses #10 can size — Pack=6, Size=#10', async () => {
    const csv = 'Item,Pack,Size,Brand,Description,Price\n190183,6,#10,SAPORITO,SAUCE PIZZA W/FRESH BASIL,46.27';
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'sofo' });
    const p = guide.products[0];
    expect(p.vendorSku).toBe('190183');
    expect(p.caseSize).toBe(6);
    expect(p.unit).toBe('each');
    expect(p.price).toBeCloseTo(46.27);
  });

  it('parses BSHL (bushel) unit', async () => {
    const csv = 'Item,Pack,Size,Brand,Description,Price\n260520,1,BSHL,SOFO IMPERIAL,PEPPERS GREEN JUMBO,29.72';
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'sofo' });
    const p = guide.products[0];
    expect(p.caseSize).toBe(1);
    expect(p.unit).toBe('bu.');
    expect(p.price).toBeCloseTo(29.72);
  });

  it('parses OZ size — Pack=6, Size=48 OZ', async () => {
    const csv = 'Item,Pack,Size,Brand,Description,Price\n90721,6,48 OZ,BELLISSIMO,CHEESE RICOTTA WM,2.26';
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'sofo' });
    const p = guide.products[0];
    expect(p.caseSize).toBe(6);
    expect(p.innerPack).toBe(48);
    expect(p.unit).toBe('oz');
    expect(p.price).toBeCloseTo(2.26);
  });

  it('parses CT unit — Pack=50, Size=50 CT', async () => {
    const csv = 'Item,Pack,Size,Brand,Description,Price\n890759,50,50 CT,JOVIALS,CUP SOUFFLE 2OZ BLK,24.86';
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'sofo' });
    const p = guide.products[0];
    expect(p.caseSize).toBe(50);
    expect(p.innerPack).toBe(50);
    expect(p.unit).toBe('each');
    expect(p.price).toBeCloseTo(24.86);
  });

  it('handles trailing empty columns from Excel export', async () => {
    const csv = 'Item,Pack,Size,Brand,Description,Price,,,,,,,,,,\n30135,2,4 LB,SOFO,CHEESE CHED FNCY SHRD,3.05,,,,,,,,,,';
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'sofo' });
    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];
    expect(p.vendorSku).toBe('30135');
    expect(p.caseSize).toBe(2);
    expect(p.innerPack).toBe(4);
    expect(p.unit).toBe('lb.');
    expect(p.price).toBeCloseTo(3.05);
  });

  it('parses plain decimal price (no $ prefix)', async () => {
    const csv = 'Item,Pack,Size,Brand,Description,Price\n170065,2,5 LB,MARGHERITA,PEPPERONI PEPATO 38MM CUPPING SLC,5.08';
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'sofo' });
    const p = guide.products[0];
    expect(p.price).toBeCloseTo(5.08);
  });
});

// ─── Ben E. Keith (BEK) vendor mapping ───────────────────────────────────────

describe('BEK vendor mapping', () => {
  it('parses split Pack + Size — Pack=6, Size="5 LB"', async () => {
    const csv = [
      'Item Number,Description,Pack,Size,UOM,Your Price,Brand,Category',
      'BEK001,CHEESE MOZZARELLA WHOLE MILK LOAF,6,5 LB,CS,$28.75,GRANDE,Dairy',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'bek' });
    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];
    expect(p.vendorSku).toBe('BEK001');
    expect(p.vendorProductName).toContain('CHEESE MOZZARELLA');
    expect(p.caseSize).toBe(6);
    expect(p.innerPack).toBe(5);
    expect(p.unit).toBe('lb.');
    expect(p.price).toBeCloseTo(28.75);
    expect(p.brandName).toBe('GRANDE');
  });

  it('parses Pack=12, Size="32 OZ"', async () => {
    const csv = [
      'Item Number,Description,Pack,Size,UOM,Your Price,Brand,Category',
      'BEK002,SALSA CHUNKY MILD,12,32 OZ,CS,$34.20,PACE,Condiments',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'bek' });
    const p = guide.products[0];
    expect(p.vendorSku).toBe('BEK002');
    expect(p.caseSize).toBe(12);
    expect(p.innerPack).toBe(32);
    expect(p.unit).toBe('oz');
    expect(p.price).toBeCloseTo(34.20);
  });

  it('parses #10 can size — Pack=6, Size="#10"', async () => {
    const csv = [
      'Item Number,Description,Pack,Size,UOM,Your Price,Brand,Category',
      'BEK003,TOMATOES DICED CANNED,6,#10,CS,$46.50,REDPACK,Canned Goods',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'bek' });
    const p = guide.products[0];
    expect(p.vendorSku).toBe('BEK003');
    expect(p.caseSize).toBe(6);
    // #10 resolves to a can (each) unit
    expect(p.unit).toBe('each');
    expect(p.price).toBeCloseTo(46.50);
  });

  it('parses dollar-sign price prefix', async () => {
    const csv = [
      'Item Number,Description,Pack,Size,UOM,Your Price,Brand,Category',
      'BEK004,BUTTER UNSALTED SOLID,36,1 LB,CS,$72.00,LAND O LAKES,Dairy',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'bek' });
    const p = guide.products[0];
    expect(p.price).toBeCloseTo(72.00);
    expect(p.caseSize).toBe(36);
    expect(p.innerPack).toBe(1);
    expect(p.unit).toBe('lb.');
  });

  it('parses Pack=1, Size="50 LB" (bulk bag)', async () => {
    const csv = [
      'Item Number,Description,Pack,Size,UOM,Your Price,Brand,Category',
      'BEK005,FLOUR ALL PURPOSE ENRICHED,1,50 LB,EA,$22.85,PILLSBURY,Dry Goods',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'bek' });
    const p = guide.products[0];
    expect(p.vendorSku).toBe('BEK005');
    expect(p.caseSize).toBe(1);
    expect(p.innerPack).toBe(50);
    expect(p.unit).toBe('lb.');
    expect(p.price).toBeCloseTo(22.85);
  });

  it('parses multiple rows and returns all products', async () => {
    const csv = [
      'Item Number,Description,Pack,Size,UOM,Your Price,Brand,Category',
      'BEK010,CHICKEN BREAST BONELESS,1,40 LB,EA,$89.50,PILGRIM\'S,Protein',
      'BEK011,OIL VEGETABLE SOYBEAN,6,1 GAL,CS,$38.40,ADMIRATION,Oils & Fats',
      'BEK012,NAPKINS DINNER WHITE 2PLY,3000,15 X 17,CS,$41.10,STANDARD,Supplies',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'bek' });
    expect(guide.products).toHaveLength(3);
    expect(guide.products[0].vendorSku).toBe('BEK010');
    expect(guide.products[1].vendorSku).toBe('BEK011');
    expect(guide.products[2].vendorSku).toBe('BEK012');
  });
});

// ─── Performance Food Group (PFG) vendor mapping ─────────────────────────────

describe('PFG vendor mapping', () => {
  it('parses compound Pack Size "6/5 LB"', async () => {
    const csv = [
      'Item Code,Item Description,Pack Size,UOM,Your Price,Brand,Category',
      'PFG001,CHEESE MOZZARELLA WHOLE MILK LOAF,6/5 LB,CS,$29.10,GRANDE,Dairy',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfg' });
    expect(guide.products).toHaveLength(1);
    const p = guide.products[0];
    expect(p.vendorSku).toBe('PFG001');
    expect(p.vendorProductName).toContain('CHEESE MOZZARELLA');
    expect(p.caseSize).toBe(6);
    expect(p.innerPack).toBe(5);
    expect(p.unit).toBe('lb.');
    expect(p.price).toBeCloseTo(29.10);
    expect(p.brandName).toBe('GRANDE');
  });

  it('parses compound Pack Size "12/32 OZ"', async () => {
    const csv = [
      'Item Code,Item Description,Pack Size,UOM,Your Price,Brand,Category',
      'PFG002,SALSA MEDIUM CHUNKY,12/32 OZ,CS,$36.00,PACE,Condiments',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfg' });
    const p = guide.products[0];
    expect(p.vendorSku).toBe('PFG002');
    expect(p.caseSize).toBe(12);
    expect(p.innerPack).toBe(32);
    expect(p.unit).toBe('oz');
    expect(p.price).toBeCloseTo(36.00);
  });

  it('parses compound Pack Size "24/1 CS" (case-pack items)', async () => {
    const csv = [
      'Item Code,Item Description,Pack Size,UOM,Your Price,Brand,Category',
      'PFG003,GLOVES NITRILE MEDIUM,24/1 CS,CS,$4.25,CARDINAL,Supplies',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfg' });
    const p = guide.products[0];
    expect(p.vendorSku).toBe('PFG003');
    expect(p.caseSize).toBe(24);
    expect(p.innerPack).toBe(1);
  });

  it('parses Extended Description field into description', async () => {
    const csv = [
      'Item Code,Item Description,Extended Description,Pack Size,UOM,Your Price,Brand,Category',
      'PFG004,CHICKEN BREAST RAW,Customer Custom Name,1/40 LB,CS,$92.00,PILGRIM\'S,Protein',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfg' });
    const p = guide.products[0];
    expect(p.vendorSku).toBe('PFG004');
    expect(p.description).toBe('Customer Custom Name');
    expect(p.caseSize).toBe(1);
    expect(p.innerPack).toBe(40);
    expect(p.unit).toBe('lb.');
    expect(p.price).toBeCloseTo(92.00);
  });

  it('parses dollar-sign price prefix', async () => {
    const csv = [
      'Item Code,Item Description,Pack Size,UOM,Your Price,Brand,Category',
      'PFG005,FLOUR ALL PURPOSE,1/50 LB,EA,$23.50,PILLSBURY,Dry Goods',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfg' });
    const p = guide.products[0];
    expect(p.price).toBeCloseTo(23.50);
    expect(p.caseSize).toBe(1);
    expect(p.innerPack).toBe(50);
    expect(p.unit).toBe('lb.');
  });

  it('parses compound Pack Size "6/#10 CAN"', async () => {
    const csv = [
      'Item Code,Item Description,Pack Size,UOM,Your Price,Brand,Category',
      'PFG006,TOMATOES CRUSHED,6/#10 CAN,CS,$52.75,ESCALON,Canned Goods',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfg' });
    const p = guide.products[0];
    expect(p.vendorSku).toBe('PFG006');
    expect(p.caseSize).toBe(6);
    expect(p.innerPack).toBe(10);
  });

  it('parses multiple rows and returns all products', async () => {
    const csv = [
      'Item Code,Item Description,Pack Size,UOM,Your Price,Brand,Category',
      'PFG010,OIL OLIVE EXTRA VIRGIN,6/1 GAL,CS,$68.00,BERTOLLI,Oils',
      'PFG011,BEEF GROUND 80/20,1/10 LB,EA,$34.50,GROUND,Protein',
      'PFG012,SALT KOSHER,6/3 LB,CS,$18.00,DIAMOND,Dry Goods',
    ].join('\n');
    const guide = await CsvOrderGuide.parse(csv, { vendorKey: 'pfg' });
    expect(guide.products).toHaveLength(3);
    expect(guide.products[0].vendorSku).toBe('PFG010');
    expect(guide.products[1].vendorSku).toBe('PFG011');
    expect(guide.products[2].vendorSku).toBe('PFG012');
  });
});
