/**
 * Vendor identity review and controlled consolidation.
 *
 * This is deliberately separate from vendor-item duplicate remediation:
 * changing vendor_id is allowed here, but vendor_items, inventory items, pack
 * geometry, external Item Codes, and Orderly packSizeIds are never merged.
 *
 * The report side is read-only. The apply side is transactional, explicitly
 * gated, and only accepts a report whose evidence has been reconciled against
 * the same company/vendor identities.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

export type VendorIdentityEvidence = {
  vendorId: string;
  companyId: string;
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  sourceSystem: string | null;
  sourcePropertyId: string | null;
  sourceInvoiceId: string | null;
  vendorExternalId: string | null;
};

export type VendorIdentityVendor = {
  id: string;
  companyId: string;
  name: string;
  active: number;
};

export type InvoiceFormat = {
  kind: "numeric" | "prefixed" | "mixed";
  prefix: string | null;
  normalized: string;
};

export type VendorIdentityPairMetrics = {
  leftInvoiceCount: number;
  rightInvoiceCount: number;
  leftDistinctInvoiceCount: number;
  rightDistinctInvoiceCount: number;
  comparisonSourceScope: { sourceSystem: string; sourcePropertyId: string } | null;
  sharedInvoiceNumbers: string[];
  leftFormats: InvoiceFormat[];
  rightFormats: InvoiceFormat[];
  compatibleFormatKeys: string[];
  sameFormat: boolean;
  leftDateRange: { start: string | null; end: string | null };
  rightDateRange: { start: string | null; end: string | null };
  dateRangesOverlap: boolean;
  numericRangesOverlap: boolean;
  interleavedSequence: boolean;
  embeddedSingleEntry: "left_in_right" | "right_in_left" | null;
  cleanCutover: {
    detected: boolean;
    earlierVendorId: string | null;
    laterVendorId: string | null;
    gapDays: number | null;
  };
};

export type SuppliedReviewClaim = {
  key: string;
  leftName: string;
  rightName: string;
  evidence: string[];
  duplicateInvoiceNumber?: string;
  embeddedInvoiceNumber?: string;
  expectedSupplierExternalIdsByVendorName?: Record<string, string>;
  expectedDistinctHandoff?: {
    earlierLastDate: string;
    laterFirstDate: string;
    earlierFormat: string;
    laterFormat: string;
  };
};

export type VendorIdentityClassification =
  | "proven_same_vendor"
  | "likely_same_vendor_review"
  | "distinct_vendor_or_legitimate_handoff"
  | "insufficient_evidence";

export type VendorIdentityPairResult = {
  companyId: string;
  left: VendorIdentityVendor;
  right: VendorIdentityVendor;
  classification: VendorIdentityClassification;
  evidenceStatus: "reconciled" | "not_reconciled";
  reasons: string[];
  metrics: VendorIdentityPairMetrics;
  suppliedReviewClaim: SuppliedReviewClaim | null;
};

export type VendorIdentityReport = {
  format: "vendor-identity-invoice-continuity-report-v1";
  generatedAt: string;
  companyId: string;
  vendorCount: number;
  evidenceCount: number;
  pairCount: number;
  classificationCounts: Record<VendorIdentityClassification, number>;
  sourceReviewClaims: SuppliedReviewClaim[];
  pairs: VendorIdentityPairResult[];
};

/**
 * These claims come from the attached source review. They are not
 * authorization by themselves: each must be reconciled to persisted evidence
 * and exact current vendor IDs before it can make a pair eligible.
 */
export const SUPPLIED_REVIEW_CLAIMS: readonly SuppliedReviewClaim[] = [
  {
    key: "gfs-store-gordon-food-service",
    leftName: "GFs Store",
    rightName: "Gordon Food Service",
    duplicateInvoiceNumber: "963139987",
    expectedSupplierExternalIdsByVendorName: {
      "GFs Store": "25636",
      "Gordon Food Service": "487",
    },
    evidence: [
      "Invoice 963139987 is cited under both labels.",
      "The cited 963136539–963163056 invoice numbers are one interleaved numeric sequence.",
    ],
  },
  {
    key: "albert-uster-aui",
    leftName: "Albert Uster Fine Foods",
    rightName: "AUI Fine Foods",
    embeddedInvoiceNumber: "IVC1562089",
    evidence: [
      "IVC1562089 under the full-name label is cited within AUI's date range and shares AUI's IVC invoice format.",
    ],
  },
  {
    key: "pinkney-rlb",
    leftName: "Pinkney Transportation LLC",
    rightName: "RLB Transport",
    expectedDistinctHandoff: {
      earlierLastDate: "2024-08-30",
      laterFirstDate: "2024-09-02",
      earlierFormat: "P-prefixed",
      laterFormat: "plain numeric",
    },
    evidence: [
      "Pinkney uses P-prefixed invoice numbers through 2024-08-30.",
      "RLB starts plain-number invoices on 2024-09-02 with no cited overlap.",
    ],
  },
];

