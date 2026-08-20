/**
 * Read-only evidence freeze for Orderly vendor-product adoption.
 *
 * This module does not call the database and does not perform catalog writes.
 * It converts a reviewed preview into a deterministic safe-candidate manifest
 * and defines the revalidation outcomes a future, separately-authorized APPLY
 * implementation must enforce.
 */
import { createHash } from 'node:crypto';
import type {
  AdoptionClassificationResult,
  AdoptionClassifierSummary,
} from './orderlyVendorProductAdoptionClassifier';
import type {
  OrderlyVendorProductAdoptionPreviewReport,
} from './orderlyVendorProductAdoptionPreview';

const SAFE_CLASSES = new Set([
  'safe_new_vendor_product',
  'safe_same_vendor_alternate_product',
  'mapping_only_gap',
]);

const CANONICALIZATION_METHOD = [
  'orderly-logical-relationship-v1',
  'Project each normalized source relationship to explicit identity, raw-pack, and normalized-geometry fields.',
  'Sort projected relationships by source-property, packSize identity, supplier, SKU, and spec ID.',
  'Recursively sort object keys before UTF-8 JSON serialization; preserve explicit nulls.',
].join(' ');

type JsonPrimitive = string | number | boolean | null;

export type ManifestRevalidationOutcome =
  | 'CREATE_VENDOR_ITEM_AND_MAPPING'
  | 'CREATE_MAPPING_ONLY'
  | 'ALREADY_SATISFIED'
  | 'DRIFTED_HOLD';

export interface OrderlyAdoptionFrozenCandidate {
  sourceIdentity: {
    sourceSystem: 'ORDERLY';
    sourcePropertyId: string;
    packSizeId: string;
    specId: string;
    supplierId: string;
    supplierName: string | null;
    sourceSku: string;
    normalizedSku: string;
  };
  rawPackEvidence: {
    packSizeDesc: string | null;
    pack: JsonPrimitive;
    size: JsonPrimitive;
    uom: string | null;
    derivedRawPackString: string | null;
  };
  normalizedPackGeometry: {
    outerCount: number | null;
    innerSize: number | null;
    normalizedUom: string | null;
  };
  resolvedVendorId: string;
  canonicalInventoryItemId: string;
  classification: 'safe_new_vendor_product' | 'safe_same_vendor_alternate_product' | 'mapping_only_gap';
  vendorItemTarget:
    | { kind: 'existing'; vendorItemId: string }
    | {
      kind: 'proposed';
      logicalIdentity: {
        vendorId: string;
        inventoryItemId: string;
        vendorSku: string | null;
        caseSize: number | null;
        innerPackSize: number | null;
        packUom: string | null;
      };
    };
  proposedProvenanceMapping: {
    sourceSystem: string;
    sourcePropertyId: string;
    sourceExternalId: string;
    identityKind: 'packSizeId';
  };
}

export interface OrderlyAdoptionEvidenceManifest {
  manifestFormat: 'orderly-adoption-evidence-manifest-v1';
  manifestId: string;
  manifestSha256: string;
  sourceSystem: 'ORDERLY';
  sourcePropertyId: string;
  rawSourceFileSha256: string | null;
  canonicalSourceFingerprint: string;
  canonicalizationMethod: string;
  reviewedCatalogFingerprint: OrderlyVendorProductAdoptionPreviewReport['mutationCheck'];
  candidateCount: number;
  candidateClassCounts: {
    createVendorItemAndMapping: number;
    createMappingOnly: number;
  };
  candidates: OrderlyAdoptionFrozenCandidate[];
  heldPopulationSummary: {
    packGeometryConflictCount: number;
    missingCanonicalInventoryIdentityCount: number;
    otherwiseHeldCount: number;
    conflictingSourceIdentityCount: number;
    otherwiseHeldReasons: Array<{ reason: string; count: number }>;
  };
  revalidationRules: string[];
}

export class OrderlyAdoptionManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderlyAdoptionManifestError';
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value === undefined ? null : value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function scalar(value: unknown): JsonPrimitive {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  return String(value);
}

function sourceIdentitySortKey(relationship: AdoptionClassificationResult): string {
  const entry = relationship.entry;
  return [
    entry.packSizeId ?? entry.fallbackIdentity?.key ?? '',
    entry.supplierId ?? '',
    entry.normalizedSku ?? '',
    entry.specId,
  ].join('\u0000');
}

