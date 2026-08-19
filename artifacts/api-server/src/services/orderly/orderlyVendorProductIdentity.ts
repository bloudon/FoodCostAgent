import {
  comparePackGeometry,
  type ClassifierVendorItemRow,
} from './vendorItemDuplicateClassifier';
import {
  crossCheckPackSize,
  parsePackSize,
  type PackCrossCheck,
} from './vendorInvoiceXlsx';

export type OrderlyIdentityClassification =
  | 'SAFE_CANDIDATE'
  | 'AMBIGUOUS'
  | 'CONFLICT'
  | 'NO_CANDIDATE';

export interface OrderlyVendorProductCandidate extends ClassifierVendorItemRow {
  pricedAt: Date | null;
  updatedAt: Date | null;
}

export interface OrderlyVendorProductIdentityInput {
  candidates: OrderlyVendorProductCandidate[];
  mappedInventoryItemIds: string[];
  mappedVendorItemIds?: string[];
  sourcePackRawValues: Array<string | null>;
  sourceDescriptions?: Array<string | null>;
  selectedVendorItemId?: string;
}

export interface OrderlyVendorProductIdentityDecision {
  classification: OrderlyIdentityClassification;
  reasons: string[];
  canonicalVendorItem: OrderlyVendorProductCandidate | null;
  packCrossCheck: PackCrossCheck | null;
}

function normalizeDescription(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function descriptionsConflict(values: Array<string | null> | undefined): boolean {
  const descriptions = [
    ...new Set((values ?? []).map(value => normalizeDescription(value ?? '')).filter(Boolean)),
  ];
  for (let left = 0; left < descriptions.length; left++) {
    const leftTokens = new Set(descriptions[left].split(' ').filter(Boolean));
    for (let right = left + 1; right < descriptions.length; right++) {
      const rightTokens = new Set(descriptions[right].split(' ').filter(Boolean));
      const overlap = [...leftTokens].filter(token => rightTokens.has(token)).length;
      const union = new Set([...leftTokens, ...rightTokens]).size;
      if (union > 0 && overlap / union < 0.5) return true;
    }
  }
  return false;
}

function electCanonical(
  candidates: OrderlyVendorProductCandidate[],
): OrderlyVendorProductCandidate {
  return [...candidates].sort((a, b) => {
    if ((b.active ?? 0) !== (a.active ?? 0)) return (b.active ?? 0) - (a.active ?? 0);
    const bDate = b.pricedAt?.getTime() ?? b.updatedAt?.getTime() ?? 0;
    const aDate = a.pricedAt?.getTime() ?? a.updatedAt?.getTime() ?? 0;
    if (bDate !== aDate) return bDate - aDate;
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * Shared fail-closed classifier for Orderly vendor-product identity.
 *
 * The vendor invoice approval preview and post-approval historical repair both
 * call this function. That keeps their source-code, mapping, pack, and
 * ambiguity predicates identical instead of allowing an interactive repair to
 * be weaker than the importer.
 */
export function classifyOrderlyVendorProductIdentity(
  input: OrderlyVendorProductIdentityInput,
): OrderlyVendorProductIdentityDecision {
  const candidates = [...new Map(input.candidates.map(candidate => [candidate.id, candidate])).values()];
  if (candidates.length === 0) {
    return {
      classification: 'NO_CANDIDATE',
      reasons: ['No existing vendor product matches this source identity.'],
      canonicalVendorItem: null,
      packCrossCheck: null,
    };
  }

  const reasons: string[] = [];
  const mappedVendorItemIds = [...new Set(input.mappedVendorItemIds ?? [])];
  if (mappedVendorItemIds.length > 1) {
    reasons.push('More than one vendor-product mapping owns this source identity.');
  }
  const inventoryItemIds = [...new Set(candidates.map(candidate => candidate.inventoryItemId))];
  if (inventoryItemIds.length > 1) {
    return {
      classification: 'AMBIGUOUS',
      reasons: ['The source item code is associated with more than one inventory item.'],
      canonicalVendorItem: null,
      packCrossCheck: null,
    };
  }

  if (descriptionsConflict(input.sourceDescriptions)) {
    reasons.push('The source item code appears with materially different product descriptions.');
  }

  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      const comparison = comparePackGeometry(candidates[left], candidates[right]);
      if (!comparison.equivalent) {
        reasons.push(`Existing vendor products have conflicting pack geometry: ${comparison.conflicts.join(', ')}.`);
      }
    }
  }

  const mappedCanonical = mappedVendorItemIds.length === 1
    ? candidates.find(candidate => candidate.id === mappedVendorItemIds[0])
    : undefined;
  if (mappedVendorItemIds.length === 1 && !mappedCanonical) {
    reasons.push('The mapped vendor product is unavailable in the authorized vendor catalog.');
  }
  const canonical = mappedCanonical ?? electCanonical(candidates);
  const mappedInventoryItemIds = [...new Set(input.mappedInventoryItemIds)];
  if (
    mappedInventoryItemIds.length > 1 ||
    (mappedInventoryItemIds.length === 1 && mappedInventoryItemIds[0] !== canonical.inventoryItemId)
  ) {
    reasons.push('The authoritative source mapping disagrees with the selected vendor product.');
  }

  let packCrossCheck: PackCrossCheck | null = null;
  for (const raw of input.sourcePackRawValues) {
    const check = crossCheckPackSize(parsePackSize(raw), {
      caseSize: canonical.caseSize,
      innerPackSize: canonical.innerPackSize,
      packUom: canonical.packUom,
    });
    if (check === 'conflict') {
      reasons.push('The source pack conflicts with the selected vendor product pack.');
    }
    if (packCrossCheck == null || check === 'conflict' || packCrossCheck === 'unverifiable') {
      packCrossCheck = check;
    }
  }

  if (input.selectedVendorItemId && canonical.id !== input.selectedVendorItemId) {
    return {
      classification: 'AMBIGUOUS',
      reasons: ['The selected vendor product is not the canonical row for this source item code.'],
      canonicalVendorItem: canonical,
      packCrossCheck,
    };
  }

  return {
    classification: reasons.length > 0 ? 'CONFLICT' : 'SAFE_CANDIDATE',
    reasons: [...new Set(reasons)],
    canonicalVendorItem: canonical,
    packCrossCheck,
  };
}