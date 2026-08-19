/**
 * Read-only surface for imported (vendor-invoice XLSX) invoices.
 *
 * Eligibility rule: only historical_invoices that are linked to an approved
 * vendor_invoice_import_batch (import_batch_id → vendor_invoice_import_batches,
 * status = 'approved').
 *
 * Security rules:
 *  - companyId must match on invoice, batch, and every line.
 *  - Caller must have access to the invoice's storeId (getAccessibleStores).
 *  - An inaccessible detail request returns NOT_FOUND — never reveals existence.
 *  - No writes, no mutations, no schema side-effects.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  companyStores,
  historicalInvoiceLines,
  historicalInvoices,
  inventoryItems,
  inventoryItemExternalMappings,
  vendorInvoiceImportBatches,
  vendorItemExternalMappings,
  vendorItems,
  vendors,
} from '@workspace/db';
import { db } from '../../db';
import { getAccessibleStores } from '../../permissions';
import type { User } from '@workspace/db';

type HistoricalInvoiceLineRow = typeof historicalInvoiceLines.$inferSelect;

// ─── Error class ─────────────────────────────────────────────────────────────

export class ImportedInvoiceReadError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'UNAUTHENTICATED',
    message: string,
  ) {
    super(message);
    this.name = 'ImportedInvoiceReadError';
  }
}

// ─── Response shapes ─────────────────────────────────────────────────────────

export interface ImportedInvoiceSummary {
  id: string;
  kind: 'historical_imported_invoice';
  sourceLabel: 'Imported Invoice';
  invoiceNumber: string | null;
  invoiceDate: string; // YYYY-MM-DD
  vendorId: string | null;
  vendorName: string;
  storeId: string;
  storeName: string;
  lineCount: number;
  totalAmount: number;
  originalFilename: string;
  approvedAt: string | null; // ISO-8601 string or null
}

export interface ImportedInvoiceLine {
  id: string;
  sourceLineId: string;
  description: string | null;
  itemCode: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  pack: Record<string, unknown>;
  sourceGlCode: string | null;
  sourceCategory: string | null;
  resolutionStatus: string;
  resolvedInventoryItemId: string | null;
  resolvedInventoryItemName: string | null;
}

export interface ImportedInvoiceDetail extends ImportedInvoiceSummary {
  sourceSystem: string;
  sourceInvoiceId: string;
  subtotal: number;
  taxAmount: number;
  chargeAmount: number;
  creditAmount: number;
  lines: ImportedInvoiceLine[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve vendorName: prefer the immutable invoice snapshot, then the current
 * vendor row, then 'Unknown vendor'.
 */
function resolveVendorName(
  snapshot: string | null | undefined,
  currentVendorName: string | null | undefined,
): string {
  if (snapshot?.trim()) return snapshot.trim();
  if (currentVendorName?.trim()) return currentVendorName.trim();
  return 'Unknown vendor';
}

/**
 * Extract a string from a JSONB field that may arrive as a parsed object or
 * as a JSON string depending on the driver version.
 */
