import type { ClassifierVendorItemRow } from "./vendorItemDuplicateClassifier";

export const EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT = 6038;

type ClassifierGroup = {
  class: string;
  rowIds: string[];
  proposedSurvivorId: string | null;
  proposedDeletions: number;
};

export type ProductionClassifierReport = {
  database: string;
  readOnly: boolean;
  totals: { duplicateGroups: number; excessRows: number };
  classes: { A: { groups: number; excessRows: number } };
  groups: ClassifierGroup[];
};

export type EdiPayloadRow = {
  id: string;
  payloadJson: unknown;
};

export type EdiEvidence = {
  totalMessagesInspected: number;
  messagesContainingAnyVendorItemIdentity: number;
  messagesContainingProposedLoserIds: number;
  distinctProposedLoserIdsReferenced: number;
  representativeStructuralPaths: string[];
  softReferenceRisk: "CLOSED" | "STOP";
  requiredReferenceContract: string | null;
};

export type SyscoEvidenceRow = ClassifierVendorItemRow & {
  unitName: string | null;
  unitAbbreviation: string | null;
  unitKind: string | null;
};

function fail(message: string): never {
  throw new Error(`Gate 2 readiness refused: ${message}`);
}

/**
 * The production classifier report, not a Dev manifest, is the sole source of
 * proposed loser ids for this task. The approved current production baseline
 * contains 2,429 Class A groups and 6,038 Class A excess rows.
 */
export function extractProductionClassALoserIds(report: unknown): {
  database: string;
  loserIds: Set<string>;
} {
  const candidate = report as Partial<ProductionClassifierReport>;
  if (!candidate || candidate.readOnly !== true || typeof candidate.database !== "string") {
    fail("classifier report must be a read-only structured report with a database identity.");
  }
  if (candidate.totals?.duplicateGroups !== 2430 || candidate.totals?.excessRows !== 6039) {
    fail("classifier report does not match the approved production Gate 1 baseline (2,430 groups / 6,039 excess rows).");
  }
  if (candidate.classes?.A?.groups !== 2429 || candidate.classes.A.excessRows !== EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT) {
    fail("classifier report does not match the approved production Class A baseline (2,429 groups / 6,038 excess rows).");
  }
  if (!Array.isArray(candidate.groups)) fail("classifier report has no group list.");

  const loserIds = new Set<string>();
  let classAGroups = 0;
  for (const group of candidate.groups as ClassifierGroup[]) {
    if (group.class !== "A") continue;
    classAGroups += 1;
    if (!Array.isArray(group.rowIds) || group.rowIds.length < 2 || !group.proposedSurvivorId) {
      fail("a Class A group lacks its reviewed row ids or proposed survivor.");
    }
    if (!group.rowIds.includes(group.proposedSurvivorId)) {
      fail("a Class A proposed survivor is not a member of its group.");
    }
    if (group.proposedDeletions !== group.rowIds.length - 1) {
      fail("a Class A group's deletion count does not match its reviewed membership.");
    }
    for (const id of group.rowIds) {
      if (id !== group.proposedSurvivorId) loserIds.add(id);
    }
  }
  if (classAGroups !== 2429 || loserIds.size !== EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT) {
    fail("derived Class A losers do not match the approved production count of 6,038.");
  }
  return { database: candidate.database, loserIds };
}

function parsePayload(payload: unknown, messageId: string): unknown {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    fail(`edi_messages payload ${messageId} is not valid JSON; cannot safely inspect structural paths.`);
  }
}

function isVendorItemIdentityKey(key: string): boolean {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase().includes("vendoritemid");
}

function inspectPayload(
  value: unknown,
  loserIds: ReadonlySet<string>,
  path: string,
  identityPaths: Set<string>,
  loserPaths: Set<string>,
  foundLosers: Set<string>,
): boolean {
  let containsVendorItemIdentity = false;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      containsVendorItemIdentity ||= inspectPayload(
        entry,
        loserIds,
        `${path}[${index}]`,
        identityPaths,
        loserPaths,
        foundLosers,
      );
    });
    return containsVendorItemIdentity;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      if (isVendorItemIdentityKey(key)) {
        containsVendorItemIdentity = true;
        identityPaths.add(childPath);
      }
      const childContainsVendorItemIdentity = inspectPayload(
        entry,
        loserIds,
        childPath,
        identityPaths,
        loserPaths,
        foundLosers,
      );
      containsVendorItemIdentity = containsVendorItemIdentity || childContainsVendorItemIdentity;
    }
    return containsVendorItemIdentity;
  }
  if (typeof value === "string" && loserIds.has(value)) {
    loserPaths.add(path);
    foundLosers.add(value);
  }
  return containsVendorItemIdentity;
}

