import { describe, expect, it } from "vitest";
import { loadAndValidatePackage, SYSCO_HELD_VENDOR_ITEM_IDS } from "./vendorItemDuplicateGate2ApplyCli";
import { canonicalJson, sha256 } from "./vendorItemDuplicateGate2Package";
import { EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT } from "./vendorItemDuplicateGate2Readiness";
import {
  referenceKey,
  ReferenceSchemaCompatibilityError,
  VENDOR_ITEM_REFERENCE_SOURCES,
  validateReferenceColumnCompatibility,
} from "./vendorItemDuplicateReferenceCompatibility";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CLASSIFIER_BYTES = Buffer.from('{"classifier":"production-fixture"}');
const READINESS_BYTES = Buffer.from('{"readiness":"production-fixture"}');

const PKG_PATH = "/external/prod/vendor-item-production-gate2-package.json";
const CLASSIFIER_PATH = "/external/prod/classifier.json";
const READINESS_PATH = "/external/prod/readiness.json";
const APP_ROOT = "/app/checkout";

/**
 * Build a minimal but valid Gate 2 package JSON string.
 * First group absorbs the extra losers so the total reaches 6,038.
 * Overrides allow injecting specific broken values.
 */
function buildPackageJson(
  coreOverrides: Partial<Record<string, unknown>> = {},
  skipPackageId = false,
): string {
  // 2428 single-loser groups + 1 group with (6038 - 2428 = 3610) losers = 6038 total.
  const extraLosers = EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT - 2428;
  const reviewedGroups = [
    {
      groupKey: { vendorId: "v-0", inventoryItemId: "i-0", vendorSku: "sku-0" },
      survivorId: "surv-0",
      loserIds: Array.from({ length: extraLosers }, (_, j) => `loser-0-${j}`),
      transactionalReferenceRepoints: [],
    },
    ...Array.from({ length: 2428 }, (_, k) => ({
      groupKey: { vendorId: `v-${k + 1}`, inventoryItemId: `i-${k + 1}`, vendorSku: `sku-${k + 1}` },
      survivorId: `surv-${k + 1}`,
      loserIds: [`loser-${k + 1}`],
      transactionalReferenceRepoints: [],
    })),
  ];

  const core: Record<string, unknown> = {
    format: "vendor-item-production-gate2-package-v1",
    executionProhibited: true,
    sourceClassifierReport: {
      absolutePath: CLASSIFIER_PATH,
      fileSha256: sha256(CLASSIFIER_BYTES),
      database: "production-db",
      acceptedBaseline: { duplicateGroups: 2430, excessRows: 6039, classAGroups: 2429, classALoserRows: 6038 },
      loserSetSha256: "placeholder",
      classAGroupMembershipSha256: "placeholder",
    },
    readinessEvidence: {
      absolutePath: READINESS_PATH,
      fileSha256: sha256(READINESS_BYTES),
      database: "production-db",
      ediSoftReferenceRisk: "CLOSED",
    },
    referenceCompatibility: {},
    reviewedGroups,
    excludedHeldGroups: {
      rule: "all non-Class-A groups remain excluded",
      syscoSku7664436: {
        vendorItemIds: ["04f822ba-fb2d-479e-9f9b-6aefc4b0af90", "ca185955-ce85-4c92-be7e-875974c0100d"],
        inventoryItemId: "2030960c-3c95-49fd-8ccc-56eae6b5e615",
        requiresLaterExplicitPmDisposition: true,
      },
    },
    futureExecutionRequirements: ["Separate PM authorization required."],
    expectedBeforeAfter: {
      loserRowsToDelete: 6038,
      duplicateGroupsToMerge: 2429,
      valuationInvariant: "",
      catalogInvariant: "",
      idempotencyAnchor: "",
      recoveryRequirement: "",
    },
    ...coreOverrides,
  };

  if (skipPackageId) return JSON.stringify(core);
  return JSON.stringify({ ...core, packageId: sha256(canonicalJson(core)) });
}

function mockReader(files: Record<string, Buffer>): (p: string) => Buffer {
  return (p) => {
    if (Object.prototype.hasOwnProperty.call(files, p)) return files[p];
    throw Object.assign(new Error(`File not found in mock: ${p}`), { code: "ENOENT" });
  };
}

