import { describe, expect, it } from 'vitest';
import { buildOrderlyActiveStatusOverlay } from './orderlyVendorProductActiveStatusOverlay';
import type { OrderlyAdoptionEvidenceManifest } from './orderlyVendorProductAdoptionManifest';

const manifest = {
  manifestId: 'manifest-1',
  manifestSha256: 'hash-1',
  candidates: [
    {
      sourceIdentity: {
        sourceSystem: 'ORDERLY',
        sourcePropertyId: '24472',
        packSizeId: 'p-active',
        specId: 's-1',
        supplierId: '32976',
        supplierName: 'Harvill',
        sourceSku: 'BAN1',
        normalizedSku: 'ban1',
      },
      vendorItemTarget: { kind: 'proposed' },
    },
    {
      sourceIdentity: {
        sourceSystem: 'ORDERLY',
        sourcePropertyId: '24472',
        packSizeId: 'p-inactive',
        specId: 's-2',
        supplierId: '40',
        supplierName: 'Sysco',
        sourceSku: 'SKU2',
        normalizedSku: 'sku2',
      },
      vendorItemTarget: { kind: 'existing' },
    },
  ],
} as unknown as OrderlyAdoptionEvidenceManifest;

describe('Orderly active-status overlay', () => {
  it('separates source statuses without changing frozen candidate membership', () => {
    const overlay = buildOrderlyActiveStatusOverlay({
      manifest,
      specs: [{
        packSizes: [
          { id: 'p-active', packSizeId: 'p-active', isActive: true },
          { id: 'p-inactive', packSizeId: 'p-inactive', isActive: false },
          { id: 'unrelated', packSizeId: 'unrelated' },
        ],
      }],
      unresolvedHarvillSourceCodes: [{
        sourceCode: 'BAN1',
        lineCount: 2,
        dollars: 10,
        earliestInvoiceDate: '2026-08-01',
        latestInvoiceDate: '2026-08-17',
      }],
    });

    expect(overlay.sourceStatusCoverage).toEqual({
      trueCount: 1,
      falseCount: 1,
      absentOrNullCount: 1,
    });
    expect(overlay.candidateStatusCoverage.true).toMatchObject({
      candidateCount: 1,
      createVendorItemAndMappingCount: 1,
      harvill: {
        candidateCount: 1,
        currentlyUnresolvedSourceCodes: [expect.objectContaining({ sourceCode: 'BAN1' })],
      },
    });
    expect(overlay.candidateStatusCoverage.false).toMatchObject({
      candidateCount: 1,
      createMappingOnlyCount: 1,
    });
  });

  it('fails closed if a frozen packSize identity is absent from the source', () => {
    expect(() => buildOrderlyActiveStatusOverlay({
      manifest,
      specs: [{ packSizes: [{ id: 'p-active', isActive: true }] }],
      unresolvedHarvillSourceCodes: [],
    })).toThrow(/absent/i);
  });
});