const REVIEW_CLAIM_BY_NAMES = new Map(
  SUPPLIED_REVIEW_CLAIMS.flatMap((claim) => [
    [`${normalizeName(claim.leftName)}|${normalizeName(claim.rightName)}`, claim],
    [`${normalizeName(claim.rightName)}|${normalizeName(claim.leftName)}`, claim],
  ]),
);

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeInvoice(value: string): string {
  return value.trim().toUpperCase();
}

export function invoiceFormat(value: string): InvoiceFormat {
  const normalized = normalizeInvoice(value);
  if (/^\d+$/.test(normalized)) {
    return { kind: "numeric", prefix: null, normalized };
  }
  const prefixed = normalized.match(/^([A-Z]+)[- _]?(\d+)$/);
  if (prefixed) {
    return { kind: "prefixed", prefix: prefixed[1], normalized };
  }
  return { kind: "mixed", prefix: null, normalized };
}

function formatKey(format: InvoiceFormat): string {
  return format.kind === "prefixed"
    ? `prefixed:${format.prefix}`
    : format.kind;
}

function uniqueFormats(evidence: readonly VendorIdentityEvidence[]): InvoiceFormat[] {
  const seen = new Map<string, InvoiceFormat>();
  for (const row of evidence) {
    const parsed = invoiceFormat(row.invoiceNumber);
    seen.set(formatKey(parsed), parsed);
  }
  return [...seen.values()];
}

function dateRange(evidence: readonly VendorIdentityEvidence[]): {
  start: string | null;
  end: string | null;
} {
  const dates = evidence.map((row) => row.invoiceDate).filter((x): x is string => !!x).sort();
  return { start: dates[0] ?? null, end: dates.at(-1) ?? null };
}

function rangesOverlap(
  left: { start: string | null; end: string | null },
  right: { start: string | null; end: string | null },
): boolean {
  return !!left.start && !!left.end && !!right.start && !!right.end
    && left.start <= right.end && right.start <= left.end;
}

function numericRange(
  evidence: readonly VendorIdentityEvidence[],
): { min: bigint; max: bigint } | null {
  const numbers = evidence
    .map((row) => invoiceOrdinal(row.invoiceNumber))
    .filter((value): value is bigint => value !== null);
  if (numbers.length === 0) return null;
  return {
    min: numbers.reduce((a, b) => (a < b ? a : b)),
    max: numbers.reduce((a, b) => (a > b ? a : b)),
  };
}

function invoiceOrdinal(value: string): bigint | null {
  const parsed = invoiceFormat(value);
  if (parsed.kind === "numeric") return BigInt(parsed.normalized);
  const suffix = parsed.normalized.match(/(\d+)$/)?.[1];
  return suffix ? BigInt(suffix) : null;
}

function sequenceIsInterleaved(
  left: readonly VendorIdentityEvidence[],
  right: readonly VendorIdentityEvidence[],
  compatibleKeys: ReadonlySet<string>,
): boolean {
  const rows = [...left, ...right]
    .filter((row) => compatibleKeys.has(formatKey(invoiceFormat(row.invoiceNumber))))
    .map((row) => ({
      owner: row.vendorId,
      number: normalizeInvoice(row.invoiceNumber),
    }));
  if (rows.length < 4) return false;
  const numeric = rows.every((row) => invoiceOrdinal(row.number) !== null);
  if (!numeric) return false;
  rows.sort((a, b) => {
    const aa = invoiceOrdinal(a.number)!;
    const bb = invoiceOrdinal(b.number)!;
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  });
  let transitions = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].owner !== rows[i - 1].owner) transitions++;
  }
  return transitions >= 2;
}

function embeddedSingleEntry(
  left: readonly VendorIdentityEvidence[],
  right: readonly VendorIdentityEvidence[],
  compatibleKeys: ReadonlySet<string>,
): VendorIdentityPairMetrics["embeddedSingleEntry"] {
  const check = (
    candidate: readonly VendorIdentityEvidence[],
    container: readonly VendorIdentityEvidence[],
  ): boolean => {
    if (candidate.length !== 1 || container.length < 2) return false;
    const candidateFormat = formatKey(invoiceFormat(candidate[0].invoiceNumber));
    if (!compatibleKeys.has(candidateFormat)) return false;
    const value = invoiceOrdinal(candidate[0].invoiceNumber);
    const containerValues = container
      .filter((row) => formatKey(invoiceFormat(row.invoiceNumber)) === candidateFormat)
      .map((row) => invoiceOrdinal(row.invoiceNumber))
      .filter((x): x is bigint => x !== null);
    if (value !== null && containerValues.length >= 2) {
      const n = value;
      const min = containerValues.reduce((a, b) => (a < b ? a : b));
      const max = containerValues.reduce((a, b) => (a > b ? a : b));
      if (min < n && n < max) return true;
    }
    // The Albert/AUI source review is deliberately narrower than GFs/Gordon:
    // its one full-name invoice is proven by same-format date containment, not
    // by a literal duplicate number. Do not compare dates across formats.
    const candidateDate = candidate[0].invoiceDate;
    const containerDates = container
      .filter((row) => formatKey(invoiceFormat(row.invoiceNumber)) === candidateFormat)
      .map((row) => row.invoiceDate)
      .filter((x): x is string => !!x)
      .sort();
    return !!candidateDate
      && containerDates.length >= 2
      && containerDates[0] < candidateDate
      && candidateDate < containerDates.at(-1)!;
  };
  if (check(left, right)) return "left_in_right";
  if (check(right, left)) return "right_in_left";
  return null;
}

