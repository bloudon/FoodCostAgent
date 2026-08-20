/**
 * Gate 1 CLI — READ-ONLY vendor-item duplicate classifier.
 *
 * Runs the classifier over the connected database and emits the PM report
 * (markdown to stdout + JSON/markdown files under reports/). Performs ZERO
 * database writes; every query is a SELECT.
 *
 * Usage:  npx tsx src/services/orderly/vendorItemDuplicateClassifierCli.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  classifyGroups,
  PACK_EQUIVALENCE_CONTRACT,
  type ClassifierVendorItemRow,
  type ExternalMappingRow,
  type ReferenceCounts,
  type ClassifiedGroup,
} from "./vendorItemDuplicateClassifier";
import {
  referenceKey,
  validateReferenceColumnCompatibility,
  VENDOR_ITEM_REFERENCE_SOURCES,
} from "./vendorItemDuplicateReferenceCompatibility";

function rowsOf(r: any): any[] {
  return Array.isArray(r) ? r : r.rows;
}

type QueryExecutor = {
  execute(query: any): Promise<any>;
};

type ClassifierRuntime = {
  execute?: QueryExecutor["execute"];
  classify?: typeof classifyGroups;
  emitReport?: (report: any) => { jsonPath: string; mdPath: string };
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function writeReport(report: any): { jsonPath: string; mdPath: string } {
  const configuredOutDir = process.env.VENDOR_ITEM_DUPLICATE_REPORT_DIR;
  if (configuredOutDir && !path.isAbsolute(configuredOutDir)) {
    throw new Error("VENDOR_ITEM_DUPLICATE_REPORT_DIR must be an absolute path when set.");
  }
  const outDir = configuredOutDir
    ? path.resolve(configuredOutDir)
    : path.resolve(import.meta.dirname, "../../../reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "vendor-item-duplicate-classification.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const mdPath = path.join(outDir, "vendor-item-duplicate-classification.md");
  fs.writeFileSync(mdPath, renderMarkdown(report));
  return { jsonPath, mdPath };
}

/**
 * Runs the read-only classifier. The schema/reference guard is deliberately
 * first: before vendor_items, external mappings, reference counts, duplicate
 * classification, or report emission can occur.
 */