function logicalSourceRelationship(relationship: AdoptionClassificationResult) {
  const entry = relationship.entry;
  return {
    sourceSystem: 'ORDERLY',
    sourcePropertyId: relationship.proposedMapping?.sourcePropertyId
      ?? entry.fallbackIdentity?.sourcePropertyId
      ?? '24472',
    packSizeIdentity: entry.packSizeId ?? entry.fallbackIdentity?.key ?? null,
    specId: entry.specId,
    supplierId: entry.supplierId,
    supplierName: entry.supplierName,
    sourceSku: entry.resolvedSku,
    normalizedSku: entry.normalizedSku,
    rawPackEvidence: {
      packSizeDesc: entry.packSizeDesc,
      pack: scalar(entry.pack),
      size: scalar(entry.size),
      uom: entry.uom,
      derivedRawPackString: entry.normalizedPackGeometry.rawPackString,
    },
    normalizedPackGeometry: {
      outerCount: entry.normalizedPackGeometry.outerCount,
      innerSize: entry.normalizedPackGeometry.innerSize,
      normalizedUom: entry.normalizedPackGeometry.normalizedUom,
    },
  };
}

export function canonicalSourceFingerprint(
  classifier: Pick<AdoptionClassifierSummary, 'relationships'>,
): string {
  const relationships = [...classifier.relationships]
    .sort((a, b) => sourceIdentitySortKey(a).localeCompare(sourceIdentitySortKey(b)))
    .map(logicalSourceRelationship);
  return sha256(canonicalJson({
    format: 'orderly-logical-relationship-v1',
    relationships,
  }));
}

function freezeCandidate(relationship: AdoptionClassificationResult): OrderlyAdoptionFrozenCandidate {
  const entry = relationship.entry;
  if (
    !entry.packSizeId
    || !entry.supplierId
    || !entry.resolvedSku
    || !entry.normalizedSku
    || !relationship.resolvedVendorId
    || !relationship.inferredCanonicalItemId
    || !relationship.proposedMapping
  ) {
    throw new OrderlyAdoptionManifestError(
      `Safe relationship "${entry.packSizeId ?? entry.specId}" lacks required immutable source or target identity.`,
    );
  }
  if (relationship.proposedMapping.identityKind !== 'packSizeId') {
    throw new OrderlyAdoptionManifestError(
      `Safe relationship "${entry.packSizeId}" uses fallback identity; this reviewed population requires packSize.id.`,
    );
  }
  if (!SAFE_CLASSES.has(relationship.classification)) {
    throw new OrderlyAdoptionManifestError(`Cannot freeze non-safe class "${relationship.classification}".`);
  }

  const vendorItemTarget = relationship.existingVendorItemId
    ? { kind: 'existing' as const, vendorItemId: relationship.existingVendorItemId }
    : relationship.proposedVendorItem
      ? {
        kind: 'proposed' as const,
        logicalIdentity: {
          vendorId: relationship.proposedVendorItem.vendorId,
          inventoryItemId: relationship.proposedVendorItem.inventoryItemId,
          vendorSku: relationship.proposedVendorItem.vendorSku,
          caseSize: relationship.proposedVendorItem.caseSize,
          innerPackSize: relationship.proposedVendorItem.innerPackSize,
          packUom: relationship.proposedVendorItem.packUom,
        },
      }
      : null;
  if (!vendorItemTarget) {
    throw new OrderlyAdoptionManifestError(
      `Safe relationship "${entry.packSizeId}" has neither an existing nor proposed vendor item.`,
    );
  }

  return {
    sourceIdentity: {
      sourceSystem: 'ORDERLY',
      sourcePropertyId: relationship.proposedMapping.sourcePropertyId,
      packSizeId: entry.packSizeId,
      specId: entry.specId,
      supplierId: entry.supplierId,
      supplierName: entry.supplierName,
      sourceSku: entry.resolvedSku,
      normalizedSku: entry.normalizedSku,
    },
    rawPackEvidence: {
      packSizeDesc: entry.packSizeDesc,
      pack: scalar(entry.pack),
      size: scalar(entry.size),
      uom: entry.uom,
      derivedRawPackString: entry.normalizedPackGeometry.rawPackString,
    },
    normalizedPackGeometry: {
      outerCount: entry.normalizedPackGeometry.outerCount,
      innerSize: entry.normalizedPackGeometry.innerSize,
      normalizedUom: entry.normalizedPackGeometry.normalizedUom,
    },
    resolvedVendorId: relationship.resolvedVendorId,
    canonicalInventoryItemId: relationship.inferredCanonicalItemId,
    classification: relationship.classification as OrderlyAdoptionFrozenCandidate['classification'],
    vendorItemTarget,
    proposedProvenanceMapping: {
      sourceSystem: relationship.proposedMapping.sourceSystem,
      sourcePropertyId: relationship.proposedMapping.sourcePropertyId,
      sourceExternalId: relationship.proposedMapping.sourceExternalId,
      identityKind: 'packSizeId',
    },
  };
}

