import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ResolutionPreviewResult,
  ReviewDecisionPayload,
  SavedReviewDecision,
} from './orderlyDomain';

export const ORDERLY_DECISION_MANIFEST_VERSION = 1 as const;
const SIGNATURE_ALGORITHM = 'HMAC-SHA256' as const;

export type OrderlyDecisionManifestErrorCode = 'INVALID_REQUEST' | 'CONFLICT';

export class OrderlyDecisionManifestError extends Error {
  constructor(
    public readonly code: OrderlyDecisionManifestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OrderlyDecisionManifestError';
  }
}

export interface OrderlyDecisionManifestBatch {
  batchId: string;
  companyId: string;
  sourceSystem: string;
  sourcePropertyId: string | null;
  targetStoreId: string | null;
  fileHash: string;
  originalFilename: string;
  parserVersion: string;
  inventoryDate: string | null;
  sourceRowCount: number;
  snapshotTotal: number | null;
}

export interface OrderlyDecisionManifestEvidence {
  sourceItemCode: string | null;
  description: string | null;
  packSizeRaw: string | null;
  sourcePackEvidence: unknown;
  candidatePackEvidence: unknown;
  strategy: string;
  confidence: string;
  matchedId: string | null;
  possibleRecode: boolean;
  possibleRecodeMatchedId: string | null;
  packCompatibility: string | null | undefined;
  recodeEvidenceClass: string | null | undefined;
  candidateItem: unknown;
  sourceDataConflict: unknown;
}

export interface OrderlyDecisionManifestDecision {
  rowIndex: number;
  decision: ReviewDecisionPayload;
  revision: number;
  evidence: OrderlyDecisionManifestEvidence;
}

export interface OrderlyDecisionManifest {
  manifestVersion: typeof ORDERLY_DECISION_MANIFEST_VERSION;
  exportedAt: string;
  batch: OrderlyDecisionManifestBatch;
  previewFingerprint: string;
  decisions: OrderlyDecisionManifestDecision[];
  integrity: {
    algorithm: typeof SIGNATURE_ALGORITHM;
    signature: string;
  };
}

type ManifestWithoutIntegrity = Omit<OrderlyDecisionManifest, 'integrity'>;

function signingKey(): string {
  const key = process.env.SESSION_SECRET?.trim();
  if (!key) {
    throw new OrderlyDecisionManifestError(
      'INVALID_REQUEST',
      'Decision manifest signing is not configured.',
    );
  }
  return key;
}

function canonicalize(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

function signature(value: ManifestWithoutIntegrity): string {
  return createHmac('sha256', signingKey()).update(canonicalize(value)).digest('hex');
}

function itemDetails(item: unknown): unknown {
  if (!item || typeof item !== 'object') return null;
  const candidate = item as Record<string, unknown>;
  return {
    id: candidate.id ?? null,
    name: candidate.name ?? null,
    internalItemNumber: candidate.internalItemNumber ?? null,
    pluSku: candidate.pluSku ?? null,
    caseSize: candidate.caseSize ?? null,
    knownLocations: candidate.knownLocations ?? null,
    comparableVariants: candidate.comparableVariants ?? null,
  };
}

function previewFingerprintInput(preview: ResolutionPreviewResult): unknown {
  return {
    batchId: preview.batchId,
    inventoryDate: preview.inventoryDate,
    totalRows: preview.totalRows,
    summary: preview.summary,
    newLocations: preview.newLocations,
    newVendors: preview.newVendors,
    recodeSummary: preview.recodeSummary,
    identitySummary: preview.identitySummary,
    rows: preview.rows,
  };
}

export function fingerprintOrderlyPreview(preview: ResolutionPreviewResult): string {
  return sha256(previewFingerprintInput(preview));
}

function evidenceForRow(
  row: ResolutionPreviewResult['rows'][number],
): OrderlyDecisionManifestEvidence {
  return {
    sourceItemCode: row.sourceItemCode,
    description: row.cleanedDescription,
    packSizeRaw: row.packSizeRaw,
    sourcePackEvidence: row.itemMatch.sourcePackEvidence ?? null,
    candidatePackEvidence: row.itemMatch.candidatePackEvidence ?? null,
    strategy: row.itemMatch.strategy,
    confidence: row.itemMatch.confidence,
    matchedId: row.itemMatch.matchedId,
    possibleRecode: row.itemMatch.possibleRecode === true,
    possibleRecodeMatchedId: row.itemMatch.possibleRecodeMatchedId ?? null,
    packCompatibility: row.itemMatch.packCompatibility ?? null,
    recodeEvidenceClass: row.itemMatch.recodeEvidenceClass ?? null,
    candidateItem: itemDetails((row.itemMatch as unknown as Record<string, unknown>).possibleRecodeItem),
    sourceDataConflict: row.itemMatch.sourceDataConflict ?? null,
  };
}

export function createOrderlyDecisionManifest(params: {
  batch: OrderlyDecisionManifestBatch;
  preview: ResolutionPreviewResult;
  decisions: SavedReviewDecision[];
  exportedAt?: string;
}): OrderlyDecisionManifest {
  const unsigned: ManifestWithoutIntegrity = {
    manifestVersion: ORDERLY_DECISION_MANIFEST_VERSION,
    exportedAt: params.exportedAt ?? new Date().toISOString(),
    batch: params.batch,
    previewFingerprint: fingerprintOrderlyPreview(params.preview),
    decisions: params.decisions.map(decision => {
      const row = params.preview.rows.find(candidate => candidate.rowIndex === decision.rowIndex);
      if (!row) {
        throw new OrderlyDecisionManifestError(
          'CONFLICT',
          `Saved review decision references row ${decision.rowIndex}, which is no longer part of this preview.`,
        );
      }
      return {
        rowIndex: decision.rowIndex,
        decision: decision.decision,
        revision: decision.revision,
        evidence: evidenceForRow(row),
      };
    }),
  };

  return {
    ...unsigned,
    integrity: {
      algorithm: SIGNATURE_ALGORITHM,
      signature: signature(unsigned),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OrderlyDecisionManifestError('INVALID_REQUEST', `Manifest field "${key}" is required.`);
  }
  return value;
}

function requiredNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new OrderlyDecisionManifestError(
      'INVALID_REQUEST',
      `Manifest field "${key}" must be a non-negative integer.`,
    );
  }
  return value as number;
}

