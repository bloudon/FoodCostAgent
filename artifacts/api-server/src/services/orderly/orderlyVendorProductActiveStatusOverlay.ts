/**
 * Read-only active-status overlay for an already-approved Orderly manifest.
 *
 * It deliberately does not alter classification or the frozen manifest. The
 * source export is currently insufficient to establish what `isActive=false`
 * means operationally, so this report exposes the raw status for PM review.
 */
import type { OrderlyAdoptionEvidenceManifest } from './orderlyVendorProductAdoptionManifest';

export type OrderlySourceActiveStatus = true | false | null;

export interface UnresolvedHarvillSourceCode {
  sourceCode: string;
  lineCount: number;
  dollars: number;
  earliestInvoiceDate: string | null;
  latestInvoiceDate: string | null;
}

interface CandidateStatusRow {
  packSizeId: string;
  sourceSku: string;
  status: OrderlySourceActiveStatus;
  action: 'CREATE_VENDOR_ITEM_AND_MAPPING' | 'CREATE_MAPPING_ONLY';
  supplierId: string;
  supplierName: string | null;
}

export interface ActiveStatusBucket {
  candidateCount: number;
  createVendorItemAndMappingCount: number;
  createMappingOnlyCount: number;
  vendors: Array<{
    supplierId: string;
    supplierName: string | null;
    candidateCount: number;
    createVendorItemAndMappingCount: number;
    createMappingOnlyCount: number;
  }>;
  harvill: {
    candidateCount: number;
    createVendorItemAndMappingCount: number;
    createMappingOnlyCount: number;
    currentlyUnresolvedSourceCodes: Array<
      UnresolvedHarvillSourceCode & { candidatePackSizeIds: string[] }
    >;
  };
}

export interface OrderlyActiveStatusOverlay {
  overlayFormat: 'orderly-active-status-overlay-v1';
  manifestId: string;
  manifestSha256: string;
  sourceStatusField: 'packSize.isActive';
  sourceStatusCoverage: {
    trueCount: number;
    falseCount: number;
    absentOrNullCount: number;
  };
  candidateStatusCoverage: {
    true: ActiveStatusBucket;
    false: ActiveStatusBucket;
    absentOrNull: ActiveStatusBucket;
  };
  investigationFinding: string;
  recommendedApplyTreatment: string[];
}

export class OrderlyActiveStatusOverlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderlyActiveStatusOverlayError';
  }
}

function normalizeCode(value: string): string {
  return value.trim().toLowerCase();
}

function packSizeStatusMap(specs: readonly unknown[]): {
  statuses: Map<string, OrderlySourceActiveStatus>;
  coverage: OrderlyActiveStatusOverlay['sourceStatusCoverage'];
} {
  const statuses = new Map<string, OrderlySourceActiveStatus>();
  let trueCount = 0;
  let falseCount = 0;
  let absentOrNullCount = 0;
  for (const rawSpec of specs) {
    if (!rawSpec || typeof rawSpec !== 'object' || Array.isArray(rawSpec)) {
      throw new OrderlyActiveStatusOverlayError('Source spec must be an object.');
    }
    const packSizes = (rawSpec as Record<string, unknown>).packSizes;
    if (!Array.isArray(packSizes)) {
      throw new OrderlyActiveStatusOverlayError('Source spec must contain a packSizes array.');
    }
    for (const rawPackSize of packSizes) {
      if (!rawPackSize || typeof rawPackSize !== 'object' || Array.isArray(rawPackSize)) {
        throw new OrderlyActiveStatusOverlayError('Source packSize must be an object.');
      }
      const packSize = rawPackSize as Record<string, unknown>;
      const id = packSize.id == null ? null : String(packSize.id).trim();
      const alternateId = packSize.packSizeId == null ? null : String(packSize.packSizeId).trim();
      if (!id) throw new OrderlyActiveStatusOverlayError('Source packSize is missing id.');
      if (alternateId && alternateId !== id) {
        throw new OrderlyActiveStatusOverlayError(`Source packSize id mismatch: id="${id}" packSizeId="${alternateId}".`);
      }
      if (statuses.has(id)) throw new OrderlyActiveStatusOverlayError(`Duplicate source packSize.id "${id}".`);
      const rawStatus = packSize.isActive;
      if (rawStatus != null && typeof rawStatus !== 'boolean') {
        throw new OrderlyActiveStatusOverlayError(`Source packSize "${id}" has non-boolean isActive.`);
      }
      const status = rawStatus ?? null;
      statuses.set(id, status);
      if (status === true) trueCount++;
      else if (status === false) falseCount++;
      else absentOrNullCount++;
    }
  }
  return { statuses, coverage: { trueCount, falseCount, absentOrNullCount } };
}

function emptyBucket(): ActiveStatusBucket {
  return {
    candidateCount: 0,
    createVendorItemAndMappingCount: 0,
    createMappingOnlyCount: 0,
    vendors: [],
    harvill: {
      candidateCount: 0,
      createVendorItemAndMappingCount: 0,
      createMappingOnlyCount: 0,
      currentlyUnresolvedSourceCodes: [],
    },
  };
}

