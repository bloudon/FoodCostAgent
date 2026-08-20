/**
 * Read-only provenance collector for the final held Sysco duplicate group.
 * It deliberately does not decide a survivor, mutate rows, or invoke Gate 2.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  SYSCO_DUPLICATE_VENDOR_ITEM_IDS,
  chronological,
  concludeSyscoProvenance,
  type SyscoProvenanceEvent,
} from "./vendorItemDuplicateSyscoProvenance";
import { validateReferenceColumnCompatibility } from "./vendorItemDuplicateReferenceCompatibility";

const INVENTORY_ITEM_ID = "2030960c-3c95-49fd-8ccc-56eae6b5e615";
const SYSCO_SKU = "7664436";
const SYSCO_NAME = "Sysco";
const SOURCE_TABLES = [
  "vendor_items", "vendors", "inventory_items", "units", "inventory_item_price_history",
  "vendor_item_external_mappings", "order_guides", "order_guide_lines",
  "inventory_import_batches", "inventory_import_rows", "historical_invoice_lines",
  "historical_invoices", "vendor_invoice_import_batches", "vendor_invoice_import_lines",
] as const;

function rowsOf(result: any): any[] {
  return Array.isArray(result) ? result : result.rows;
}

type Executor = (query: any) => Promise<any>;
type Schema = Map<string, Set<string>>;

function asNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function idsJson(): string {
  return JSON.stringify([...SYSCO_DUPLICATE_VENDOR_ITEM_IDS]);
}

function sqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function has(schema: Schema, table: string, ...columns: string[]): boolean {
  const known = schema.get(table);
  return Boolean(known && columns.every((column) => known.has(column)));
}

function sourceAvailability(schema: Schema, table: string, required: string[]): {
  available: boolean;
  missingColumns: string[];
} {
  const known = schema.get(table);
  if (!known) return { available: false, missingColumns: ["<table absent>"] };
  return { available: required.every((column) => known.has(column)), missingColumns: required.filter((column) => !known.has(column)) };
}

function optionalSelect(schema: Schema, tableAlias: string, table: string, column: string, alias: string): string {
  return has(schema, table, column)
    ? `${tableAlias}.${column} AS "${alias}"`
    : `NULL AS "${alias}"`;
}

function requireRows(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Sysco provenance refused: ${message}`);
}

function currentEvent(row: any): SyscoProvenanceEvent {
  return {
    occurredAt: asText(row.packGeometryUpdatedAt) ?? asText(row.pricedAt) ?? asText(row.updatedAt),
    isCurrent: false,
    source: "vendor_items_current_snapshot",
    directVendorItemId: row.id,
    bridge: "direct",
    packEvidence: {
      caseSize: asNumber(row.caseSize),
      innerPackSize: asNumber(row.innerPackSize),
      packUom: asText(row.packUom),
      rawDescription: asText(row.brandName),
      // A current database snapshot is evidence, not an independent dated source assertion.
      confidence: "supporting",
    },
    priceContext: { casePrice: asNumber(row.lastCasePrice), unitPrice: asNumber(row.lastPrice) },
    details: {
      purchaseUnitId: asText(row.purchaseUnitId),
      purchaseUnitName: asText(row.unitName),
      packGeometryStatus: asText(row.packGeometryStatus),
      packGeometrySource: asText(row.packGeometrySource),
      pricingBasis: asText(row.pricingBasis),
      priceSource: asText(row.priceSource),
      priceSourceReferenceId: asText(row.priceSourceReferenceId),
      active: row.active,
    },
  };
}

function writeReport(report: unknown): { jsonPath: string; markdownPath: string } {
  const configured = process.env.SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR;
  if (!configured || !path.isAbsolute(configured)) throw new Error("SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR must be an absolute path.");
  const outputDir = path.resolve(configured);
  if (outputDir.startsWith(`${path.resolve(process.cwd())}${path.sep}`)) {
    throw new Error("SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR must be outside the application checkout.");
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "sysco-7664436-provenance.json");
  const markdownPath = path.join(outputDir, "sysco-7664436-provenance.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const typed = report as any;
  fs.writeFileSync(markdownPath, `# Sysco SKU 7664436 Provenance — READ ONLY

Database: \`${typed.database}\`

## Result
**${typed.conclusion.conclusion}**

${typed.conclusion.rationale}

## Source availability
\`\`\`json
${JSON.stringify(typed.sourceAvailability, null, 2)}
\`\`\`

## Chronology
\`\`\`json
${JSON.stringify(typed.chronology, null, 2)}
\`\`\`

**STOP. This report does not authorize a Sysco survivor, deletion, reference repoint, uniqueness index, migration, PM2 action, preview, or APPLY.**
`);
  return { jsonPath, markdownPath };
}

export async function runSyscoDuplicateProvenance(input: {
  execute?: Executor;
  emit?: (report: unknown) => { jsonPath: string; markdownPath: string };
  expectedCompanyId?: string;
} = {}) {
  const expectedCompanyId = input.expectedCompanyId ?? process.env.SYSCO_DUPLICATE_REVIEWED_COMPANY_ID;
  requireRows(
    typeof expectedCompanyId === "string" && expectedCompanyId.trim().length > 0,
    "SYSCO_DUPLICATE_REVIEWED_COMPANY_ID is required as the immutable reviewed company scope.",
  );
  if (!input.execute) {
    return db.transaction(async (tx: any) =>
      runSyscoDuplicateProvenance({ ...input, execute: (query: any) => tx.execute(query) }),
    );
  }
  const execute = input.execute;
  await execute("SET TRANSACTION READ ONLY");
  const dbName = rowsOf(await execute(sql`SELECT current_database() AS db`))[0]?.db;
  requireRows(Boolean(dbName), "unable to determine connected database identity.");

  const liveReferences = rowsOf(await execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name LIKE '%vendor_item%'
      AND table_name <> 'vendor_items'
    ORDER BY table_name, column_name
  `)).map((row: any) => `${row.table_name}.${row.column_name}`);
  const reference = validateReferenceColumnCompatibility(liveReferences);

  const columns = rowsOf(await execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        SELECT jsonb_array_elements_text(${JSON.stringify(SOURCE_TABLES)}::jsonb)
      )
  `));
  const schema: Schema = new Map();
  for (const row of columns) {
    const entries = schema.get(row.table_name) ?? new Set<string>();
    entries.add(row.column_name);
    schema.set(row.table_name, entries);
  }

  requireRows(
    has(schema, "vendor_items", "id", "vendor_id", "inventory_item_id", "vendor_sku", "purchase_unit_id", "case_size", "last_price", "last_case_price") &&
      has(schema, "vendors", "id", "name", "company_id") &&
      has(schema, "inventory_items", "id", "company_id") &&
      has(schema, "units", "id", "name"),
    "minimum vendor, vendor-item, or unit schema is absent.",
  );
  const currentRows = rowsOf(await execute(sql.raw(`
    SELECT vi.id, vi.vendor_id AS "vendorId", vi.inventory_item_id AS "inventoryItemId",
           vi.vendor_sku AS "vendorSku", vi.purchase_unit_id AS "purchaseUnitId",
           vi.case_size AS "caseSize", ${optionalSelect(schema, "vi", "vendor_items", "inner_pack_size", "innerPackSize")},
           ${optionalSelect(schema, "vi", "vendor_items", "pack_uom", "packUom")},
           vi.last_price AS "lastPrice", vi.last_case_price AS "lastCasePrice",
           ${optionalSelect(schema, "vi", "vendor_items", "brand_name", "brandName")},
           ${optionalSelect(schema, "vi", "vendor_items", "price_source", "priceSource")},
           ${optionalSelect(schema, "vi", "vendor_items", "price_source_reference_id", "priceSourceReferenceId")},
           ${optionalSelect(schema, "vi", "vendor_items", "priced_at", "pricedAt")},
           ${optionalSelect(schema, "vi", "vendor_items", "updated_at", "updatedAt")},
           ${optionalSelect(schema, "vi", "vendor_items", "pack_geometry_status", "packGeometryStatus")},
           ${optionalSelect(schema, "vi", "vendor_items", "pack_geometry_source", "packGeometrySource")},
           ${optionalSelect(schema, "vi", "vendor_items", "pack_geometry_updated_at", "packGeometryUpdatedAt")},
           ${optionalSelect(schema, "vi", "vendor_items", "pricing_basis", "pricingBasis")},
            ${optionalSelect(schema, "vi", "vendor_items", "active", "active")},
            v.name AS "vendorName", v.company_id AS "vendorCompanyId",
            ii.company_id AS "inventoryCompanyId", u.name AS "unitName"
    FROM vendor_items vi
    JOIN vendors v ON v.id = vi.vendor_id
    JOIN inventory_items ii ON ii.id = vi.inventory_item_id
    JOIN units u ON u.id = vi.purchase_unit_id
    WHERE vi.id IN (SELECT jsonb_array_elements_text('${idsJson()}'::jsonb))
      AND v.company_id = '${sqlLiteral(expectedCompanyId)}'
      AND ii.company_id = '${sqlLiteral(expectedCompanyId)}'
    ORDER BY vi.id
  `)));
  requireRows(currentRows.length === 2, `expected exactly two approved vendor-item rows; found ${currentRows.length}.`);
  requireRows(
    currentRows.every((row: any) =>
      row.inventoryItemId === INVENTORY_ITEM_ID &&
      row.vendorSku === SYSCO_SKU &&
      String(row.vendorName).toLowerCase() === SYSCO_NAME.toLowerCase() &&
      typeof row.vendorCompanyId === "string" &&
      row.vendorCompanyId === row.inventoryCompanyId,
    ),
    "approved Sysco row identity, SKU, or inventory-item binding drifted.",
  );
  const vendorId = currentRows[0].vendorId;
  const companyId = currentRows[0].vendorCompanyId;
  requireRows(currentRows.every((row: any) => row.vendorId === vendorId), "the two approved rows have different vendor identities.");
  requireRows(currentRows.every((row: any) => row.vendorCompanyId === companyId), "the two approved rows have different company identities.");
  requireRows(companyId === expectedCompanyId, "fixed Sysco rows do not belong to the immutable reviewed company scope.");

  const availability = {
    priceHistory: sourceAvailability(schema, "inventory_item_price_history", ["vendor_item_id"]),
    externalMappings: sourceAvailability(schema, "vendor_item_external_mappings", ["vendor_item_id", "company_id"]),
    orderGuides: sourceAvailability(schema, "order_guides", ["id", "vendor_id", "company_id", "fetched_at"]),
    orderGuideLines: sourceAvailability(schema, "order_guide_lines", ["order_guide_id", "vendor_sku"]),
    importBatches: sourceAvailability(schema, "inventory_import_batches", ["id", "company_id"]),
    // A matching SKU alone is not tenant-safe provenance. Require the resolved
    // canonical item bridge; otherwise report this source as unavailable.
    importRows: sourceAvailability(schema, "inventory_import_rows", ["batch_id", "source_item_code", "resolved_inventory_item_id"]),
    historicalInvoiceLines: sourceAvailability(schema, "historical_invoice_lines", ["vendor_item_id", "company_id"]),
    historicalInvoices: sourceAvailability(schema, "historical_invoices", ["id", "invoice_date", "company_id"]),
  };
  const events: SyscoProvenanceEvent[] = currentRows.map(currentEvent);

  if (availability.priceHistory.available) {
    const rows = rowsOf(await execute(sql.raw(`
      SELECT vendor_item_id AS "vendorItemId",
             ${optionalSelect(schema, "p", "inventory_item_price_history", "effective_at", "effectiveAt")},
             ${optionalSelect(schema, "p", "inventory_item_price_history", "created_at", "createdAt")},
             ${optionalSelect(schema, "p", "inventory_item_price_history", "case_price", "casePrice")},
             ${optionalSelect(schema, "p", "inventory_item_price_history", "price_per_unit", "unitPrice")},
             ${optionalSelect(schema, "p", "inventory_item_price_history", "source", "source")},
             ${optionalSelect(schema, "p", "inventory_item_price_history", "note", "note")}
      FROM inventory_item_price_history p
      JOIN inventory_items ii ON ii.id = p.inventory_item_id
      WHERE vendor_item_id IN (SELECT jsonb_array_elements_text('${idsJson()}'::jsonb))
        AND inventory_item_id = '${INVENTORY_ITEM_ID}'
        AND ii.company_id = '${sqlLiteral(expectedCompanyId)}'
      ORDER BY effective_at NULLS LAST, created_at NULLS LAST
    `)));
    for (const row of rows) events.push({
      occurredAt: asText(row.effectiveAt) ?? asText(row.createdAt),
      isCurrent: false,
      source: "inventory_item_price_history",
      directVendorItemId: asText(row.vendorItemId),
      bridge: "direct",
      packEvidence: { caseSize: null, innerPackSize: null, packUom: null, rawDescription: null, confidence: "supporting" },
      priceContext: { casePrice: asNumber(row.casePrice), unitPrice: asNumber(row.unitPrice) },
      details: { source: asText(row.source), note: asText(row.note) },
    });
  }

  if (availability.externalMappings.available) {
    const rows = rowsOf(await execute(sql.raw(`
      SELECT vendor_item_id AS "vendorItemId",
             ${optionalSelect(schema, "m", "vendor_item_external_mappings", "source_system", "sourceSystem")},
             ${optionalSelect(schema, "m", "vendor_item_external_mappings", "source_property_id", "sourcePropertyId")},
             ${optionalSelect(schema, "m", "vendor_item_external_mappings", "source_external_id", "sourceExternalId")},
             ${optionalSelect(schema, "m", "vendor_item_external_mappings", "source_description", "sourceDescription")},
             ${optionalSelect(schema, "m", "vendor_item_external_mappings", "match_strategy", "matchStrategy")},
             ${optionalSelect(schema, "m", "vendor_item_external_mappings", "confidence_score", "confidenceScore")},
             ${optionalSelect(schema, "m", "vendor_item_external_mappings", "created_at", "createdAt")},
             ${optionalSelect(schema, "m", "vendor_item_external_mappings", "confirmed_at", "confirmedAt")}
      FROM vendor_item_external_mappings m
      WHERE vendor_item_id IN (SELECT jsonb_array_elements_text('${idsJson()}'::jsonb))
        AND m.company_id = '${sqlLiteral(companyId)}'
      ORDER BY created_at NULLS LAST
    `)));
    for (const row of rows) events.push({
      occurredAt: asText(row.confirmedAt) ?? asText(row.createdAt),
      isCurrent: false,
      source: "vendor_item_external_mapping",
      directVendorItemId: asText(row.vendorItemId),
      bridge: "direct",
      packEvidence: { caseSize: null, innerPackSize: null, packUom: null, rawDescription: asText(row.sourceDescription), confidence: "supporting" },
      details: {
        sourceSystem: asText(row.sourceSystem), sourcePropertyId: asText(row.sourcePropertyId),
        sourceExternalId: asText(row.sourceExternalId), matchStrategy: asText(row.matchStrategy),
        confidenceScore: asNumber(row.confidenceScore),
      },
    });
  }

  if (availability.orderGuides.available && availability.orderGuideLines.available) {
    const rows = rowsOf(await execute(sql.raw(`
      SELECT ${optionalSelect(schema, "g", "order_guides", "effective_date", "effectiveDate")},
             g.fetched_at AS "fetchedAt", ${optionalSelect(schema, "g", "order_guides", "status", "guideStatus")},
             ${optionalSelect(schema, "g", "order_guides", "file_name", "fileName")},
             ${optionalSelect(schema, "l", "order_guide_lines", "case_size", "caseSize")},
             ${optionalSelect(schema, "l", "order_guide_lines", "inner_pack", "innerPackSize")},
             ${optionalSelect(schema, "l", "order_guide_lines", "uom", "packUom")},
             ${optionalSelect(schema, "l", "order_guide_lines", "case_size_raw", "rawPackDescription")},
             ${optionalSelect(schema, "l", "order_guide_lines", "pack_size", "packSize")},
             ${optionalSelect(schema, "l", "order_guide_lines", "price", "casePrice")},
             ${optionalSelect(schema, "l", "order_guide_lines", "price_source", "priceSource")},
             ${optionalSelect(schema, "l", "order_guide_lines", "product_name", "productName")}
      FROM order_guides g
      JOIN order_guide_lines l ON l.order_guide_id = g.id
      WHERE g.vendor_id = '${vendorId.replaceAll("'", "''")}'
        AND g.company_id = '${sqlLiteral(companyId)}'
        AND l.vendor_sku = '${SYSCO_SKU}'
      ORDER BY g.effective_date NULLS LAST, g.fetched_at NULLS LAST
    `)));
    for (const row of rows) events.push({
      occurredAt: asText(row.effectiveDate) ?? asText(row.fetchedAt),
      isCurrent: false,
      source: "order_guide_line",
      directVendorItemId: null,
      bridge: "vendor-and-sku",
      packEvidence: {
        caseSize: asNumber(row.caseSize), innerPackSize: asNumber(row.innerPackSize),
        packUom: asText(row.packUom), rawDescription: asText(row.rawPackDescription) ?? asText(row.packSize),
        confidence: "supporting",
      },
      priceContext: { casePrice: asNumber(row.casePrice), unitPrice: null },
      details: { guideStatus: asText(row.guideStatus), fileName: asText(row.fileName), productName: asText(row.productName), priceSource: asText(row.priceSource) },
    });
  }

  if (availability.importBatches.available && availability.importRows.available) {
    const rows = rowsOf(await execute(sql.raw(`
      SELECT ${optionalSelect(schema, "b", "inventory_import_batches", "uploaded_at", "uploadedAt")},
             ${optionalSelect(schema, "b", "inventory_import_batches", "inventory_date", "inventoryDate")},
             ${optionalSelect(schema, "b", "inventory_import_batches", "original_filename", "originalFilename")},
             ${optionalSelect(schema, "b", "inventory_import_batches", "file_hash", "fileHash")},
             ${optionalSelect(schema, "r", "inventory_import_rows", "case_quantity", "caseSize")},
             ${optionalSelect(schema, "r", "inventory_import_rows", "inner_pack_quantity", "innerPackSize")},
             ${optionalSelect(schema, "r", "inventory_import_rows", "case_unit", "packUom")},
             ${optionalSelect(schema, "r", "inventory_import_rows", "raw_description", "rawDescription")},
             ${optionalSelect(schema, "r", "inventory_import_rows", "supplier_raw", "supplierRaw")},
             ${optionalSelect(schema, "r", "inventory_import_rows", "package_price", "casePrice")},
             ${optionalSelect(schema, "r", "inventory_import_rows", "pack_parse_status", "packParseStatus")},
             ${optionalSelect(schema, "r", "inventory_import_rows", "resolved_inventory_item_id", "resolvedInventoryItemId")}
      FROM inventory_import_rows r
      JOIN inventory_import_batches b ON b.id = r.batch_id
      WHERE r.source_item_code = '${SYSCO_SKU}'
        AND r.resolved_inventory_item_id = '${INVENTORY_ITEM_ID}'
        AND b.company_id = '${sqlLiteral(companyId)}'
      ORDER BY b.inventory_date NULLS LAST, b.uploaded_at NULLS LAST
    `)));
    for (const row of rows) events.push({
      occurredAt: asText(row.inventoryDate) ?? asText(row.uploadedAt),
      isCurrent: false,
      source: "inventory_import_row",
      directVendorItemId: null,
      bridge: row.resolvedInventoryItemId === INVENTORY_ITEM_ID ? "inventory-item" : "vendor-and-sku",
      packEvidence: {
        caseSize: asNumber(row.caseSize), innerPackSize: asNumber(row.innerPackSize),
        packUom: asText(row.packUom), rawDescription: asText(row.rawDescription), confidence: "supporting",
      },
      priceContext: { casePrice: asNumber(row.casePrice), unitPrice: null },
      details: { supplierRaw: asText(row.supplierRaw), packParseStatus: asText(row.packParseStatus), originalFilename: asText(row.originalFilename), fileHash: asText(row.fileHash) },
    });
  }

  if (availability.historicalInvoiceLines.available && availability.historicalInvoices.available) {
    const rows = rowsOf(await execute(sql.raw(`
      SELECT l.vendor_item_id AS "vendorItemId", i.invoice_date AS "invoiceDate",
             ${optionalSelect(schema, "l", "historical_invoice_lines", "unit_price", "unitPrice")},
             ${optionalSelect(schema, "l", "historical_invoice_lines", "quantity", "quantity")},
             ${optionalSelect(schema, "l", "historical_invoice_lines", "source_external_id", "sourceExternalId")},
             ${optionalSelect(schema, "l", "historical_invoice_lines", "pack_snapshot", "hasPackSnapshot")},
             ${optionalSelect(schema, "l", "historical_invoice_lines", "imported_at", "importedAt")}
      FROM historical_invoice_lines l
      JOIN historical_invoices i ON i.id = l.invoice_id
      WHERE l.vendor_item_id IN (SELECT jsonb_array_elements_text('${idsJson()}'::jsonb))
        AND l.company_id = '${sqlLiteral(companyId)}'
        AND i.company_id = '${sqlLiteral(companyId)}'
      ORDER BY i.invoice_date NULLS LAST
    `)));
    for (const row of rows) events.push({
      occurredAt: asText(row.invoiceDate) ?? asText(row.importedAt),
      isCurrent: false,
      source: "historical_invoice_line",
      directVendorItemId: asText(row.vendorItemId),
      bridge: "direct",
      packEvidence: { caseSize: null, innerPackSize: null, packUom: null, rawDescription: null, confidence: "supporting" },
      priceContext: { casePrice: null, unitPrice: asNumber(row.unitPrice) },
      details: { quantity: asNumber(row.quantity), sourceExternalId: asText(row.sourceExternalId), packSnapshotPresent: row.hasPackSnapshot != null },
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    database: dbName,
    target: { vendor: SYSCO_NAME, sku: SYSCO_SKU, companyId: expectedCompanyId, inventoryItemId: INVENTORY_ITEM_ID, vendorItemIds: SYSCO_DUPLICATE_VENDOR_ITEM_IDS },
    referenceCompatibility: reference.sourceCompatibility,
    sourceAvailability: availability,
    chronology: chronological(events),
    conclusion: concludeSyscoProvenance(events),
    mutationAuthorization: "NONE — the held Class B group remains excluded from every mutation set pending a later explicit PM disposition.",
  };
  const paths = (input.emit ?? writeReport)(report);
  console.log(`[Sysco provenance] JSON: ${paths.jsonPath}\n[Sysco provenance] Markdown: ${paths.markdownPath}`);
  return report;
}

export async function executeSyscoDuplicateProvenance(): Promise<number> {
  try {
    await runSyscoDuplicateProvenance();
    return 0;
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void executeSyscoDuplicateProvenance();
}