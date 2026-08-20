/**
 * Production Gate 2 readiness evidence — READ ONLY.
 *
 * This is intentionally separate from the Gate 2 merge CLI. It reads the
 * production Gate 1 classifier report supplied by the operator, verifies that
 * report is the approved production baseline, inspects the single held Sysco
 * group, and scans EDI payload structure without emitting payload bodies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { ClassifierVendorItemRow } from "./vendorItemDuplicateClassifier";
import {
  extractProductionClassALoserIds,
  normalizeSyscoRow,
  summarizeEdiPayloads,
  type SyscoEvidenceRow,
} from "./vendorItemDuplicateGate2Readiness";
import {
  referenceKey,
  validateReferenceColumnCompatibility,
} from "./vendorItemDuplicateReferenceCompatibility";

const SYSCO_NAME = "Sysco";
const SYSCO_SKU = "7664436";

function rowsOf(result: any): any[] {
  return Array.isArray(result) ? result : result.rows;
}

type QueryExecutor = { execute(query: any): Promise<any> };
type Runtime = {
  execute?: QueryExecutor["execute"];
  loadClassifierReport?: () => unknown;
  emitReport?: (report: unknown) => { jsonPath: string; markdownPath: string };
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function requireAbsoluteFile(envName: string): string {
  const value = process.env[envName];
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${envName} must be an absolute path.`);
  }
  return value;
}

function loadClassifierReportFromFile(): unknown {
  const reportPath = requireAbsoluteFile("VENDOR_ITEM_DUPLICATE_REPORT_PATH");
  let raw: string;
  try {
    raw = fs.readFileSync(reportPath, "utf8");
  } catch {
    throw new Error(`Unable to read VENDOR_ITEM_DUPLICATE_REPORT_PATH: ${reportPath}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("VENDOR_ITEM_DUPLICATE_REPORT_PATH is not valid JSON.");
  }
}

function renderMarkdown(report: any): string {
  const sysco = report.syscoClassB;
  const edi = report.ediSoftReferenceEvidence;
  return `# Production Gate 2 Readiness Evidence — READ ONLY

Generated: ${report.generatedAt} · database: ${report.database} · **no production writes performed**

## Source report binding
- Classifier report database: \`${report.classifierReportDatabase}\`
- Derived production Class A loser IDs: **${report.productionClassALoserCount}**
- Required production baseline: 2,430 groups / 6,039 excess rows / 2,429 Class A groups / 6,038 Class A losers

## Sysco held Class B evidence
- Vendor: ${SYSCO_NAME}
- SKU: ${SYSCO_SKU}
- Rows returned: **${sysco.rows.length}**
- Decision: **No winner or loser decision made.**

\`\`\`json
${JSON.stringify(sysco, null, 2)}
\`\`\`

## EDI soft-reference evidence
| Metric | Value |
|---|---:|
| Total messages inspected | ${edi.totalMessagesInspected} |
| Messages containing any vendor-item identity | ${edi.messagesContainingAnyVendorItemIdentity} |
| Messages containing proposed loser IDs | ${edi.messagesContainingProposedLoserIds} |
| Distinct proposed loser IDs referenced | ${edi.distinctProposedLoserIdsReferenced} |
| Risk result | **${edi.softReferenceRisk}** |

Representative structural paths only:
${edi.representativeStructuralPaths.map((value: string) => `- \`${value}\``).join("\n") || "- (none)"}

${edi.requiredReferenceContract ? `## STOP — required future reference contract\n${edi.requiredReferenceContract}` : "## EDI risk closed\nNo proposed production Class A loser identity was found in persisted EDI payloads."}

**STOP. This tool does not delete duplicates, repoint references, create an index, migrate schema, restart PM2, or invoke Orderly preview/APPLY.**
`;
}

function writeReport(report: unknown): { jsonPath: string; markdownPath: string } {
  const configuredDir = process.env.VENDOR_ITEM_GATE2_READINESS_REPORT_DIR;
  if (!configuredDir || !path.isAbsolute(configuredDir)) {
    throw new Error("VENDOR_ITEM_GATE2_READINESS_REPORT_DIR must be an absolute path.");
  }
  const outputDir = path.resolve(configuredDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "vendor-item-gate2-readiness.json");
  const markdownPath = path.join(outputDir, "vendor-item-gate2-readiness.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  return { jsonPath, markdownPath };
}

function idsJson(ids: readonly string[]): string {
  return JSON.stringify(ids);
}

async function loadDownstreamReferenceCounts(
  execute: QueryExecutor["execute"],
  ids: readonly string[],
  sources: readonly { table: string; column: string }[],
): Promise<Record<string, Record<string, number>>> {
  const counts: Record<string, Record<string, number>> = Object.fromEntries(ids.map((id) => [id, {}]));
  for (const source of sources) {
    const key = referenceKey(source);
    const rows = rowsOf(await execute(sql`
      SELECT ${sql.raw(source.column)} AS id, count(*)::int AS n
      FROM ${sql.raw(source.table)}
      WHERE ${sql.raw(source.column)} IN (
        SELECT jsonb_array_elements_text(${idsJson(ids)}::jsonb)
      )
      GROUP BY ${sql.raw(source.column)}
    `));
    for (const row of rows) {
      counts[row.id] ??= {};
      counts[row.id][key] = row.n;
    }
  }
  return counts;
}

/**
 * Guard order: database identity and the reviewed reference contract are
 * checked before any vendor-item, mapping, or EDI evidence query.
 */