/**
 * Produces only counts and structural paths. Payload bodies, EDI ids, and
 * proposed loser ids are intentionally never included in the evidence report.
 */
export function summarizeEdiPayloads(
  totalMessageCount: number,
  rows: readonly EdiPayloadRow[],
  loserIds: ReadonlySet<string>,
): EdiEvidence {
  const identityPaths = new Set<string>();
  const loserPaths = new Set<string>();
  const foundLosers = new Set<string>();
  let messagesWithVendorItemIdentity = 0;
  let messagesWithLosers = 0;

  for (const row of rows) {
    const perMessageIdentityPaths = new Set<string>();
    const perMessageLoserPaths = new Set<string>();
    const perMessageLosers = new Set<string>();
    const hasIdentity = inspectPayload(
      parsePayload(row.payloadJson, row.id),
      loserIds,
      "$",
      perMessageIdentityPaths,
      perMessageLoserPaths,
      perMessageLosers,
    );
    if (hasIdentity) messagesWithVendorItemIdentity += 1;
    if (perMessageLosers.size > 0) messagesWithLosers += 1;
    for (const path of perMessageIdentityPaths) identityPaths.add(path);
    for (const path of perMessageLoserPaths) loserPaths.add(path);
    for (const id of perMessageLosers) foundLosers.add(id);
  }

  const hasLosers = foundLosers.size > 0;
  return {
    totalMessagesInspected: totalMessageCount,
    messagesContainingAnyVendorItemIdentity: messagesWithVendorItemIdentity,
    messagesContainingProposedLoserIds: messagesWithLosers,
    distinctProposedLoserIdsReferenced: foundLosers.size,
    representativeStructuralPaths: [...new Set([...identityPaths, ...loserPaths])].sort().slice(0, 20),
    softReferenceRisk: hasLosers ? "STOP" : "CLOSED",
    requiredReferenceContract: hasLosers
      ? "Persisted EDI payloads contain proposed loser identities. Before any remediation, PM must approve an explicit contract proving either (a) these payloads are immutable historical evidence and are never dereferenced as live vendor-item identities, or (b) a versioned, audited rewrite preserves the original evidence. Do not merge, repoint, or rewrite until that contract is approved and this scan is rerun."
      : null,
  };
}

export function normalizeSyscoRow(
  row: SyscoEvidenceRow,
  externalMappings: unknown[],
  downstreamReferences: Record<string, number>,
) {
  return {
    vendorItemId: row.id,
    inventoryItemId: row.inventoryItemId,
    rawPackGeometry: {
      purchaseUnit: {
        id: row.purchaseUnitId,
        name: row.unitName,
        abbreviation: row.unitAbbreviation,
        kind: row.unitKind,
      },
      caseSize: row.caseSize,
      innerPackSize: row.innerPackSize,
      packUom: row.packUom,
      canonicalQtyPerPurchaseUnit: row.canonicalQtyPerPurchaseUnit,
      pricingBasis: row.pricingBasis,
      isVariableWeight: row.isVariableWeight,
    },
    normalizedPackGeometry: {
      purchaseUnitId: row.purchaseUnitId,
      totalUnitsPerCase: (row.caseSize ?? 1) * (row.innerPackSize ?? 1),
      packUom: (row.packUom ?? "").trim().toLowerCase(),
      canonicalQtyPerPurchaseUnit: row.canonicalQtyPerPurchaseUnit,
      pricingBasis: row.pricingBasis ?? "purchase_unit",
      isVariableWeight: row.isVariableWeight ?? 0,
    },
    activeAndConfig: {
      active: row.active,
      brandName: row.brandName,
      packGeometryStatus: row.packGeometryStatus,
    },
    currentAndLastPricing: {
      lastPrice: row.lastPrice,
      lastCasePrice: row.lastCasePrice,
      priceSource: row.priceSource,
    },
    sourceProvenanceAvailable: {
      priceSource: row.priceSource,
      externalMappings,
    },
    downstreamReferences,
  };
}