export async function runVendorItemDuplicateClassifier(runtime: ClassifierRuntime = {}) {
  const execute = runtime.execute ?? ((query: any) => db.execute(query));
  const classify = runtime.classify ?? classifyGroups;
  const emitReport = runtime.emitReport ?? writeReport;
  const log = runtime.log ?? console.log;

  const dbIdent = rowsOf(await execute(sql`SELECT current_database() AS db, inet_server_addr()::text AS addr`))[0] ?? {};
  log(`[Classifier] READ-ONLY run against database='${dbIdent.db}'`);

  // ── Fail-closed reference enumeration ──────────────────────────────────────
  const liveRefCols = rowsOf(await execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name LIKE '%vendor_item%'
      AND table_name <> 'vendor_items'
    ORDER BY table_name, column_name`)).map((x: any) => `${x.table_name}.${x.column_name}`);
  const referenceCompatibility = validateReferenceColumnCompatibility(liveRefCols);

  // ── Load vendor items ──────────────────────────────────────────────────────
  const items: ClassifierVendorItemRow[] = rowsOf(await execute(sql`
    SELECT id, vendor_id AS "vendorId", inventory_item_id AS "inventoryItemId",
           vendor_sku AS "vendorSku", brand_name AS "brandName",
           purchase_unit_id AS "purchaseUnitId", case_size AS "caseSize",
           inner_pack_size AS "innerPackSize", pack_uom AS "packUom",
           last_price AS "lastPrice", last_case_price AS "lastCasePrice",
           active, price_source AS "priceSource",
           canonical_qty_per_purchase_unit AS "canonicalQtyPerPurchaseUnit",
           pricing_basis AS "pricingBasis", is_variable_weight AS "isVariableWeight",
           pack_geometry_status AS "packGeometryStatus"
    FROM vendor_items`));

  const mappings: ExternalMappingRow[] = rowsOf(await execute(sql`
    SELECT vendor_item_id AS "vendorItemId", source_system AS "sourceSystem",
           source_property_id AS "sourcePropertyId", source_external_id AS "sourceExternalId"
    FROM vendor_item_external_mappings`));

  // ── Reference counts per vendor item, per table ────────────────────────────
  const referenceCounts: ReferenceCounts = new Map();
  const refTotalsByTable: Record<string, number> = {};
  for (const source of referenceCompatibility.presentSources) {
    const key = referenceKey(source);
    const r = rowsOf(await execute(sql.raw(
      `SELECT ${source.column} AS id, count(*)::int AS n FROM ${source.table} WHERE ${source.column} IS NOT NULL GROUP BY ${source.column}`,
    )));
    refTotalsByTable[key] = 0;
    for (const row of r) {
      refTotalsByTable[key] += row.n;
      const m = referenceCounts.get(row.id) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + row.n);
      referenceCounts.set(row.id, m);
    }
    referenceCompatibility.sourceCompatibility[key].applicableReferences = refTotalsByTable[key];
  }

  // ── Classify ───────────────────────────────────────────────────────────────
  const groups = classify({ rows: items, mappings, referenceCounts });

  const byClass = (c: string) => groups.filter((g) => g.class === c);
  const excessRows = groups.reduce((s, g) => s + g.size - 1, 0);
  const classA = byClass("A");
  const classB = byClass("B");
  const classC = byClass("C");
  const classD = byClass("D");
  const classE = byClass("E");
  const cAuthoritative = classC.filter((g) => g.cAuthoritativelySame);
  const mergeable = [...classA, ...cAuthoritative];
  const proposedDeletions = mergeable.reduce((s, g) => s + g.proposedDeletions, 0);
  const aWithPriceDiff = classA.filter((g) => g.priceSnapshotsDiffer);
  const aWithCosmeticPack = classA.filter((g) => g.cosmeticPackUomDiff);
  const normSensitive = groups.filter((g) => g.normalizationSensitive);

  // Loser reference exposure by table (what a Class A merge must repoint)
  const loserRefsByTable: Record<string, number> = {};
  for (const g of mergeable) {
    for (const [t, n] of Object.entries(g.referenceCountsByTable)) {
      loserRefsByTable[t] = (loserRefsByTable[t] ?? 0) + n;
    }
  }

  // Vendor scoping + Harvill's callout
  const vendorRows = rowsOf(await execute(sql`SELECT id, name, company_id AS "companyId" FROM vendors`));
  const vendorName = new Map<string, string>(vendorRows.map((v: any) => [v.id, v.name]));
  const harvill = vendorRows.find((v: any) => /harvill/i.test(v.name));
  const harvillGroups = harvill ? groups.filter((g) => g.key.vendorId === harvill.id) : [];
  const harvillA = harvillGroups.filter((g) => g.class === "A");

  // Companies affected
  const companiesAffected = new Set(
    groups.map((g) => vendorRows.find((v: any) => v.id === g.key.vendorId)?.companyId).filter(Boolean),
  );

  // Sensitivity: groups that would merge if SKU were trimmed/uppercased
  const skuNormSensitivity = (() => {
    const seen = new Map<string, Set<string>>();
    for (const it of items) {
      if (it.vendorSku === null || it.vendorSku.trim() === "") continue;
      const k = JSON.stringify([it.vendorId, it.inventoryItemId, it.vendorSku.trim().toUpperCase()]);
      const s = seen.get(k) ?? new Set();
      s.add(it.vendorSku);
      seen.set(k, s);
    }
    return [...seen.values()].filter((s) => s.size > 1).length;
  })();

  // Constraint diagnostics: does one vendor+SKU ever span multiple inventory items?
  const skuSpansItems = rowsOf(await execute(sql`
    SELECT count(*)::int AS n FROM (
      SELECT vendor_id, vendor_sku
      FROM vendor_items
      WHERE vendor_sku IS NOT NULL AND btrim(vendor_sku) <> ''
      GROUP BY vendor_id, vendor_sku
      HAVING count(DISTINCT inventory_item_id) > 1) x`))[0].n;

  const nonNullSkuBlockers = classB.length + classD.length + classE.length;
  const recommendedConstraint =
    nonNullSkuBlockers === 0
      ? "Partial unique index UNIQUE(vendor_id, inventory_item_id, vendor_sku) WHERE vendor_sku IS NOT NULL AND btrim(vendor_sku) <> '' — safe once Class A merged; NULL/blank-SKU rows deliberately NOT constrained (Class C held)."
      : `HOLD any (vendor_id, inventory_item_id, vendor_sku) uniqueness: ${nonNullSkuBlockers} non-Class-A duplicate groups with real SKUs exist (B=${classB.length}, D=${classD.length}, E=${classE.length}); a strong constraint would forbid rows PM has not yet ruled on. Recommend deciding B/D/E disposition first, or a narrower constraint excluding those groups.`;

  const report = {
    generatedAt: new Date().toISOString(),
    database: dbIdent.db,
    readOnly: true,
    packEquivalenceContract: PACK_EQUIVALENCE_CONTRACT,
    totals: {
      totalVendorItems: items.length,
      duplicateGroups: groups.length,
      excessRows,
      companiesAffected: [...companiesAffected],
    },
    classes: {
      A: { groups: classA.length, excessRows: classA.reduce((s, g) => s + g.size - 1, 0) },
      B: { groups: classB.length, excessRows: classB.reduce((s, g) => s + g.size - 1, 0) },
      C: {
        groups: classC.length,
        excessRows: classC.reduce((s, g) => s + g.size - 1, 0),
        nullSku: classC.filter((g) => g.skuKind === "null").length,
        blankSku: classC.filter((g) => g.skuKind === "blank").length,
        authoritativelySameMergeable: cAuthoritative.length,
        shadowClassBreakdown: classC.reduce<Record<string, number>>((acc, g) => {
          acc[g.shadowClass ?? "?"] = (acc[g.shadowClass ?? "?"] ?? 0) + 1;
          return acc;
        }, {}),
      },
      D: { groups: classD.length, excessRows: classD.reduce((s, g) => s + g.size - 1, 0) },
      E: { groups: classE.length, excessRows: classE.reduce((s, g) => s + g.size - 1, 0) },
    },
    pmAmendmentMetrics: {
      classAGroupsWithDifferingPriceSnapshots: aWithPriceDiff.length,
      classAGroupsWithCosmeticRawPackDifferences: aWithCosmeticPack.length,
      groupsWhoseClassDependsOnNormalizationAssumptions: normSensitive.length,
      groupsThatWouldMergeUnderSkuTrimUppercase: skuNormSensitivity,
    },
    harvills: harvill
      ? {
          vendorId: harvill.id,
          totalGroups: harvillGroups.length,
          classAGroups: harvillA.length,
          classARows: harvillA.reduce((s, g) => s + g.size, 0),
          classAProposedDeletions: harvillA.reduce((s, g) => s + g.proposedDeletions, 0),
          byClass: harvillGroups.reduce<Record<string, number>>((acc, g) => {
            acc[g.class] = (acc[g.class] ?? 0) + 1;
            return acc;
          }, {}),
        }
      : null,
    references: {
      dbSchemaColumns: liveRefCols,
      sourceCompatibility: referenceCompatibility.sourceCompatibility,
      totalsByColumn: refTotalsByTable,
      loserReferencesToRepointByColumn: loserRefsByTable,
      repoLevelSoftReferences:
        "Repo audit found no confirmed persistence of vendor item ids into JSON/jsonb payloads. One conditional site: edi_messages.payload_json (normalized PO serialization) — verify PO payload shape before Gate 2 apply.",
      auditProvenanceColumns: [
        "po_routing_audit.vendor_item_id",
        "po_routing_audit.source_vendor_item_id",
        "inventory_item_price_history.vendor_item_id",
        "historical_invoice_lines.vendor_item_id",
        "vendor_invoice_import_lines.resolved_vendor_item_id",
        "vendor_item_external_mappings.vendor_item_id",
      ],
    },
    proposal: {
      mergeableGroups: mergeable.length,
      proposedSurvivors: mergeable.length,
      proposedDeletions,
      survivorTiebreakNote:
        "vendor_items has no created_at column; deterministic tiebreak after external-mapping and reference-count rules is the lexicographically smallest id.",
      recommendedUniquenessConstraint: recommendedConstraint,
    },
    heldGroupSamples: [...classB, ...classD, ...classE].slice(0, 20).map((g) => ({
      vendor: vendorName.get(g.key.vendorId),
      inventoryItemId: g.key.inventoryItemId,
      sku: g.key.vendorSku,
      class: g.class,
      size: g.size,
      reasons: g.reasons,
    })),
    groups,
  };

  const { jsonPath, mdPath } = emitReport(report);
  log(renderMarkdown(report));
  log(`\n[Classifier] Full JSON: ${jsonPath}\n[Classifier] Markdown:  ${mdPath}`);
  return report;
}

function renderMarkdown(r: any): string {
  const c = r.classes;
  return `# Gate 1 Classifier Report — Duplicate vendor catalog rows (READ-ONLY)

Generated: ${r.generatedAt} · database: ${r.database} · **no writes performed**

## Pack-equivalence contract used
\`\`\`
${r.packEquivalenceContract}
\`\`\`

## Totals
| Metric | Value |
|---|---|
| Total vendor_items | ${r.totals.totalVendorItems} |
| Duplicate groups | ${r.totals.duplicateGroups} |
| Excess rows | ${r.totals.excessRows} |
| Companies affected | ${r.totals.companiesAffected.length} |

## Classification
| Class | Groups | Excess rows | Disposition |
|---|---|---|---|
| A — exact duplicate purchasing identity | ${c.A.groups} | ${c.A.excessRows} | AUTO-MERGE CANDIDATES |
| B — same SKU, conflicting pack geometry | ${c.B.groups} | ${c.B.excessRows} | HOLD |
| C — NULL/blank SKU (null=${c.C.nullSku}, blank=${c.C.blankSku}) | ${c.C.groups} | ${c.C.excessRows} | HOLD except ${c.C.authoritativelySameMergeable} authoritative-identity groups |
| D — conflicting external/source mappings | ${c.D.groups} | ${c.D.excessRows} | HOLD |
| E — protected config disagreement | ${c.E.groups} | ${c.E.excessRows} | HOLD |

Class C shadow classes (what each would be if SKU-less-ness were ignored): ${JSON.stringify(c.C.shadowClassBreakdown)}

## PM amendment metrics
| Metric | Value |
|---|---|
| Class A groups with differing price snapshots (diagnostic only, still A) | ${r.pmAmendmentMetrics.classAGroupsWithDifferingPriceSnapshots} |
| Class A groups with cosmetic raw-pack (pack_uom) differences | ${r.pmAmendmentMetrics.classAGroupsWithCosmeticRawPackDifferences} |
| Groups whose class depends on normalization assumptions (null-vs-value canonical qty) | ${r.pmAmendmentMetrics.groupsWhoseClassDependsOnNormalizationAssumptions} |
| Additional groups that would merge under SKU trim/uppercase (NOT applied) | ${r.pmAmendmentMetrics.groupsThatWouldMergeUnderSkuTrimUppercase} |

## Harvill's Produce
${r.harvills ? `| Metric | Value |
|---|---|
| Duplicate groups | ${r.harvills.totalGroups} |
| Class A groups | ${r.harvills.classAGroups} |
| Class A rows | ${r.harvills.classARows} |
| Proposed deletions (Class A only) | ${r.harvills.classAProposedDeletions} |
| By class | ${JSON.stringify(r.harvills.byClass)} |` : "vendor not found"}

## Reference inventory (dynamically enumerated, fail-closed)
DB/schema columns holding vendor_items ids (bucket 1):
${Object.entries(r.references.sourceCompatibility).map(([x, status]: [string, any]) => `- \`${x}\` — present: ${status.present}; applicable references: ${status.applicableReferences}; compatibility: ${status.compatibilityState}; held by would-be losers: ${r.references.loserReferencesToRepointByColumn[x] ?? 0}`).join("\n")}