function summarizeBucket(
  rows: CandidateStatusRow[],
  unresolvedHarvill: readonly UnresolvedHarvillSourceCode[],
): ActiveStatusBucket {
  const bucket = emptyBucket();
  bucket.candidateCount = rows.length;
  bucket.createVendorItemAndMappingCount = rows.filter(row => row.action === 'CREATE_VENDOR_ITEM_AND_MAPPING').length;
  bucket.createMappingOnlyCount = rows.filter(row => row.action === 'CREATE_MAPPING_ONLY').length;

  const vendors = new Map<string, CandidateStatusRow[]>();
  for (const row of rows) {
    const key = `${row.supplierId}\u0000${row.supplierName ?? ''}`;
    const grouped = vendors.get(key) ?? [];
    grouped.push(row);
    vendors.set(key, grouped);
  }
  bucket.vendors = [...vendors.values()]
    .map(group => ({
      supplierId: group[0].supplierId,
      supplierName: group[0].supplierName,
      candidateCount: group.length,
      createVendorItemAndMappingCount: group.filter(row => row.action === 'CREATE_VENDOR_ITEM_AND_MAPPING').length,
      createMappingOnlyCount: group.filter(row => row.action === 'CREATE_MAPPING_ONLY').length,
    }))
    .sort((a, b) => b.candidateCount - a.candidateCount || a.supplierId.localeCompare(b.supplierId));

  const harvillRows = rows.filter(row => row.supplierId === '32976');
  bucket.harvill.candidateCount = harvillRows.length;
  bucket.harvill.createVendorItemAndMappingCount = harvillRows.filter(row => row.action === 'CREATE_VENDOR_ITEM_AND_MAPPING').length;
  bucket.harvill.createMappingOnlyCount = harvillRows.filter(row => row.action === 'CREATE_MAPPING_ONLY').length;
  const packIdsByCode = new Map<string, string[]>();
  for (const row of harvillRows) {
    const key = normalizeCode(row.sourceSku);
    const packIds = packIdsByCode.get(key) ?? [];
    packIds.push(row.packSizeId);
    packIdsByCode.set(key, packIds);
  }
  bucket.harvill.currentlyUnresolvedSourceCodes = unresolvedHarvill
    .flatMap(code => {
      const packIds = packIdsByCode.get(normalizeCode(code.sourceCode));
      return packIds ? [{ ...code, candidatePackSizeIds: [...packIds].sort() }] : [];
    })
    .sort((a, b) => a.sourceCode.localeCompare(b.sourceCode));
  return bucket;
}

export function buildOrderlyActiveStatusOverlay(input: {
  manifest: OrderlyAdoptionEvidenceManifest;
  specs: readonly unknown[];
  unresolvedHarvillSourceCodes: readonly UnresolvedHarvillSourceCode[];
}): OrderlyActiveStatusOverlay {
  const { statuses, coverage } = packSizeStatusMap(input.specs);
  const rows: CandidateStatusRow[] = input.manifest.candidates.map(candidate => {
    const status = statuses.get(candidate.sourceIdentity.packSizeId);
    if (status === undefined) {
      throw new OrderlyActiveStatusOverlayError(
        `Frozen candidate packSize.id "${candidate.sourceIdentity.packSizeId}" is absent from the supplied source.`,
      );
    }
    return {
      packSizeId: candidate.sourceIdentity.packSizeId,
      sourceSku: candidate.sourceIdentity.sourceSku,
      status,
      action: candidate.vendorItemTarget.kind === 'existing'
        ? 'CREATE_MAPPING_ONLY'
        : 'CREATE_VENDOR_ITEM_AND_MAPPING',
      supplierId: candidate.sourceIdentity.supplierId,
      supplierName: candidate.sourceIdentity.supplierName,
    };
  });
  const trueRows = rows.filter(row => row.status === true);
  const falseRows = rows.filter(row => row.status === false);
  const absentRows = rows.filter(row => row.status === null);

  return {
    overlayFormat: 'orderly-active-status-overlay-v1',
    manifestId: input.manifest.manifestId,
    manifestSha256: input.manifest.manifestSha256,
    sourceStatusField: 'packSize.isActive',
    sourceStatusCoverage: coverage,
    candidateStatusCoverage: {
      true: summarizeBucket(trueRows, input.unresolvedHarvillSourceCodes),
      false: summarizeBucket(falseRows, input.unresolvedHarvillSourceCodes),
      absentOrNull: summarizeBucket(absentRows, input.unresolvedHarvillSourceCodes),
    },
    investigationFinding: [
      'The supplied export reports isActive=false for every source packSize.',
      'This observation alone does not establish whether false means discontinued, hidden, unavailable, or an export-context flag.',
      'Do not infer current purchasing availability or activate new FnB vendor products from this source field until Orderly semantics are evidenced.',
    ].join(' '),
    recommendedApplyTreatment: [
      'Keep the existing approved manifest unchanged.',
      'Do not create any new vendor_item as active based on the current export.',
      'Do not change an existing vendor_item active state when creating a mapping-only provenance link.',
      'Require a separately evidenced PM decision on Orderly isActive semantics before any APPLY design assigns active=0 or active=1 to newly created vendor items.',
    ],
  };
}