function daysBetween(a: string, b: string): number | null {
  const aa = Date.parse(`${a}T00:00:00Z`);
  const bb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(aa) || !Number.isFinite(bb)) return null;
  return Math.round(Math.abs(bb - aa) / 86_400_000);
}

function cleanCutover(
  left: readonly VendorIdentityEvidence[],
  right: readonly VendorIdentityEvidence[],
  leftFormats: readonly InvoiceFormat[],
  rightFormats: readonly InvoiceFormat[],
): VendorIdentityPairMetrics["cleanCutover"] {
  const leftDates = left.map((x) => x.invoiceDate).filter((x): x is string => !!x).sort();
  const rightDates = right.map((x) => x.invoiceDate).filter((x): x is string => !!x).sort();
  if (!leftDates.length || !rightDates.length) {
    return { detected: false, earlierVendorId: null, laterVendorId: null, gapDays: null };
  }
  const differentFormat = new Set(leftFormats.map(formatKey)).size > 0
    && new Set(rightFormats.map(formatKey)).size > 0
    && !leftFormats.some((x) => rightFormats.some((y) => formatKey(x) === formatKey(y)));
  if (!differentFormat) {
    return { detected: false, earlierVendorId: null, laterVendorId: null, gapDays: null };
  }
  const leftEnd = leftDates.at(-1)!;
  const rightEnd = rightDates.at(-1)!;
  const leftIsEarlier = leftEnd < rightDates[0];
  const rightIsEarlier = rightEnd < leftDates[0];
  if (!leftIsEarlier && !rightIsEarlier) {
    return { detected: false, earlierVendorId: null, laterVendorId: null, gapDays: null };
  }
  const earlierEnd = leftIsEarlier ? leftEnd : rightEnd;
  const laterStart = leftIsEarlier ? rightDates[0] : leftDates[0];
  return {
    detected: true,
    earlierVendorId: leftIsEarlier ? left[0].vendorId : right[0].vendorId,
    laterVendorId: leftIsEarlier ? right[0].vendorId : left[0].vendorId,
    gapDays: daysBetween(earlierEnd, laterStart),
  };
}