function validateManifestShape(value: unknown): OrderlyDecisionManifest {
  if (!isRecord(value)) {
    throw new OrderlyDecisionManifestError('INVALID_REQUEST', 'Decision manifest must be a JSON object.');
  }
  if (value.manifestVersion !== ORDERLY_DECISION_MANIFEST_VERSION) {
    throw new OrderlyDecisionManifestError('INVALID_REQUEST', 'Unsupported Orderly decision manifest version.');
  }
  if (!isRecord(value.batch) || !isRecord(value.integrity) || !Array.isArray(value.decisions)) {
    throw new OrderlyDecisionManifestError('INVALID_REQUEST', 'Decision manifest is missing required sections.');
  }

  const batch = value.batch;
  const sourceRowCount = requiredNonNegativeInteger(batch, 'sourceRowCount');
  const snapshotTotal = batch.snapshotTotal;
  if (snapshotTotal !== null && (typeof snapshotTotal !== 'number' || !Number.isFinite(snapshotTotal))) {
    throw new OrderlyDecisionManifestError(
      'INVALID_REQUEST',
      'Manifest snapshotTotal must be a finite number or null.',
    );
  }
  const targetStoreId = batch.targetStoreId;
  if (targetStoreId !== null && typeof targetStoreId !== 'string') {
    throw new OrderlyDecisionManifestError('INVALID_REQUEST', 'Manifest targetStoreId must be a string or null.');
  }

  const integrity = value.integrity;
  const algorithm = requiredString(integrity, 'algorithm');
  const manifestSignature = requiredString(integrity, 'signature');
  if (algorithm !== SIGNATURE_ALGORITHM || !/^[a-f0-9]{64}$/.test(manifestSignature)) {
    throw new OrderlyDecisionManifestError('INVALID_REQUEST', 'Decision manifest integrity metadata is invalid.');
  }

  const decisions = value.decisions.map((raw, index) => {
    if (!isRecord(raw) || !isRecord(raw.evidence) || !isRecord(raw.decision)) {
      throw new OrderlyDecisionManifestError('INVALID_REQUEST', `Manifest decision ${index + 1} is malformed.`);
    }
    const rowIndex = raw.rowIndex;
    if (!Number.isInteger(rowIndex) || (rowIndex as number) < 1) {
      throw new OrderlyDecisionManifestError('INVALID_REQUEST', `Manifest decision ${index + 1} has an invalid row index.`);
    }
    const revision = raw.revision;
    if (!Number.isInteger(revision) || (revision as number) < 1) {
      throw new OrderlyDecisionManifestError('INVALID_REQUEST', `Manifest decision ${index + 1} has an invalid revision.`);
    }
    return {
      rowIndex: rowIndex as number,
      decision: raw.decision as ReviewDecisionPayload,
      revision: revision as number,
      evidence: raw.evidence as unknown as OrderlyDecisionManifestEvidence,
    };
  });

  return {
    manifestVersion: ORDERLY_DECISION_MANIFEST_VERSION,
    exportedAt: requiredString(value, 'exportedAt'),
    batch: {
      batchId: requiredString(batch, 'batchId'),
      companyId: requiredString(batch, 'companyId'),
      sourceSystem: requiredString(batch, 'sourceSystem'),
      sourcePropertyId: batch.sourcePropertyId === null ? null : requiredString(batch, 'sourcePropertyId'),
      targetStoreId,
      fileHash: requiredString(batch, 'fileHash'),
      originalFilename: requiredString(batch, 'originalFilename'),
      parserVersion: requiredString(batch, 'parserVersion'),
      inventoryDate: batch.inventoryDate === null ? null : requiredString(batch, 'inventoryDate'),
      sourceRowCount,
      snapshotTotal: snapshotTotal as number | null,
    },
    previewFingerprint: requiredString(value, 'previewFingerprint'),
    decisions,
    integrity: {
      algorithm: SIGNATURE_ALGORITHM,
      signature: manifestSignature,
    },
  };
}

export function parseAndVerifyOrderlyDecisionManifest(value: unknown): OrderlyDecisionManifest {
  const manifest = validateManifestShape(value);
  const { integrity: _integrity, ...unsigned } = manifest;
  const expected = signature(unsigned);
  const actualBuffer = Buffer.from(manifest.integrity.signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new OrderlyDecisionManifestError(
      'CONFLICT',
      'Decision manifest integrity verification failed. Export a fresh manifest from the pending batch.',
    );
  }
  return manifest;
}