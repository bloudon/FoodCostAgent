import { createHash } from "node:crypto";
import {
  EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT,
  extractProductionClassALoserIds,
  type ProductionClassifierReport,
} from "./vendorItemDuplicateGate2Readiness";
import {
  VENDOR_ITEM_REFERENCE_SOURCES,
  type ReferenceCompatibility,
} from "./vendorItemDuplicateReferenceCompatibility";

export class Gate2PackageError extends Error {
  constructor(message: string) {
    super(`Non-executable Gate 2 package refused: ${message}`);
    this.name = "Gate2PackageError";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value === undefined ? null : value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprintLoserSet(ids: ReadonlySet<string>): string {
  return sha256(canonicalJson({
    format: "vendor-item-production-loser-set-v1",
    loserIds: [...ids].sort(),
  }));
}

type ReportGroup = {
  class: string;
  rowIds: string[];
  proposedSurvivorId: string | null;
  proposedDeletions: number;
  key?: unknown;
};

export type Gate2ReadinessEvidence = {
  readOnly: true;
  database: string;
  productionClassALoserCount: number;
  ediSoftReferenceEvidence: { softReferenceRisk: "CLOSED" | "STOP" };
};

export type NonExecutableGate2Package = {
  format: "vendor-item-production-gate2-package-v1";
  executionProhibited: true;
  packageId: string;
  sourceClassifierReport: {
    absolutePath: string;
    fileSha256: string;
    database: string;
    acceptedBaseline: {
      duplicateGroups: 2430;
      excessRows: 6039;
      classAGroups: 2429;
      classALoserRows: 6038;
    };
    loserSetSha256: string;
    classAGroupMembershipSha256: string;
  };
  readinessEvidence: {
    absolutePath: string;
    fileSha256: string;
    database: string;
    ediSoftReferenceRisk: "CLOSED";
  };
  referenceCompatibility: Record<string, ReferenceCompatibility>;
  reviewedGroups: Array<{
    groupKey: unknown;
    survivorId: string;
    loserIds: string[];
    transactionalReferenceRepoints: string[];
  }>;
  excludedHeldGroups: {
    rule: "all non-Class-A groups remain excluded";
    syscoSku7664436: {
      vendorItemIds: [string, string];
      inventoryItemId: string;
      requiresLaterExplicitPmDisposition: true;
    };
  };
  futureExecutionRequirements: string[];
  expectedBeforeAfter: {
    loserRowsToDelete: number;
    duplicateGroupsToMerge: number;
    valuationInvariant: string;
    catalogInvariant: string;
    idempotencyAnchor: string;
    recoveryRequirement: string;
  };
};

function requireAbsolute(value: string, label: string): void {
  if (!value.startsWith("/")) throw new Gate2PackageError(`${label} must be an absolute external path.`);
}

function packageGroups(report: ProductionClassifierReport): Array<NonExecutableGate2Package["reviewedGroups"][number]> {
  const groups = (report.groups as ReportGroup[])
    .filter((group) => group.class === "A")
    .map((group) => {
      if (!group.proposedSurvivorId) {
        throw new Gate2PackageError("a reviewed Class A group has no survivor.");
      }
      const loserIds = group.rowIds.filter((id) => id !== group.proposedSurvivorId).sort();
      return {
        groupKey: group.key ?? null,
        survivorId: group.proposedSurvivorId,
        loserIds,
        transactionalReferenceRepoints: VENDOR_ITEM_REFERENCE_SOURCES.map(
          (source) => `${source.table}.${source.column}`,
        ),
      };
    })
    .sort((left, right) => canonicalJson(left.groupKey).localeCompare(canonicalJson(right.groupKey)));
  return groups;
}

export function buildNonExecutableGate2Package(input: {
  classifierReport: unknown;
  classifierReportPath: string;
  classifierReportFileSha256: string;
  readinessEvidence: unknown;
  readinessEvidencePath: string;
  readinessEvidenceFileSha256: string;
  connectedDatabase: string;
  referenceCompatibility: Record<string, ReferenceCompatibility>;
}): NonExecutableGate2Package {
  requireAbsolute(input.classifierReportPath, "classifier report path");
  requireAbsolute(input.readinessEvidencePath, "readiness evidence path");
  const classifier = input.classifierReport as ProductionClassifierReport;
  const { database, loserIds } = extractProductionClassALoserIds(classifier);
  if (database !== input.connectedDatabase) {
    throw new Gate2PackageError("classifier report database does not match the connected database.");
  }

  const readiness = input.readinessEvidence as Partial<Gate2ReadinessEvidence>;
  if (
    readiness?.readOnly !== true ||
    readiness.database !== input.connectedDatabase ||
    readiness.productionClassALoserCount !== EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT ||
    readiness.ediSoftReferenceEvidence?.softReferenceRisk !== "CLOSED"
  ) {
    throw new Gate2PackageError("readiness evidence is not the accepted read-only, EDI-CLOSED production finding.");
  }

  const reviewedGroups = packageGroups(classifier);
  const derivedLosers = new Set(reviewedGroups.flatMap((group) => group.loserIds));
  if (derivedLosers.size !== loserIds.size || derivedLosers.size !== EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT) {
    throw new Gate2PackageError("reviewed group membership does not reproduce the accepted loser set.");
  }

  const core = {
    format: "vendor-item-production-gate2-package-v1" as const,
    executionProhibited: true as const,
    sourceClassifierReport: {
      absolutePath: input.classifierReportPath,
      fileSha256: input.classifierReportFileSha256,
      database,
      acceptedBaseline: {
        duplicateGroups: 2430 as const,
        excessRows: 6039 as const,
        classAGroups: 2429 as const,
        classALoserRows: 6038 as const,
      },
      loserSetSha256: fingerprintLoserSet(loserIds),
      classAGroupMembershipSha256: sha256(canonicalJson({
        format: "vendor-item-production-class-a-groups-v1",
        reviewedGroups,
      })),
    },
    readinessEvidence: {
      absolutePath: input.readinessEvidencePath,
      fileSha256: input.readinessEvidenceFileSha256,
      database,
      ediSoftReferenceRisk: "CLOSED" as const,
    },
    referenceCompatibility: input.referenceCompatibility,
    reviewedGroups,
    excludedHeldGroups: {
      rule: "all non-Class-A groups remain excluded" as const,
      syscoSku7664436: {
        vendorItemIds: [
          "04f822ba-fb2d-479e-9f9b-6aefc4b0af90",
          "ca185955-ce85-4c92-be7e-875974c0100d",
        ] as [string, string],
        inventoryItemId: "2030960c-3c95-49fd-8ccc-56eae6b5e615",
        requiresLaterExplicitPmDisposition: true as const,
      },
    },
    futureExecutionRequirements: [
      "A separate PM authorization must name the exact packageId and approve a maintenance window.",
      "Re-read the exact external classifier report and readiness evidence and match both file hashes and fingerprints.",
      "Revalidate connected database identity, reviewed reference columns, Class A group membership, survivors, losers, and pack geometry under lock.",
      "Use one transaction per reviewed group to repoint every enumerated relational reference, preserve dated price history, and write an audit row as the rerun anchor.",
      "Take and verify an operator-approved recovery point and writer-quiescence condition before mutation.",
      "Verify before/after row counts, no merge-caused orphan references, unchanged catalog/valuation semantics, and idempotent rerun results.",
    ],
    expectedBeforeAfter: {
      loserRowsToDelete: EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT,
      duplicateGroupsToMerge: 2429,
      valuationInvariant: "No price, price-history value, inventory valuation, or canonical pack geometry may be overwritten or collapsed by the merge.",
      catalogInvariant: "Only the reviewed Class A vendor-item identities may be removed; every survivor retains its own geometry and provenance.",
      idempotencyAnchor: "A future per-group immutable merge-audit record is the sole rerun anchor; this package creates no audit row.",
      recoveryRequirement: "Future execution requires an operator-verified recovery point and write quiescence; this package is evidence only.",
    },
  };
  return { ...core, packageId: sha256(canonicalJson(core)) };
}