export function compareVendorIdentityPair(
  left: VendorIdentityVendor,
  right: VendorIdentityVendor,
  allEvidence: readonly VendorIdentityEvidence[],
): VendorIdentityPairResult {
  if (left.companyId !== right.companyId) {
    throw new Error("Vendor identity comparison requires one company.");
  }
  const leftEvidence = allEvidence.filter((x) => x.vendorId === left.id);
  const rightEvidence = allEvidence.filter((x) => x.vendorId === right.id);
  // The same invoice number is allowed in different source properties. Only
  // compare invoice sequences that originated in a source-system/property seen
  // under BOTH vendor IDs.
  const commonSources = new Set(leftEvidence
    .map(sourceScopeKey)
    .filter((key): key is string => key !== null && rightEvidence.some((x) => sourceScopeKey(x) === key)));
  // Do not aggregate metrics across source properties. A vendor can re-use a
  // format/range across properties; combining facts from two properties could
  // fabricate an apparent continuity. Choose one best-evidenced common scope
  // for report-level sequence metrics; claim reconciliation below still binds
  // its exact invoice evidence directly.
  const comparisonScope = [...commonSources].sort((a, b) => {
    const score = (key: string) => {
      const leftCount = leftEvidence.filter((x) => sourceScopeKey(x) === key).length;
      const rightCount = rightEvidence.filter((x) => sourceScopeKey(x) === key).length;
      return [Math.min(leftCount, rightCount), leftCount + rightCount] as const;
    };
    const aa = score(a);
    const bb = score(b);
    return bb[0] - aa[0] || bb[1] - aa[1] || a.localeCompare(b);
  })[0] ?? null;
  const leftComparable = comparisonScope
    ? leftEvidence.filter((x) => sourceScopeKey(x) === comparisonScope)
    : [];
  const rightComparable = comparisonScope
    ? rightEvidence.filter((x) => sourceScopeKey(x) === comparisonScope)
    : [];
  const leftNumbers = new Set(leftEvidence.map((x) => normalizeInvoice(x.invoiceNumber)));
  const rightNumbers = new Set(rightEvidence.map((x) => normalizeInvoice(x.invoiceNumber)));
  const sharedInvoiceNumbers = [...new Set(leftComparable.flatMap((leftRow) => rightComparable
    .filter((rightRow) => normalizeInvoice(rightRow.invoiceNumber) === normalizeInvoice(leftRow.invoiceNumber)
      && sourceScopeKey(rightRow) === sourceScopeKey(leftRow))
    .map((rightRow) => normalizeInvoice(rightRow.invoiceNumber))))].sort();
  const leftFormats = uniqueFormats(leftComparable);
  const rightFormats = uniqueFormats(rightComparable);
  const compatibleFormatKeys = [...new Set(leftFormats.flatMap((x) => rightFormats
    .filter((y) => formatKey(x) === formatKey(y))
    .map(formatKey)))];
  const leftRange = dateRange(leftComparable);
  const rightRange = dateRange(rightComparable);
  const leftNumeric = numericRange(leftComparable);
  const rightNumeric = numericRange(rightComparable);
  const numericRangesOverlap = !!leftNumeric && !!rightNumeric
    && leftNumeric.min <= rightNumeric.max && rightNumeric.min <= leftNumeric.max;
  const embedded = embeddedSingleEntry(leftComparable, rightComparable, new Set(compatibleFormatKeys));
  const metrics: VendorIdentityPairMetrics = {
    leftInvoiceCount: leftEvidence.length,
    rightInvoiceCount: rightEvidence.length,
    leftDistinctInvoiceCount: leftNumbers.size,
    rightDistinctInvoiceCount: rightNumbers.size,
    comparisonSourceScope: comparisonScope ? parseSourceScope(comparisonScope) : null,
    sharedInvoiceNumbers,
    leftFormats,
    rightFormats,
    compatibleFormatKeys,
    sameFormat: compatibleFormatKeys.length > 0,
    leftDateRange: leftRange,
    rightDateRange: rightRange,
    dateRangesOverlap: rangesOverlap(leftRange, rightRange),
    numericRangesOverlap,
    interleavedSequence: sequenceIsInterleaved(leftComparable, rightComparable, new Set(compatibleFormatKeys)),
    embeddedSingleEntry: embedded,
    cleanCutover: cleanCutover(leftComparable, rightComparable, leftFormats, rightFormats),
  };

  const claim = REVIEW_CLAIM_BY_NAMES.get(`${normalizeName(left.name)}|${normalizeName(right.name)}`) ?? null;
  const claimReconciled = claim ? reconcileClaim(claim, left, right, leftComparable, rightComparable, metrics) : false;
  const reasons: string[] = [];
  let classification: VendorIdentityClassification = "insufficient_evidence";

  if (claim && claimReconciled) {
    classification = claim.key === "pinkney-rlb"
      ? "distinct_vendor_or_legitimate_handoff"
      : "proven_same_vendor";
    reasons.push(`Supplied source-review claim "${claim.key}" reconciles to persisted invoice evidence.`);
  } else if (claim) {
    reasons.push(`Supplied source-review claim "${claim.key}" is not reconciled to persisted invoice evidence.`);
  }
  if (!claimReconciled) {
    // A named source-review claim has its own proof contract. Partial evidence
    // may still be useful for a human reviewer, but it must never be promoted
    // by the more permissive generic rules below.
    if (claim && claim.key !== "pinkney-rlb"
      && (metrics.sharedInvoiceNumbers.length > 0 || metrics.interleavedSequence || metrics.embeddedSingleEntry)) {
      classification = "likely_same_vendor_review";
      reasons.push("The supplied claim has partial continuity evidence but its exact vendor/property binding did not reconcile.");
    } else if (metrics.cleanCutover.detected && metrics.cleanCutover.gapDays !== null && metrics.cleanCutover.gapDays <= 31) {
      classification = "distinct_vendor_or_legitimate_handoff";
      reasons.push("Invoice formats differ and the dated ranges show a clean, non-overlapping handoff.");
    } else if (metrics.sharedInvoiceNumbers.length > 0) {
      classification = "proven_same_vendor";
      reasons.push("The same normalized invoice number is persisted under both vendor IDs.");
    } else if (metrics.interleavedSequence || metrics.embeddedSingleEntry || (metrics.sameFormat && metrics.numericRangesOverlap)) {
      classification = "likely_same_vendor_review";
      reasons.push("Invoice format/range evidence suggests one sequence, but no supplied claim is fully reconciled.");
    } else if (!leftEvidence.length || !rightEvidence.length) {
      reasons.push("At least one vendor has no persisted invoice evidence.");
    } else {
      reasons.push("No shared/interleaved sequence, embedded entry, or clean handoff was proven.");
    }
  }
  return {
    companyId: left.companyId,
    left,
    right,
    classification,
    evidenceStatus: claim && claimReconciled ? "reconciled" : "not_reconciled",
    reasons,
    metrics,
    suppliedReviewClaim: claim,
  };
}

function sourceScopeKey(row: VendorIdentityEvidence): string | null {
  if (!row.sourceSystem?.trim() || !row.sourcePropertyId?.trim()) return null;
  return `${row.sourceSystem.trim().toUpperCase()}|${row.sourcePropertyId.trim()}`;
}

function parseSourceScope(key: string): { sourceSystem: string; sourcePropertyId: string } {
  const separator = key.indexOf("|");
  return {
    sourceSystem: key.slice(0, separator),
    sourcePropertyId: key.slice(separator + 1),
  };
}