export async function runVendorItemDuplicateGate2Readiness(runtime: Runtime = {}) {
  const execute = runtime.execute ?? ((query: any) => db.execute(query));
  const log = runtime.log ?? console.log;
  const loadClassifierReport = runtime.loadClassifierReport ?? loadClassifierReportFromFile;
  const emitReport = runtime.emitReport ?? writeReport;

  const dbName = rowsOf(await execute(sql`SELECT current_database() AS db`))[0]?.db;
  if (!dbName) throw new Error("Unable to determine connected database identity.");

  const liveReferences = rowsOf(await execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name LIKE '%vendor_item%'
      AND table_name <> 'vendor_items'
    ORDER BY table_name, column_name
  `)).map((row: any) => `${row.table_name}.${row.column_name}`);
  const referenceCompatibility = validateReferenceColumnCompatibility(liveReferences);

  const { database: classifierReportDatabase, loserIds } = extractProductionClassALoserIds(loadClassifierReport());
  if (classifierReportDatabase !== dbName) {
    throw new Error(
      `Classifier report database '${classifierReportDatabase}' does not match the connected database '${dbName}'.`,
    );
  }

  const syscoRows = rowsOf(await execute(sql`
    SELECT vi.id, vi.vendor_id AS "vendorId", vi.inventory_item_id AS "inventoryItemId",
           vi.vendor_sku AS "vendorSku", vi.brand_name AS "brandName",
           vi.purchase_unit_id AS "purchaseUnitId", vi.case_size AS "caseSize",
           vi.inner_pack_size AS "innerPackSize", vi.pack_uom AS "packUom",
           vi.last_price AS "lastPrice", vi.last_case_price AS "lastCasePrice",
           vi.active, vi.price_source AS "priceSource",
           vi.canonical_qty_per_purchase_unit AS "canonicalQtyPerPurchaseUnit",
           vi.pricing_basis AS "pricingBasis", vi.is_variable_weight AS "isVariableWeight",
           vi.pack_geometry_status AS "packGeometryStatus",
           u.name AS "unitName", u.abbreviation AS "unitAbbreviation", u.kind AS "unitKind"
    FROM vendor_items vi
    INNER JOIN vendors v ON v.id = vi.vendor_id
    LEFT JOIN units u ON u.id = vi.purchase_unit_id
    WHERE lower(v.name) = lower(${SYSCO_NAME})
      AND vi.vendor_sku = ${SYSCO_SKU}
    ORDER BY vi.id
  `)) as SyscoEvidenceRow[];
  if (syscoRows.length !== 2) {
    throw new Error(`Expected exactly two ${SYSCO_NAME} rows for SKU ${SYSCO_SKU}; found ${syscoRows.length}.`);
  }

  const syscoIds = syscoRows.map((row) => row.id);
  const mappings = rowsOf(await execute(sql`
    SELECT vendor_item_id AS "vendorItemId", source_system AS "sourceSystem",
           source_property_id AS "sourcePropertyId", source_external_id AS "sourceExternalId"
    FROM vendor_item_external_mappings
    WHERE vendor_item_id IN (
      SELECT jsonb_array_elements_text(${idsJson(syscoIds)}::jsonb)
    )
    ORDER BY vendor_item_id, source_system, source_property_id, source_external_id
  `));
  const mappingsByItem = new Map<string, unknown[]>();
  for (const mapping of mappings) {
    const entries = mappingsByItem.get(mapping.vendorItemId) ?? [];
    entries.push(mapping);
    mappingsByItem.set(mapping.vendorItemId, entries);
  }
  const downstreamReferences = await loadDownstreamReferenceCounts(
    execute,
    syscoIds,
    referenceCompatibility.presentSources,
  );

  const totalEdiMessages = rowsOf(await execute(sql`SELECT count(*)::int AS n FROM edi_messages`))[0]?.n ?? 0;
  const ediRows = rowsOf(await execute(sql`
    SELECT id, payload_json AS "payloadJson"
    FROM edi_messages
    WHERE payload_json IS NOT NULL
  `));
  const ediEvidence = summarizeEdiPayloads(totalEdiMessages, ediRows, loserIds);

  const report = {
    generatedAt: new Date().toISOString(),
    database: dbName,
    readOnly: true,
    classifierReportDatabase,
    productionClassALoserCount: loserIds.size,
    referenceCompatibility: referenceCompatibility.sourceCompatibility,
    syscoClassB: {
      vendor: SYSCO_NAME,
      sku: SYSCO_SKU,
      rows: syscoRows.map((row) => normalizeSyscoRow(
        row,
        mappingsByItem.get(row.id) ?? [],
        downstreamReferences[row.id] ?? {},
      )),
      automaticDecision: "NONE — evidence only; both rows remain held.",
    },
    ediSoftReferenceEvidence: ediEvidence,
  };
  const paths = emitReport(report);
  log(renderMarkdown(report));
  log(`\n[Gate2 readiness] JSON: ${paths.jsonPath}\n[Gate2 readiness] Markdown: ${paths.markdownPath}`);
  return report;
}

export async function executeVendorItemDuplicateGate2Readiness(runtime: Runtime = {}): Promise<number> {
  try {
    const report = await runVendorItemDuplicateGate2Readiness(runtime);
    if (report.ediSoftReferenceEvidence.softReferenceRisk === "STOP") {
      process.exitCode = 2;
      return 2;
    }
    return 0;
  } catch (error) {
    (runtime.error ?? console.error)(String(error));
    process.exitCode = 1;
    return 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void executeVendorItemDuplicateGate2Readiness();
}