function otherwiseHeldReasons(relationships: readonly AdoptionClassificationResult[]) {
  const counts = new Map<string, number>();
  for (const relationship of relationships) {
    if (relationship.classification !== 'otherwise_held') continue;
    for (const reason of relationship.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function createOrderlyAdoptionEvidenceManifest(input: {
  report: OrderlyVendorProductAdoptionPreviewReport;
  rawSourceFileSha256: string | null;
}): OrderlyAdoptionEvidenceManifest {
  const { report } = input;
  if (report.sourceSystem !== 'ORDERLY' || report.sourcePropertyId !== '24472') {
    throw new OrderlyAdoptionManifestError('Manifest generation requires the approved ORDERLY property 24472 preview.');
  }
  if (!report.mutationCheck.unchanged || report.applyGate.status !== 'PM_HELD') {
    throw new OrderlyAdoptionManifestError('Manifest generation requires an unchanged, PM-held read-only preview.');
  }

  const candidates = report.classifier.relationships
    .filter(relationship => SAFE_CLASSES.has(relationship.classification))
    .sort((a, b) => sourceIdentitySortKey(a).localeCompare(sourceIdentitySortKey(b)))
    .map(freezeCandidate);
  const createVendorItemAndMapping = candidates.filter(candidate => candidate.vendorItemTarget.kind === 'proposed').length;
  const createMappingOnly = candidates.filter(candidate => candidate.vendorItemTarget.kind === 'existing').length;
  const core = {
    manifestFormat: 'orderly-adoption-evidence-manifest-v1' as const,
    sourceSystem: 'ORDERLY' as const,
    sourcePropertyId: report.sourcePropertyId,
    rawSourceFileSha256: input.rawSourceFileSha256,
    canonicalSourceFingerprint: canonicalSourceFingerprint(report.classifier),
    canonicalizationMethod: CANONICALIZATION_METHOD,
    reviewedCatalogFingerprint: report.mutationCheck,
    candidateCount: candidates.length,
    candidateClassCounts: { createVendorItemAndMapping, createMappingOnly },
    candidates,
    heldPopulationSummary: {
      packGeometryConflictCount: report.classifier.classCounts.pack_geometry_conflict,
      missingCanonicalInventoryIdentityCount: report.classifier.classCounts.missing_canonical_inventory_identity,
      otherwiseHeldCount: report.classifier.classCounts.otherwise_held,
      conflictingSourceIdentityCount: report.classifier.classCounts.conflicting_source_identity,
      otherwiseHeldReasons: otherwiseHeldReasons(report.classifier.relationships),
    },
    revalidationRules: [
      'Require the expected ORDERLY property and exact manifest ID/hash.',
      'Recompute the canonical logical source fingerprint from a fresh source preview; refuse all APPLY if it differs.',
      'Run a fresh current-DB preview and revalidate every manifest candidate independently.',
      'Allow only CREATE_VENDOR_ITEM_AND_MAPPING, CREATE_MAPPING_ONLY, or ALREADY_SATISFIED outcomes; any mismatch is DRIFTED_HOLD.',
      'Never create inventory items, vendors, prices, price-history observations, or invoice-line resolutions.',
      'Do not mutate held classes or source relationships absent from this manifest.',
    ],
  };
  const manifestSha256 = sha256(canonicalJson(core));
  return {
    ...core,
    manifestId: `orderly-adoption-evidence-v1:${manifestSha256}`,
    manifestSha256,
  };
}

function candidateKey(candidate: OrderlyAdoptionFrozenCandidate): string {
  return `${candidate.sourceIdentity.sourcePropertyId}|${candidate.sourceIdentity.packSizeId}`;
}

function manifestCore(manifest: OrderlyAdoptionEvidenceManifest) {
  const { manifestId: _manifestId, manifestSha256: _manifestSha256, ...core } = manifest;
  return core;
}

export function verifyOrderlyAdoptionEvidenceManifest(
  manifest: OrderlyAdoptionEvidenceManifest,
): boolean {
  const expectedHash = sha256(canonicalJson(manifestCore(manifest)));
  return manifest.manifestSha256 === expectedHash
    && manifest.manifestId === `orderly-adoption-evidence-v1:${expectedHash}`;
}

export function revalidateOrderlyAdoptionEvidenceManifest(input: {
  manifest: OrderlyAdoptionEvidenceManifest;
  currentReport: OrderlyVendorProductAdoptionPreviewReport;
}): {
  manifestIntegrityValid: boolean;
  sourceFingerprintMatches: boolean;
  outcomes: Array<{ packSizeId: string; outcome: ManifestRevalidationOutcome; reason: string }>;
} {
  const { manifest, currentReport } = input;
  const manifestIntegrityValid = verifyOrderlyAdoptionEvidenceManifest(manifest);
  if (!manifestIntegrityValid) {
    return {
      manifestIntegrityValid,
      sourceFingerprintMatches: false,
      outcomes: manifest.candidates.map(candidate => ({
        packSizeId: candidate.sourceIdentity.packSizeId,
        outcome: 'DRIFTED_HOLD' as const,
        reason: 'Manifest ID or deterministic hash does not match its content.',
      })),
    };
  }
  const sourceFingerprintMatches =
    manifest.sourceSystem === currentReport.sourceSystem
    && manifest.sourcePropertyId === currentReport.sourcePropertyId
    && manifest.canonicalSourceFingerprint === canonicalSourceFingerprint(currentReport.classifier);
  if (!sourceFingerprintMatches) {
    return {
      manifestIntegrityValid,
      sourceFingerprintMatches,
      outcomes: manifest.candidates.map(candidate => ({
        packSizeId: candidate.sourceIdentity.packSizeId,
        outcome: 'DRIFTED_HOLD' as const,
        reason: 'Canonical logical source fingerprint differs from the reviewed manifest.',
      })),
    };
  }

  const currentByKey = new Map(
    currentReport.classifier.relationships.map(relationship => [
      `${currentReport.sourcePropertyId}|${relationship.entry.packSizeId ?? ''}`,
      relationship,
    ]),
  );
  return {
    manifestIntegrityValid,
    sourceFingerprintMatches,
    outcomes: manifest.candidates.map(candidate => {
      const current = currentByKey.get(candidateKey(candidate));
      if (!current) {
        return { packSizeId: candidate.sourceIdentity.packSizeId, outcome: 'DRIFTED_HOLD' as const, reason: 'Source relationship is absent from fresh preview.' };
      }
      if (current.classification === 'already_present') {
        return { packSizeId: candidate.sourceIdentity.packSizeId, outcome: 'ALREADY_SATISFIED' as const, reason: 'Fresh preview confirms vendor item and mapping already exist.' };
      }
      if (!SAFE_CLASSES.has(current.classification)) {
        return { packSizeId: candidate.sourceIdentity.packSizeId, outcome: 'DRIFTED_HOLD' as const, reason: `Fresh preview now classifies the relationship as ${current.classification}.` };
      }
      const frozen = canonicalJson(freezeCandidate(current));
      if (frozen !== canonicalJson(candidate)) {
        return { packSizeId: candidate.sourceIdentity.packSizeId, outcome: 'DRIFTED_HOLD' as const, reason: 'Fresh DB classification or target identity differs from reviewed manifest.' };
      }
      const outcome = candidate.vendorItemTarget.kind === 'existing'
        ? 'CREATE_MAPPING_ONLY' as const
        : 'CREATE_VENDOR_ITEM_AND_MAPPING' as const;
      return { packSizeId: candidate.sourceIdentity.packSizeId, outcome, reason: 'Fresh preview exactly matches reviewed evidence.' };
    }),
  };
}