function reconcileClaim(
  claim: SuppliedReviewClaim,
  leftVendor: VendorIdentityVendor,
  rightVendor: VendorIdentityVendor,
  left: readonly VendorIdentityEvidence[],
  right: readonly VendorIdentityEvidence[],
  metrics: VendorIdentityPairMetrics,
): boolean {
  const evidenceForName = (name: string): readonly VendorIdentityEvidence[] => (
    normalizeName(leftVendor.name) === normalizeName(name) ? left
      : normalizeName(rightVendor.name) === normalizeName(name) ? right
        : []
  );
  if (claim.key === "gfs-store-gordon-food-service") {
    const duplicate = claim.duplicateInvoiceNumber!;
    const gfsRows = evidenceForName("GFs Store");
    const gordonRows = evidenceForName("Gordon Food Service");
    const expected = claim.expectedSupplierExternalIdsByVendorName!;
    return gfsRows.some((gfsRow) => normalizeInvoice(gfsRow.invoiceNumber) === duplicate
      && gfsRow.vendorExternalId === expected["GFs Store"]
      && gordonRows.some((gordonRow) => normalizeInvoice(gordonRow.invoiceNumber) === duplicate
        && gordonRow.vendorExternalId === expected["Gordon Food Service"]
        && sourceScopeKey(gordonRow) === sourceScopeKey(gfsRow)));
  }
  if (claim.key === "albert-uster-aui") {
    const albertRows = evidenceForName("Albert Uster Fine Foods");
    return metrics.embeddedSingleEntry === (
      normalizeName(leftVendor.name) === normalizeName("Albert Uster Fine Foods")
        ? "left_in_right"
        : "right_in_left"
    ) && albertRows.length === 1
      && normalizeInvoice(albertRows[0].invoiceNumber) === claim.embeddedInvoiceNumber;
  }
  if (claim.key === "pinkney-rlb") {
    const expected = claim.expectedDistinctHandoff!;
    const pinkneyRows = evidenceForName("Pinkney Transportation LLC");
    const rlbRows = evidenceForName("RLB Transport");
    return metrics.cleanCutover.detected
      && metrics.cleanCutover.gapDays !== null
      && pinkneyRows.every((row) => formatKey(invoiceFormat(row.invoiceNumber)) === "prefixed:P")
      && rlbRows.every((row) => formatKey(invoiceFormat(row.invoiceNumber)) === "numeric")
      && pinkneyRows.some((row) => row.invoiceDate === expected.earlierLastDate)
      && rlbRows.some((row) => row.invoiceDate === expected.laterFirstDate);
  }
  return false;
}

export function buildVendorIdentityReport(params: {
  companyId: string;
  vendors: readonly VendorIdentityVendor[];
  evidence: readonly VendorIdentityEvidence[];
  generatedAt?: string;
}): VendorIdentityReport {
  const vendors = params.vendors.filter((x) => x.companyId === params.companyId);
  const evidence = params.evidence.filter((x) => x.companyId === params.companyId);
  const pairs: VendorIdentityPairResult[] = [];
  for (let i = 0; i < vendors.length; i++) {
    for (let j = i + 1; j < vendors.length; j++) {
      pairs.push(compareVendorIdentityPair(vendors[i], vendors[j], evidence));
    }
  }
  const classificationCounts: Record<VendorIdentityClassification, number> = {
    proven_same_vendor: 0,
    likely_same_vendor_review: 0,
    distinct_vendor_or_legitimate_handoff: 0,
    insufficient_evidence: 0,
  };
  for (const pair of pairs) classificationCounts[pair.classification]++;
  return {
    format: "vendor-identity-invoice-continuity-report-v1",
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    companyId: params.companyId,
    vendorCount: vendors.length,
    evidenceCount: evidence.length,
    pairCount: pairs.length,
    classificationCounts,
    sourceReviewClaims: [...SUPPLIED_REVIEW_CLAIMS],
    pairs,
  };
}