function jsonbString(val: unknown, key: string): string | null {
  if (!val) return null;
  const obj = typeof val === 'string' ? (() => { try { return JSON.parse(val); } catch { return null; } })() : val;
  if (obj && typeof obj === 'object') {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/**
 * Cast a JSONB value to a plain object. Returns {} if the value is null,
 * unparseable, or not an object.
 */
function jsonbObject(val: unknown): Record<string, unknown> {
  if (!val) return {};
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
  return {};
}

// ─── Internal row shapes (to help TypeScript infer callback params) ──────────

interface InvoiceListRow {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  vendorId: string | null;
  vendorNameSnapshot: string | null;
  storeId: string;
  totalAmount: number;
  originalFilename: string;
  approvedAt: Date | null;
}

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * Return approved imported invoices visible to the caller, newest
 * invoiceDate first. Deterministic tie-break: invoice id descending.
 */
export async function listImportedInvoices(
  user: User,
  companyId: string,
): Promise<ImportedInvoiceSummary[]> {
  const accessibleStoreIds = await getAccessibleStores(user, companyId);
  if (accessibleStoreIds.length === 0) return [];

  // Fetch invoice rows + batch metadata joined on approved batches only.
  const rows: InvoiceListRow[] = await db
    .select({
      // invoice columns
      id: historicalInvoices.id,
      invoiceNumber: historicalInvoices.invoiceNumber,
      invoiceDate: historicalInvoices.invoiceDate,
      vendorId: historicalInvoices.vendorId,
      vendorNameSnapshot: historicalInvoices.vendorNameSnapshot,
      storeId: historicalInvoices.storeId,
      totalAmount: historicalInvoices.totalAmount,
      // batch columns
      originalFilename: vendorInvoiceImportBatches.originalFilename,
      approvedAt: vendorInvoiceImportBatches.approvedAt,
    })
    .from(historicalInvoices)
    .innerJoin(
      vendorInvoiceImportBatches,
      and(
        eq(vendorInvoiceImportBatches.id, historicalInvoices.importBatchId),
        eq(vendorInvoiceImportBatches.companyId, companyId),
        eq(vendorInvoiceImportBatches.status, 'approved'),
      ),
    )
    .where(
      and(
        eq(historicalInvoices.companyId, companyId),
        sql`${historicalInvoices.storeId} IN (${sql.join(accessibleStoreIds.map(id => sql`${id}`), sql`, `)})`,
      ),
    )
    .orderBy(sql`${historicalInvoices.invoiceDate} DESC, ${historicalInvoices.id} DESC`);

  if (rows.length === 0) return [];

  // Resolve current vendor names for those without a snapshot.
  const missingSnapshotVendorIds = [
    ...new Set(
      rows
        .filter((r) => !r.vendorNameSnapshot?.trim() && r.vendorId)
        .map((r) => r.vendorId as string),
    ),
  ];
  const vendorNameById = new Map<string, string>();
  if (missingSnapshotVendorIds.length > 0) {
    const vendorRows = await db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(
        and(
          eq(vendors.companyId, companyId),
          sql`${vendors.id} IN (${sql.join(missingSnapshotVendorIds.map((id: string) => sql`${id}`), sql`, `)})`,
        ),
      );
    for (const v of vendorRows) vendorNameById.set(v.id, v.name);
  }

  // Resolve store names.
  const storeIds = [...new Set(rows.map((r) => r.storeId))];
  const storeNameById = new Map<string, string>();
  if (storeIds.length > 0) {
    const storeRows = await db
      .select({ id: companyStores.id, name: companyStores.name })
      .from(companyStores)
      .where(
        and(
          eq(companyStores.companyId, companyId),
          sql`${companyStores.id} IN (${sql.join(storeIds.map((id: string) => sql`${id}`), sql`, `)})`,
        ),
      );
    for (const s of storeRows) storeNameById.set(s.id, s.name);
  }

  // Count lines per invoice in a single query.
  const invoiceIds = rows.map((r) => r.id);
  const lineCountRows: Array<{ invoiceId: string; count: number }> = await db
    .select({
      invoiceId: historicalInvoiceLines.invoiceId,
      count: sql<number>`count(*)::int`,
    })
    .from(historicalInvoiceLines)
    .where(
      and(
        sql`${historicalInvoiceLines.invoiceId} IN (${sql.join(invoiceIds.map((id: string) => sql`${id}`), sql`, `)})`,
        eq(historicalInvoiceLines.companyId, companyId),
      ),
    )
    .groupBy(historicalInvoiceLines.invoiceId);
  const lineCountByInvoice = new Map<string, number>(
    lineCountRows.map((r) => [r.invoiceId, r.count]),
  );

  return rows.map((row) => ({
    id: row.id,
    kind: 'historical_imported_invoice' as const,
    sourceLabel: 'Imported Invoice' as const,
    invoiceNumber: row.invoiceNumber ?? null,
    invoiceDate: row.invoiceDate,
    vendorId: row.vendorId ?? null,
    vendorName: resolveVendorName(
      row.vendorNameSnapshot,
      row.vendorId ? vendorNameById.get(row.vendorId) : undefined,
    ),
    storeId: row.storeId,
    storeName: storeNameById.get(row.storeId) ?? row.storeId,
    lineCount: lineCountByInvoice.get(row.id) ?? 0,
    totalAmount: row.totalAmount,
    originalFilename: row.originalFilename,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
  }));
}

// ─── Detail ──────────────────────────────────────────────────────────────────

/**
 * Return full invoice detail including all lines.
 * Returns null when the invoice doesn't exist or is not accessible —
 * the caller should map null → 404 (NOT_FOUND) without leaking existence.
 */
export async function getImportedInvoiceDetail(
  invoiceId: string,
  user: User,
  companyId: string,
): Promise<ImportedInvoiceDetail | null> {
  // Fetch the invoice + batch in a single query, inner-joining on approved batch.
  const [row] = await db
    .select({
      id: historicalInvoices.id,
      invoiceNumber: historicalInvoices.invoiceNumber,
      invoiceDate: historicalInvoices.invoiceDate,
      vendorId: historicalInvoices.vendorId,
      vendorNameSnapshot: historicalInvoices.vendorNameSnapshot,
      storeId: historicalInvoices.storeId,
      totalAmount: historicalInvoices.totalAmount,
      subtotal: historicalInvoices.subtotal,
      taxAmount: historicalInvoices.taxAmount,
      chargeAmount: historicalInvoices.chargeAmount,
      creditAmount: historicalInvoices.creditAmount,
      sourceSystem: historicalInvoices.sourceSystem,
      sourcePropertyId: historicalInvoices.sourcePropertyId,
      sourceInvoiceId: historicalInvoices.sourceInvoiceId,
      originalFilename: vendorInvoiceImportBatches.originalFilename,
      approvedAt: vendorInvoiceImportBatches.approvedAt,
    })
    .from(historicalInvoices)
    .innerJoin(
      vendorInvoiceImportBatches,
      and(
        eq(vendorInvoiceImportBatches.id, historicalInvoices.importBatchId),
        eq(vendorInvoiceImportBatches.companyId, companyId),
        eq(vendorInvoiceImportBatches.status, 'approved'),
      ),
    )
    .where(
      and(
        eq(historicalInvoices.id, invoiceId),
        eq(historicalInvoices.companyId, companyId),
      ),
    )
    .limit(1);

  // Invoice not found or not linked to an approved batch.
  if (!row) return null;

  // Store access check — inaccessible requests return null (→ NOT_FOUND).
  const accessibleStoreIds = await getAccessibleStores(user, companyId);
  if (!accessibleStoreIds.includes(row.storeId)) return null;

  // Resolve current vendor name if the snapshot is absent.
  let currentVendorName: string | null = null;
  if (!row.vendorNameSnapshot?.trim() && row.vendorId) {
    const [v] = await db
      .select({ name: vendors.name })
      .from(vendors)
      .where(and(eq(vendors.id, row.vendorId), eq(vendors.companyId, companyId)))
      .limit(1);
    currentVendorName = v?.name ?? null;
  }
  const vendorName = resolveVendorName(row.vendorNameSnapshot, currentVendorName);

  // Resolve store name.
  const [storeRow] = await db
    .select({ name: companyStores.name })
    .from(companyStores)
    .where(and(eq(companyStores.id, row.storeId), eq(companyStores.companyId, companyId)))
    .limit(1);
  const storeName = storeRow?.name ?? row.storeId;

  // Fetch lines, ordered deterministically by sourceLineId then importedAt then id.
  const lineRows: HistoricalInvoiceLineRow[] = await db
    .select()
    .from(historicalInvoiceLines)
    .where(
      and(
        eq(historicalInvoiceLines.invoiceId, invoiceId),
        eq(historicalInvoiceLines.companyId, companyId),
      ),
    )
    .orderBy(
      historicalInvoiceLines.sourceLineId,
      historicalInvoiceLines.importedAt,
      historicalInvoiceLines.id,
    );

  // Resolve inventory item names for lines that stored a canonical pointer at
  // import time.
  const inventoryItemIds = [
    ...new Set(lineRows.filter((l) => l.inventoryItemId).map((l) => l.inventoryItemId as string)),
  ];
  const invNameById = new Map<string, string>();
  if (inventoryItemIds.length > 0) {
    const invRows = await db
      .select({ id: inventoryItems.id, name: inventoryItems.name })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.companyId, companyId),
          sql`${inventoryItems.id} IN (${sql.join(inventoryItemIds.map((id: string) => sql`${id}`), sql`, `)})`,
        ),
      );
    for (const inv of invRows) invNameById.set(inv.id, inv.name);
  }

  // Historical evidence rows are database-immutable. A later human-confirmed
  // resolution therefore projects through the same paired source mappings used
  // by future imports, rather than updating historical_invoice_lines. Require
  // both mappings to agree on the canonical item and vendor product.
  const unresolvedCodes = [
    ...new Set(
      lineRows
        .filter(line => !line.inventoryItemId && line.sourceExternalId?.trim())
        .map(line => line.sourceExternalId!.trim()),
    ),
  ];
  const projectedByCode = new Map<string, {
    inventoryItemId: string;
    inventoryItemName: string;
  }>();
  if (row.vendorId && unresolvedCodes.length > 0) {
    const projectedRows = await db
      .select({
        sourceExternalId: vendorItemExternalMappings.sourceExternalId,
        inventoryItemId: vendorItems.inventoryItemId,
        inventoryItemName: inventoryItems.name,
      })
      .from(vendorItemExternalMappings)
      .innerJoin(
        vendorItems,
        eq(vendorItems.id, vendorItemExternalMappings.vendorItemId),
      )
      .innerJoin(
        vendors,
        and(
          eq(vendors.id, vendorItems.vendorId),
          eq(vendors.companyId, companyId),
        ),
      )
      .innerJoin(
        inventoryItems,
        and(
          eq(inventoryItems.id, vendorItems.inventoryItemId),
          eq(inventoryItems.companyId, companyId),
        ),
      )
      .innerJoin(
        inventoryItemExternalMappings,
        and(
          eq(inventoryItemExternalMappings.companyId, vendorItemExternalMappings.companyId),
          eq(inventoryItemExternalMappings.sourceSystem, vendorItemExternalMappings.sourceSystem),
          eq(inventoryItemExternalMappings.sourcePropertyId, vendorItemExternalMappings.sourcePropertyId),
          eq(inventoryItemExternalMappings.sourceExternalId, vendorItemExternalMappings.sourceExternalId),
          eq(inventoryItemExternalMappings.inventoryItemId, vendorItems.inventoryItemId),
        ),
      )
      .where(and(
        eq(vendorItemExternalMappings.companyId, companyId),
        eq(vendorItemExternalMappings.sourceSystem, row.sourceSystem),
        eq(vendorItemExternalMappings.sourcePropertyId, row.sourcePropertyId),
        eq(vendorItems.vendorId, row.vendorId),
        sql`${vendorItemExternalMappings.sourceExternalId} in (
          select jsonb_array_elements_text(${JSON.stringify(unresolvedCodes)}::jsonb)
        )`,
      ));
    for (const projected of projectedRows) {
      projectedByCode.set(projected.sourceExternalId, {
        inventoryItemId: projected.inventoryItemId,
        inventoryItemName: projected.inventoryItemName,
      });
    }
  }

  const lines: ImportedInvoiceLine[] = lineRows.map((line) => {
    const storedName = line.inventoryItemId
      ? (invNameById.get(line.inventoryItemId) ?? null)
      : null;
    const projected = !line.inventoryItemId && line.sourceExternalId
      ? projectedByCode.get(line.sourceExternalId.trim())
      : undefined;
    const resolvedInventoryItemId = storedName
      ? line.inventoryItemId
      : projected?.inventoryItemId ?? null;
    const resolvedInventoryItemName = storedName ?? projected?.inventoryItemName ?? null;
    return {
      id: line.id,
      sourceLineId: line.sourceLineId,
      description: line.productNameSnapshot ?? null,
      itemCode: line.sourceExternalId ?? null,
      quantity: line.quantity ?? null,
      unitPrice: line.unitPrice ?? null,
      lineTotal: line.lineTotal ?? null,
      pack: jsonbObject(line.packSnapshot),
      sourceGlCode: jsonbString(line.glSnapshot, 'glCode'),
      sourceCategory: jsonbString(line.glSnapshot, 'category'),
      resolutionStatus: resolvedInventoryItemId ? 'resolved' : line.resolutionStatus,
      resolvedInventoryItemId,
      resolvedInventoryItemName,
    };
  });

  return {
    id: row.id,
    kind: 'historical_imported_invoice' as const,
    sourceLabel: 'Imported Invoice' as const,
    invoiceNumber: row.invoiceNumber ?? null,
    invoiceDate: row.invoiceDate,
    vendorId: row.vendorId ?? null,
    vendorName,
    storeId: row.storeId,
    storeName,
    lineCount: lines.length,
    totalAmount: row.totalAmount,
    originalFilename: row.originalFilename,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    sourceSystem: row.sourceSystem,
    sourceInvoiceId: row.sourceInvoiceId,
    subtotal: row.subtotal,
    taxAmount: row.taxAmount,
    chargeAmount: row.chargeAmount,
    creditAmount: row.creditAmount,
    lines,
  };
}