function standardReader(pkgJson: string): (p: string) => Buffer {
  return mockReader({
    [PKG_PATH]: Buffer.from(pkgJson),
    [CLASSIFIER_PATH]: CLASSIFIER_BYTES,
    [READINESS_PATH]: READINESS_BYTES,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadAndValidatePackage", () => {
  it("accepts a valid package and returns the correct group and loser set", () => {
    const json = buildPackageJson();
    const result = loadAndValidatePackage(PKG_PATH, APP_ROOT, standardReader(json));

    expect(result.groups).toHaveLength(2429);
    expect(result.loserSet.size).toBe(EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT);
    expect(result.pkg.packageId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses a package with a tampered packageId", () => {
    const json = buildPackageJson();
    const tampered = JSON.parse(json);
    tampered.packageId = "a".repeat(64);
    expect(() =>
      loadAndValidatePackage(PKG_PATH, APP_ROOT, standardReader(JSON.stringify(tampered))),
    ).toThrow(/integrity check failed/);
  });

  it("refuses a package with a tampered core field (recomputed id no longer matches)", () => {
    const json = buildPackageJson();
    const tampered = JSON.parse(json);
    tampered.executionProhibited = false; // modifies core — stored packageId no longer valid
    expect(() =>
      loadAndValidatePackage(PKG_PATH, APP_ROOT, standardReader(JSON.stringify(tampered))),
    ).toThrow(/executionProhibited:true|integrity check failed/);
  });

  it("refuses when a classifier evidence file hash does not match", () => {
    const json = buildPackageJson();
    const reader = mockReader({
      [PKG_PATH]: Buffer.from(json),
      [CLASSIFIER_PATH]: Buffer.from("corrupted content"),
      [READINESS_PATH]: READINESS_BYTES,
    });
    expect(() => loadAndValidatePackage(PKG_PATH, APP_ROOT, reader)).toThrow(/classifier report file hash mismatch/);
  });

  it("refuses when a readiness evidence file hash does not match", () => {
    const json = buildPackageJson();
    const reader = mockReader({
      [PKG_PATH]: Buffer.from(json),
      [CLASSIFIER_PATH]: CLASSIFIER_BYTES,
      [READINESS_PATH]: Buffer.from("corrupted readiness"),
    });
    expect(() => loadAndValidatePackage(PKG_PATH, APP_ROOT, reader)).toThrow(/readiness evidence file hash mismatch/);
  });

  it("refuses when the EDI soft-reference risk is not CLOSED", () => {
    const json = buildPackageJson({
      readinessEvidence: {
        absolutePath: READINESS_PATH,
        fileSha256: sha256(READINESS_BYTES),
        database: "production-db",
        ediSoftReferenceRisk: "STOP",
      },
    });
    // packageId will be wrong for this core so the integrity check fires first —
    // either error is a valid refusal; the important thing is it does not succeed.
    expect(() =>
      loadAndValidatePackage(PKG_PATH, APP_ROOT, standardReader(json)),
    ).toThrow();
  });

  it("refuses when a Sysco held vendor-item ID appears as a loser", () => {
    const syscoId = [...SYSCO_HELD_VENDOR_ITEM_IDS][0];
    // Build the package with Sysco ID injected into a group's loserIds.
    const extraLosers = EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT - 2428 - 1; // one slot replaced by Sysco
    const reviewedGroups = [
      {
        groupKey: { vendorId: "v-0", inventoryItemId: "i-0", vendorSku: "sku-0" },
        survivorId: "surv-0",
        loserIds: [
          ...Array.from({ length: extraLosers }, (_, j) => `loser-0-${j}`),
          syscoId, // injected Sysco ID
        ],
        transactionalReferenceRepoints: [],
      },
      ...Array.from({ length: 2428 }, (_, k) => ({
        groupKey: { vendorId: `v-${k + 1}`, inventoryItemId: `i-${k + 1}`, vendorSku: `sku-${k + 1}` },
        survivorId: `surv-${k + 1}`,
        loserIds: [`loser-${k + 1}`],
        transactionalReferenceRepoints: [],
      })),
    ];
    const json = buildPackageJson({ reviewedGroups });
    expect(() =>
      loadAndValidatePackage(PKG_PATH, APP_ROOT, standardReader(json)),
    ).toThrow(/Sysco held vendor item.*loser/);
  });

  it("refuses when a Sysco held vendor-item ID appears as a survivor", () => {
    const syscoId = [...SYSCO_HELD_VENDOR_ITEM_IDS][1];
    const extraLosers = EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT - 2428;
    const reviewedGroups = [
      {
        groupKey: { vendorId: "v-0", inventoryItemId: "i-0", vendorSku: "sku-0" },
        survivorId: syscoId, // injected Sysco ID as survivor
        loserIds: Array.from({ length: extraLosers }, (_, j) => `loser-0-${j}`),
        transactionalReferenceRepoints: [],
      },
      ...Array.from({ length: 2428 }, (_, k) => ({
        groupKey: { vendorId: `v-${k + 1}`, inventoryItemId: `i-${k + 1}`, vendorSku: `sku-${k + 1}` },
        survivorId: `surv-${k + 1}`,
        loserIds: [`loser-${k + 1}`],
        transactionalReferenceRepoints: [],
      })),
    ];
    const json = buildPackageJson({ reviewedGroups });
    expect(() =>
      loadAndValidatePackage(PKG_PATH, APP_ROOT, standardReader(json)),
    ).toThrow(/Sysco held vendor item.*survivor/);
  });

  it("refuses when reviewedGroups count does not match 2,429", () => {
    // Build a package with only 2 groups — packageId will be wrong since core differs.
    const reviewedGroups = [
      {
        groupKey: { vendorId: "v-0", inventoryItemId: "i-0", vendorSku: "sku-0" },
        survivorId: "surv-0",
        loserIds: ["loser-0"],
        transactionalReferenceRepoints: [],
      },
    ];
    const json = buildPackageJson({ reviewedGroups });
    expect(() =>
      loadAndValidatePackage(PKG_PATH, APP_ROOT, standardReader(json)),
    ).toThrow();
  });

  it("refuses when an evidence path is inside the application checkout", () => {
    const insidePath = `${APP_ROOT}/reports/classifier.json`;
    const json = buildPackageJson({
      sourceClassifierReport: {
        absolutePath: insidePath,
        fileSha256: sha256(CLASSIFIER_BYTES),
        database: "production-db",
        acceptedBaseline: {},
        loserSetSha256: "",
        classAGroupMembershipSha256: "",
      },
    });
    const reader = mockReader({
      [PKG_PATH]: Buffer.from(json),
      [insidePath]: CLASSIFIER_BYTES,
      [READINESS_PATH]: READINESS_BYTES,
    });
    expect(() => loadAndValidatePackage(PKG_PATH, APP_ROOT, reader)).toThrow(
      /outside the application checkout/,
    );
  });

  it("is deterministic — same input produces the same loser set and packageId", () => {
    const json = buildPackageJson();
    const r1 = loadAndValidatePackage(PKG_PATH, APP_ROOT, standardReader(json));
    const r2 = loadAndValidatePackage(PKG_PATH, APP_ROOT, standardReader(json));
    expect(r1.pkg.packageId).toBe(r2.pkg.packageId);
    expect(r1.loserSet.size).toBe(r2.loserSet.size);
  });
});

// ── Reference schema preflight — apply CLI contract ──────────────────────────
// These tests verify the three cases the apply CLI preflight must handle via
// validateReferenceColumnCompatibility (the same function used by the
// classifier and readiness CLIs).

const OPTIONAL_REF_KEY = "vendor_invoice_import_lines.resolved_vendor_item_id";
const REQUIRED_COLS = VENDOR_ITEM_REFERENCE_SOURCES
  .filter((s) => !s.legacyOptional)
  .map(referenceKey);
const ALL_COLS = VENDOR_ITEM_REFERENCE_SOURCES.map(referenceKey);

describe("apply CLI reference schema preflight", () => {
  it("accepts the legacy production schema (resolved_vendor_item_id absent) and marks it legacy_optional_absent", () => {
    // Verification 1: legacy production fixture with this exact column absent → PASS
    const result = validateReferenceColumnCompatibility(REQUIRED_COLS);
    expect(result.sourceCompatibility[OPTIONAL_REF_KEY].compatibilityState).toBe(
      "legacy_optional_absent",
    );
    expect(result.presentSources.map(referenceKey)).not.toContain(OPTIONAL_REF_KEY);
  });

  it("accepts a newer schema (resolved_vendor_item_id present) and includes it in presentSources", () => {
    // Verification 2: newer fixture with column present → PASS and reference counted/repointable
    const result = validateReferenceColumnCompatibility(ALL_COLS);
    expect(result.sourceCompatibility[OPTIONAL_REF_KEY].compatibilityState).toBe(
      "current_present",
    );
    expect(result.presentSources.map(referenceKey)).toContain(OPTIONAL_REF_KEY);
  });

  it("fails closed for any unexpected reference column", () => {
    // Verification 3: unexpected reference drift → FAIL CLOSED
    expect(() =>
      validateReferenceColumnCompatibility([
        ...REQUIRED_COLS,
        "unexpected_table.vendor_item_id",
      ]),
    ).toThrow(ReferenceSchemaCompatibilityError);
  });

  it("fails closed when a required reference column is absent", () => {
    // Verification 3 (required missing): → FAIL CLOSED
    expect(() =>
      validateReferenceColumnCompatibility(REQUIRED_COLS.slice(1)),
    ).toThrow(ReferenceSchemaCompatibilityError);
  });
});