export function rowsOf(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

export async function loadVendorIdentityReport(companyId: string): Promise<VendorIdentityReport> {
  const vendorRows = rowsOf(await db.execute(sql`
    SELECT id, company_id AS "companyId", name, active
    FROM vendors
    WHERE company_id = ${companyId}
    ORDER BY name, id
  `)) as VendorIdentityVendor[];
  const evidenceRows = rowsOf(await db.execute(sql`
    SELECT vendor_id AS "vendorId",
           company_id AS "companyId",
           COALESCE(vendor_name_snapshot, '') AS "vendorName",
           invoice_number AS "invoiceNumber",
           invoice_date AS "invoiceDate",
           source_system AS "sourceSystem",
           source_property_id AS "sourcePropertyId",
           source_invoice_id AS "sourceInvoiceId",
           vendor_external_id_snapshot AS "vendorExternalId"
    FROM historical_invoices
    WHERE company_id = ${companyId}
      AND vendor_id IS NOT NULL
      AND invoice_number IS NOT NULL
      AND btrim(invoice_number) <> ''
    ORDER BY vendor_id, invoice_date, invoice_number, id
  `)) as VendorIdentityEvidence[];
  return buildVendorIdentityReport({ companyId, vendors: vendorRows, evidence: evidenceRows });
}

// ─── Controlled apply ─────────────────────────────────────────────────────────

type VendorReferenceSource = {
  table: string;
  column: string;
  scope: "company" | "store" | "vendor";
  mutable: boolean;
};

export const VENDOR_IDENTITY_REFERENCE_SOURCES: readonly VendorReferenceSource[] = [
  { table: "customer_supplier_connections", column: "vendor_id", scope: "company", mutable: true },
  { table: "extension_sync_jobs", column: "vendor_id", scope: "company", mutable: true },
  // Source invoices and deposit events are DB-immutable evidence. Their
  // original vendor IDs remain as provenance; the applied audit row is the
  // canonical-identity relationship for any reader that needs consolidation.
  { table: "historical_invoices", column: "vendor_id", scope: "company", mutable: false },
  { table: "order_guides", column: "vendor_id", scope: "company", mutable: true },
  { table: "po_export_logs", column: "vendor_id", scope: "company", mutable: true },
  { table: "purchase_orders", column: "vendor_id", scope: "company", mutable: true },
  { table: "quickbooks_vendor_mappings", column: "vendor_id", scope: "company", mutable: true },
  { table: "store_vendors", column: "vendor_id", scope: "store", mutable: true },
  { table: "vendor_deposit_ledger_events", column: "vendor_id", scope: "company", mutable: false },
  { table: "vendor_deposit_rates", column: "vendor_id", scope: "company", mutable: true },
  { table: "vendor_invoice_import_batches", column: "resolved_vendor_id", scope: "company", mutable: true },
  { table: "vendor_items", column: "vendor_id", scope: "vendor", mutable: true },
];

const VENDOR_REFERENCE_AUDIT_TABLE = "vendor_identity_merge_audit";

type Executor = { execute: (query: any) => Promise<any> };

function idSet(ids: string[]) {
  return sql`(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
}

async function ensureVendorIdentityAuditTable(ex: Executor): Promise<void> {
  await ex.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS vendor_identity_merge_audit (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      survivor_vendor_id VARCHAR NOT NULL,
      loser_vendor_id VARCHAR NOT NULL,
      evidence_report_hash TEXT NOT NULL,
      decision_scope JSONB NOT NULL,
      source_vendor_snapshots JSONB NOT NULL,
      references_repointed JSONB NOT NULL,
      identity_preservation JSONB NOT NULL,
      result TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      UNIQUE (company_id, survivor_vendor_id, loser_vendor_id)
    )`));
}