Repo-level soft references (bucket 2): ${r.references.repoLevelSoftReferences}

Audit/provenance columns (bucket 3 — stored IDs without FK semantics, repointed not dropped):
${r.references.auditProvenanceColumns.map((x: string) => `- \`${x}\``).join("\n")}

## Merge proposal (Gate 2 — HOLD, pending PM approval)
| Metric | Value |
|---|---|
| Mergeable groups (A + authoritative C) | ${r.proposal.mergeableGroups} |
| Proposed survivors | ${r.proposal.proposedSurvivors} |
| Proposed deletions | ${r.proposal.proposedDeletions} |

Survivor rule: authoritative external mapping target → most downstream references → ${r.proposal.survivorTiebreakNote}

## Recommended uniqueness constraint
${r.proposal.recommendedUniquenessConstraint}

## Held group samples (B/D/E, first 20)
${r.heldGroupSamples.map((g: any) => `- [${g.class}] ${g.vendor} · sku=${JSON.stringify(g.sku)} · ${g.size} rows — ${g.reasons.join("; ")}`).join("\n") || "(none)"}

**STOP. No writes, no uniqueness constraint, no insert-path refactor until PM approves Gate 2.**
`;
}

/**
 * Maps a fail-closed guard failure to a non-zero process result without making
 * test processes terminate. The operator command still receives a non-zero
 * exit code and no report is emitted when the guard rejects the schema.
 */
export async function executeVendorItemDuplicateClassifier(runtime: ClassifierRuntime = {}): Promise<number> {
  try {
    await runVendorItemDuplicateClassifier(runtime);
    return 0;
  } catch (error) {
    (runtime.error ?? console.error)(String(error));
    process.exitCode = 1;
    return 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void executeVendorItemDuplicateClassifier();
}