async function assertVendorReferenceColumnsUnchanged(ex: Executor): Promise<void> {
  const live = rowsOf(await ex.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (column_name = 'vendor_id' OR column_name = 'resolved_vendor_id')
      -- Merge audit rows retain the original vendor identity as provenance;
      -- they are intentionally never repointed by a later consolidation.
      AND table_name NOT IN ('vendors', 'vendor_item_merge_audit', ${VENDOR_REFERENCE_AUDIT_TABLE})
    ORDER BY table_name, column_name
  `)).map((x: any) => `${x.table_name}.${x.column_name}`).sort();
  const expected = VENDOR_IDENTITY_REFERENCE_SOURCES.map((x) => `${x.table}.${x.column}`).sort();
  if (JSON.stringify(live) !== JSON.stringify(expected)) {
    throw new Error(`Vendor reference schema drifted. live=${JSON.stringify(live)} expected=${JSON.stringify(expected)}`);
  }
}

function scopedReferenceWhere(source: VendorReferenceSource, companyId: string, vendorId: string) {
  const qualifiedColumn = sql.raw(`${source.table}.${source.column}`);
  const base = sql`${qualifiedColumn} = ${vendorId}`;
  if (source.scope === "company") {
    return sql`${base} AND ${sql.raw(`${source.table}.company_id`)} = ${companyId}`;
  }
  if (source.scope === "store") {
    return sql`${base} AND EXISTS (
      SELECT 1 FROM company_stores scoped_store
      WHERE scoped_store.id = ${sql.raw(`${source.table}.store_id`)}
        AND scoped_store.company_id = ${companyId}
    )`;
  }
  return sql`${base} AND EXISTS (
    SELECT 1 FROM vendors scoped_vendor
    WHERE scoped_vendor.id = ${qualifiedColumn}
      AND scoped_vendor.company_id = ${companyId}
  )`;
}

async function referenceCounts(ex: Executor, companyId: string, vendorId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const source of VENDOR_IDENTITY_REFERENCE_SOURCES) {
    const rows = rowsOf(await ex.execute(sql`
      SELECT count(*)::int AS count
      FROM ${sql.raw(source.table)}
      WHERE ${scopedReferenceWhere(source, companyId, vendorId)}
    `));
    counts[`${source.table}.${source.column}`] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

function immutableEvidenceCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(VENDOR_IDENTITY_REFERENCE_SOURCES
    .filter((source) => !source.mutable)
    .map((source) => {
      const key = `${source.table}.${source.column}`;
      return [key, counts[key] ?? 0];
    }));
}

function mutableReferenceCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(VENDOR_IDENTITY_REFERENCE_SOURCES
    .filter((source) => source.mutable)
    .map((source) => {
      const key = `${source.table}.${source.column}`;
      return [key, counts[key] ?? 0];
    }));
}

async function assertNoUniqueConnectionCollision(ex: Executor, companyId: string, survivorId: string, loserId: string): Promise<void> {
  for (const table of ["customer_supplier_connections", "quickbooks_vendor_mappings"]) {
    const rows = rowsOf(await ex.execute(sql`
      SELECT count(*)::int AS count
      FROM ${sql.raw(table)}
      WHERE company_id = ${companyId}
        AND vendor_id IN (${survivorId}, ${loserId})
      GROUP BY company_id
    `));
    if (Number(rows[0]?.count ?? 0) > 1) {
      throw new Error(`Cannot consolidate ${table}: both vendor IDs already have company-scoped records.`);
    }
  }
  const storeCollision = rowsOf(await ex.execute(sql`
    SELECT store_vendors.store_id AS "storeId"
    FROM store_vendors
    JOIN company_stores ON company_stores.id = store_vendors.store_id
    WHERE company_stores.company_id = ${companyId}
      AND store_vendors.vendor_id IN (${survivorId}, ${loserId})
    GROUP BY store_vendors.store_id
    HAVING count(DISTINCT store_vendors.vendor_id) > 1
    LIMIT 1
  `));
  if (storeCollision.length > 0) {
    throw new Error(`Cannot consolidate store_vendors: both vendor IDs are assigned to store ${storeCollision[0].storeId}.`);
  }
}

async function identityPreservationSnapshot(ex: Executor, companyId: string, vendorIds: string[]): Promise<Record<string, number>> {
  const rows = rowsOf(await ex.execute(sql`
    SELECT count(*)::int AS "vendorItemCount",
           count(DISTINCT inventory_item_id)::int AS "inventoryItemCount",
           count(DISTINCT id)::int AS "distinctVendorItemIds"
    FROM vendor_items
    WHERE vendor_id IN ${idSet(vendorIds)}
      AND EXISTS (
        SELECT 1 FROM vendors scoped_vendor
        WHERE scoped_vendor.id = vendor_items.vendor_id
          AND scoped_vendor.company_id = ${companyId}
      )
  `));
  const mappingRows = rowsOf(await ex.execute(sql`
    SELECT count(*)::int AS "mappingCount",
           count(DISTINCT vendor_item_id)::int AS "mappedVendorItemCount"
    FROM vendor_item_external_mappings
    WHERE vendor_item_id IN (
      SELECT vendor_items.id
      FROM vendor_items
      JOIN vendors scoped_vendor ON scoped_vendor.id = vendor_items.vendor_id
      WHERE vendor_items.vendor_id IN ${idSet(vendorIds)}
        AND scoped_vendor.company_id = ${companyId}
    )
  `));
  return {
    vendorItemCount: Number(rows[0]?.vendorItemCount ?? 0),
    inventoryItemCount: Number(rows[0]?.inventoryItemCount ?? 0),
    distinctVendorItemIds: Number(rows[0]?.distinctVendorItemIds ?? 0),
    mappingCount: Number(mappingRows[0]?.mappingCount ?? 0),
    mappedVendorItemCount: Number(mappingRows[0]?.mappedVendorItemCount ?? 0),
  };
}

export type VendorIdentityMergeResult =
  | { result: "applied"; auditId: string; survivorVendorId: string; loserVendorId: string; referencesRepointed: Record<string, number> }
  | { result: "already_remediated"; auditId: string; survivorVendorId: string; loserVendorId: string }
  | { result: "stopped"; code: string; reason: string };

/**
 * Apply only one explicitly authorized, evidence-bound pair. The caller must
 * pass the report hash and decision scope from a reviewed report; no
 * name-based lookup is performed here.
 */
export async function applyVendorIdentityMerge(params: {
  companyId: string;
  survivorVendorId: string;
  loserVendorId: string;
  evidenceReportHash: string;
  decisionScope: Record<string, unknown>;
}): Promise<VendorIdentityMergeResult> {
  if (!params.evidenceReportHash.trim()) {
    return { result: "stopped", code: "MISSING_REPORT_HASH", reason: "A bound report hash is required." };
  }
  if (params.survivorVendorId === params.loserVendorId) {
    return { result: "stopped", code: "SAME_VENDOR", reason: "Survivor and loser must be different vendor IDs." };
  }
  return db.transaction(async (tx: any) => {
    await ensureVendorIdentityAuditTable(tx);
    await assertVendorReferenceColumnsUnchanged(tx);
    const existing = rowsOf(await tx.execute(sql`
      SELECT id, survivor_vendor_id AS "survivorVendorId", loser_vendor_id AS "loserVendorId"
      FROM vendor_identity_merge_audit
      WHERE company_id = ${params.companyId}
        AND survivor_vendor_id = ${params.survivorVendorId}
        AND loser_vendor_id = ${params.loserVendorId}
        AND result = 'applied'
      LIMIT 1
    `));
    if (existing.length) {
      return {
        result: "already_remediated" as const,
        auditId: existing[0].id,
        survivorVendorId: params.survivorVendorId,
        loserVendorId: params.loserVendorId,
      };
    }
    const vendorRows = rowsOf(await tx.execute(sql`
      SELECT id, company_id AS "companyId", name, active
      FROM vendors
      WHERE company_id = ${params.companyId}
        AND id IN ${idSet([params.survivorVendorId, params.loserVendorId])}
      FOR UPDATE
    `));
    if (vendorRows.length !== 2) {
      return { result: "stopped" as const, code: "VENDOR_SCOPE_DRIFT", reason: "Both exact vendor IDs must exist in the expected company." };
    }
    const persistedEvidence = rowsOf(await tx.execute(sql`
      SELECT vendor_id AS "vendorId",
             company_id AS "companyId",
             COALESCE(vendor_name_snapshot, '') AS "vendorName",
             invoice_number AS "invoiceNumber",
             invoice_date AS "invoiceDate",
             source_system AS "sourceSystem",
             source_property_id AS "sourcePropertyId",
             source_invoice_id AS "sourceInvoiceId",
             vendor_external_id_snapshot AS "vendorExternalId"
      FROM historical_invoices
      WHERE company_id = ${params.companyId}
        AND vendor_id IN ${idSet([params.survivorVendorId, params.loserVendorId])}
        AND invoice_number IS NOT NULL
        AND btrim(invoice_number) <> ''
      ORDER BY vendor_id, invoice_date, invoice_number, id
    `)) as VendorIdentityEvidence[];
    const freshPair = compareVendorIdentityPair(
      vendorRows[0] as VendorIdentityVendor,
      vendorRows[1] as VendorIdentityVendor,
      persistedEvidence,
    );
    if (freshPair.classification !== "proven_same_vendor" || freshPair.evidenceStatus !== "reconciled") {
      return {
        result: "stopped" as const,
        code: "EVIDENCE_DRIFT",
        reason: `Persisted evidence no longer authorizes this pair: classification=${freshPair.classification}, evidenceStatus=${freshPair.evidenceStatus}.`,
      };
    }
    await assertNoUniqueConnectionCollision(tx, params.companyId, params.survivorVendorId, params.loserVendorId);
    const beforeRefs = await referenceCounts(tx, params.companyId, params.loserVendorId);
    const identityBefore = await identityPreservationSnapshot(tx, params.companyId, [params.survivorVendorId, params.loserVendorId]);
    const sourceSnapshots = rowsOf(await tx.execute(sql`
      SELECT id, company_id AS "companyId", name, account_number AS "accountNumber",
             order_guide_type AS "orderGuideType", active, qb_vendor_id AS "qbVendorId",
             source_of_truth AS "sourceOfTruth"
      FROM vendors
      WHERE company_id = ${params.companyId}
        AND id IN ${idSet([params.survivorVendorId, params.loserVendorId])}
      ORDER BY id
    `));
    const repointed: Record<string, number> = {};
    for (const source of VENDOR_IDENTITY_REFERENCE_SOURCES) {
      if (!source.mutable) continue;
      const result = await tx.execute(sql`
        UPDATE ${sql.raw(source.table)}
        SET ${sql.raw(source.column)} = ${params.survivorVendorId}
        WHERE ${scopedReferenceWhere(source, params.companyId, params.loserVendorId)}
      `);
      const count = Number(result?.rowCount ?? (Array.isArray(result) ? result.length : 0));
      if (count) repointed[`${source.table}.${source.column}`] = count;
    }
    const loserRemaining = await referenceCounts(tx, params.companyId, params.loserVendorId);
    if (Object.values(mutableReferenceCounts(loserRemaining)).some((count) => count !== 0)) {
      throw new Error(`Mutable vendor references remain on loser after repoint: ${JSON.stringify(mutableReferenceCounts(loserRemaining))}`);
    }
    const immutableBefore = immutableEvidenceCounts(beforeRefs);
    const immutableAfter = immutableEvidenceCounts(loserRemaining);
    if (JSON.stringify(immutableBefore) !== JSON.stringify(immutableAfter)) {
      throw new Error(`Immutable vendor evidence changed during consolidation: before=${JSON.stringify(immutableBefore)} after=${JSON.stringify(immutableAfter)}`);
    }
    const identityAfter = await identityPreservationSnapshot(tx, params.companyId, [params.survivorVendorId, params.loserVendorId]);
    if (JSON.stringify(identityBefore) !== JSON.stringify(identityAfter)) {
      throw new Error(`Vendor-item identity preservation failed: before=${JSON.stringify(identityBefore)} after=${JSON.stringify(identityAfter)}`);
    }
    await tx.execute(sql`
      UPDATE vendors
      SET active = 0
      WHERE id = ${params.loserVendorId} AND company_id = ${params.companyId}
    `);
    const inserted = rowsOf(await tx.execute(sql`
      INSERT INTO vendor_identity_merge_audit
        (company_id, survivor_vendor_id, loser_vendor_id, evidence_report_hash,
         decision_scope, source_vendor_snapshots, references_repointed,
         identity_preservation, result)
      VALUES
        (${params.companyId}, ${params.survivorVendorId}, ${params.loserVendorId},
         ${params.evidenceReportHash}, ${JSON.stringify(params.decisionScope)}::jsonb,
         ${JSON.stringify(sourceSnapshots)}::jsonb, ${JSON.stringify(repointed)}::jsonb,
          ${JSON.stringify({ vendorItemIdentity: identityAfter, immutableEvidence: immutableAfter })}::jsonb, 'applied')
      RETURNING id
    `));
    return {
      result: "applied" as const,
      auditId: inserted[0].id,
      survivorVendorId: params.survivorVendorId,
      loserVendorId: params.loserVendorId,
      referencesRepointed: repointed,
    };
  }, { isolationLevel: "serializable" });
}