/**
 * Vendor invoice XLSX bulk import — staging, resolution preview, approval.
 *
 * Persistence target is the EXISTING historical invoice domain
 * (historical_invoices / historical_invoice_lines). This module adds only the
 * staged upload → preview → approval workflow and price observations; it never
 * creates a parallel invoice model.
 *
 * Resolution is vendor-product-centric (see task plan):
 *   1. Property-scoped ORDERLY inventory-item external mapping (claim authority
 *      for the canonical inventory item).
 *   2. Vendor + Item Code against existing vendor_items (purchasing identity).
 *   3. Source Pack Size cross-checked against stored vendor pack geometry —
 *      a material disagreement HOLDS the line, never silently approves.
 *   4. Description is supporting evidence only.
 *   5. Otherwise HOLD.
 *
 * Price observations go through the shared write gate (recordVendorPrice) with
 * source "historical_invoice_import" and effectiveAt = invoice date, so an
 * older invoice never regresses the current vendor price.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  companyStores,
  historicalInvoiceLines,
  historicalInvoices,
  importSourcePropertyBindings,
  inventoryItemExternalMappings,
  inventoryItems,
  units,
  vendorInvoiceImportBatches,
  vendorInvoiceImportLines,
  vendorItems,
  vendors,
  type VendorInvoiceImportBatch,
  type VendorInvoiceImportLine,
} from '@workspace/db';
import crypto from 'crypto';
import { db } from '../../db';
import { recordVendorPrice } from '../vendorPriceService';
import {
  crossCheckPackSize,
  parsePackSize,
  parseVendorInvoiceWorkbook,
  VENDOR_INVOICE_PARSER_VERSION,
  VendorInvoiceParseError,
  type PackCrossCheck,
  type VendorInvoiceParseResult,
  type VendorInvoiceTotal,
} from './vendorInvoiceXlsx';

export class VendorInvoiceImportError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_REQUEST' | 'FORBIDDEN' | 'CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'VendorInvoiceImportError';
  }
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(k => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function hashValue(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

// ─── Staging ──────────────────────────────────────────────────────────────────

export interface StageResult {
  batchId: string;
  duplicateWarning: boolean;
  parse: {
    vendorNameDetected: string | null;
    invoiceCount: number;
    lineCount: number;
    dateRangeStart: string | null;
    dateRangeEnd: string | null;
    totalAmount: number;
    warnings: string[];
  };
}

/** Resolve the single active ORDERLY binding for a company (or throw). */
export async function getActiveOrderlyBinding(companyId: string) {
  const bindings = await db
    .select()
    .from(importSourcePropertyBindings)
    .where(and(
      eq(importSourcePropertyBindings.companyId, companyId),
      eq(importSourcePropertyBindings.sourceSystem, 'ORDERLY'),
      eq(importSourcePropertyBindings.active, 1),
    ));
  if (bindings.length !== 1) {
    throw new VendorInvoiceImportError(
      'FORBIDDEN',
      bindings.length === 0
        ? 'No active ORDERLY source-property binding exists for this company. Invoice history imports require an approved binding.'
        : 'Multiple active ORDERLY bindings exist; invoice history imports require exactly one.',
    );
  }
  return bindings[0];
}

/** Fetch a batch's destination store id for authorization checks. */
export async function getBatchDestinationStoreId(batchId: string, companyId: string): Promise<string> {
  const [batch] = await db
    .select({ destinationStoreId: vendorInvoiceImportBatches.destinationStoreId })
    .from(vendorInvoiceImportBatches)
    .where(and(
      eq(vendorInvoiceImportBatches.id, batchId),
      eq(vendorInvoiceImportBatches.companyId, companyId),
    ))
    .limit(1);
  if (!batch) throw new VendorInvoiceImportError('NOT_FOUND', 'Import batch not found.');
  return batch.destinationStoreId as string;
}

/**
 * Parse + stage an uploaded workbook. Duplicate uploads (same company +
 * SHA-256) are idempotent: the existing batch is returned with
 * duplicateWarning=true and nothing new is staged. A partial unique index on
 * (company_id, file_hash) for non-rejected batches backs this at the DB level;
 * a concurrent duplicate insert is caught and resolved to the winner's batch.
 */
export async function stageVendorInvoiceUpload(params: {
  buffer: Buffer;
  originalFilename: string;
  companyId: string;
  userId: string | null;
}): Promise<StageResult> {
  const { buffer, originalFilename, companyId, userId } = params;

  // Destination is governed by the approved source-property binding — never by
  // the caller. Same contract as the Orderly inventory import.
  const binding = await getActiveOrderlyBinding(companyId);

  const fileHash = sha256(buffer);
  const [existing] = await db
    .select()
    .from(vendorInvoiceImportBatches)
    .where(and(
      eq(vendorInvoiceImportBatches.companyId, companyId),
      eq(vendorInvoiceImportBatches.fileHash, fileHash),
      sql`${vendorInvoiceImportBatches.status} != 'rejected'`,
    ))
    .limit(1);
  if (existing) {
    return {
      batchId: existing.id,
      duplicateWarning: true,
      parse: {
        vendorNameDetected: existing.vendorNameDetected,
        invoiceCount: existing.invoiceCount,
        lineCount: existing.lineCount,
        dateRangeStart: existing.dateRangeStart,
        dateRangeEnd: existing.dateRangeEnd,
        totalAmount: existing.totalAmount,
        warnings: [],
      },
    };
  }

  // Parse BEFORE any write — a parse failure leaves the DB untouched.
  const parsed = parseVendorInvoiceWorkbook(buffer);

  // Vendor detection is advisory at staging; unique case-insensitive name match.
  let resolvedVendorId: string | null = null;
  if (parsed.vendorNameDetected) {
    const matches = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(
        eq(vendors.companyId, companyId),
        sql`lower(${vendors.name}) = lower(${parsed.vendorNameDetected.trim()})`,
      ));
    if (matches.length === 1) resolvedVendorId = matches[0].id;
  }

  let batchId: string;
  try {
    batchId = await db.transaction(async (tx: any) => {
    const [batch] = await tx.insert(vendorInvoiceImportBatches).values({
      companyId,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: binding.sourcePropertyId,
      sourcePropertyBindingId: binding.id,
      destinationStoreId: binding.destinationStoreId,
      fileHash,
      originalFilename,
      parserVersion: VENDOR_INVOICE_PARSER_VERSION,
      vendorNameDetected: parsed.vendorNameDetected,
      resolvedVendorId,
      invoiceCount: parsed.invoiceCount,
      lineCount: parsed.lines.length,
      dateRangeStart: parsed.dateRangeStart,
      dateRangeEnd: parsed.dateRangeEnd,
      totalAmount: parsed.totalAmount,
      invoiceTotals: parsed.invoiceTotals,
      uploadedBy: userId,
    }).returning({ id: vendorInvoiceImportBatches.id });
    for (const line of parsed.lines) {
      await tx.insert(vendorInvoiceImportLines).values({
        batchId: batch.id,
        rowIndex: line.rowIndex,
        invoiceNumber: line.invoiceNumber,
        invoiceDate: line.invoiceDate,
        itemCode: line.itemCode,
        description: line.description,
        packSizeRaw: line.packSizeRaw,
        qty: line.qty,
        extendedAmount: line.extendedAmount,
        category: line.category,
        glCode: line.glCode,
        rawData: line.raw,
      });
    }
    return batch.id as string;
    });
  } catch (err: any) {
    // Concurrent duplicate upload lost the unique-index race — return the winner.
    if (err?.code === '23505' || /vendor_invoice_import_batches_hash_uniq/.test(String(err?.message))) {
      const [winner] = await db
        .select()
        .from(vendorInvoiceImportBatches)
        .where(and(
          eq(vendorInvoiceImportBatches.companyId, companyId),
          eq(vendorInvoiceImportBatches.fileHash, fileHash),
          sql`${vendorInvoiceImportBatches.status} != 'rejected'`,
        ))
        .limit(1);
      if (winner) {
        return {
          batchId: winner.id,
          duplicateWarning: true,
          parse: {
            vendorNameDetected: winner.vendorNameDetected,
            invoiceCount: winner.invoiceCount,
            lineCount: winner.lineCount,
            dateRangeStart: winner.dateRangeStart,
            dateRangeEnd: winner.dateRangeEnd,
            totalAmount: winner.totalAmount,
            warnings: [],
          },
        };
      }
    }
    throw err;
  }

  return {
    batchId,
    duplicateWarning: false,
    parse: {
      vendorNameDetected: parsed.vendorNameDetected,
      invoiceCount: parsed.invoiceCount,
      lineCount: parsed.lines.length,
      dateRangeStart: parsed.dateRangeStart,
      dateRangeEnd: parsed.dateRangeEnd,
      totalAmount: parsed.totalAmount,
      warnings: parsed.warnings,
    },
  };
}

// ─── Resolution preview ───────────────────────────────────────────────────────

export type HoldReason =
  | 'vendor_unmatched'
  | 'no_item_code'
  | 'no_vendor_item'
  | 'ambiguous_vendor_item'
  | 'mapping_vendor_item_disagree'
  | 'pack_conflict'
  | 'already_imported';

export interface LineResolution {
  lineId: string;
  rowIndex: number;
  invoiceNumber: string;
  invoiceDate: string;
  itemCode: string | null;
  description: string | null;
  packSizeRaw: string | null;
  qty: number | null;
  extendedAmount: number | null;
  category: string | null;
  glCode: string | null;
  status: 'resolved' | 'held';
  holdReason: HoldReason | null;
  matchStrategy: 'external_mapping' | 'vendor_item_code' | null;
  vendorItemId: string | null;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  packCrossCheck: PackCrossCheck | null;
  /** Supporting evidence only — never authorizes a match by itself. */
  descriptionAgrees: boolean | null;
  derivedCasePrice: number | null;
}

export interface InvoiceReconciliation {
  invoiceNumber: string;
  invoiceDate: string | null;
  statedTotal: number | null;
  lineSum: number;
  gap: number | null;
  reconciles: boolean;
}

export interface ResolutionPreview {
  batchId: string;
  status: string;
  vendorNameDetected: string | null;
  vendorId: string | null;
  vendorName: string | null;
  invoiceCount: number;
  lineCount: number;
  resolvedLines: number;
  heldLines: number;
  resolvedDollars: number;
  heldDollars: number;
  holdReasonCounts: Record<string, number>;
  alreadyImportedInvoices: string[];
  reconciliation: InvoiceReconciliation[];
  lines: LineResolution[];
}

function normalizeDesc(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function runVendorInvoiceResolutionPreview(
  batchId: string,
  companyId: string,
): Promise<ResolutionPreview> {
  const [batch] = await db
    .select()
    .from(vendorInvoiceImportBatches)
    .where(and(
      eq(vendorInvoiceImportBatches.id, batchId),
      eq(vendorInvoiceImportBatches.companyId, companyId),
    ))
    .limit(1);
  if (!batch) throw new VendorInvoiceImportError('NOT_FOUND', 'Import batch not found.');

  const stagedLines = await db
    .select()
    .from(vendorInvoiceImportLines)
    .where(eq(vendorInvoiceImportLines.batchId, batchId))
    .orderBy(vendorInvoiceImportLines.rowIndex);

  // Vendor
  let vendorId = (batch as any).resolvedVendorId as string | null;
  let vendorName: string | null = null;
  if (!vendorId && batch.vendorNameDetected) {
    const matches = await db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(and(
        eq(vendors.companyId, companyId),
        sql`lower(${vendors.name}) = lower(${batch.vendorNameDetected.trim()})`,
      ));
    if (matches.length === 1) {
      vendorId = matches[0].id;
      vendorName = matches[0].name;
    }
  } else if (vendorId) {
    const [v] = await db.select({ name: vendors.name }).from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId))).limit(1);
    vendorName = v?.name ?? null;
    if (!v) vendorId = null;
  }

  // Candidate vendor items for this vendor, keyed by SKU.
  const vendorItemRows = vendorId
    ? await db
        .select({
          id: vendorItems.id,
          vendorSku: vendorItems.vendorSku,
          inventoryItemId: vendorItems.inventoryItemId,
          caseSize: vendorItems.caseSize,
          innerPackSize: vendorItems.innerPackSize,
          packUom: vendorItems.packUom,
          active: vendorItems.active,
          pricedAt: vendorItems.pricedAt,
          updatedAt: vendorItems.updatedAt,
        })
        .from(vendorItems)
        .innerJoin(inventoryItems, eq(inventoryItems.id, vendorItems.inventoryItemId))
        .where(and(eq(vendorItems.vendorId, vendorId), eq(inventoryItems.companyId, companyId)))
    : [];
  const vendorItemsBySku = new Map<string, any[]>();
  for (const vi of vendorItemRows) {
    const sku = (vi.vendorSku ?? '').trim();
    if (!sku) continue;
    const list = vendorItemsBySku.get(sku) ?? [];
    list.push(vi);
    vendorItemsBySku.set(sku, list);
  }

  // Property-scoped ORDERLY mappings — the claim authority for canonical items.
  const codes = [...new Set(stagedLines.map((l: any) => (l.itemCode ?? '').trim()).filter(Boolean))];
  const mappingRows = codes.length
    ? await db
        .select({
          sourceExternalId: inventoryItemExternalMappings.sourceExternalId,
          inventoryItemId: inventoryItemExternalMappings.inventoryItemId,
        })
        .from(inventoryItemExternalMappings)
        .where(and(
          eq(inventoryItemExternalMappings.companyId, companyId),
          eq(inventoryItemExternalMappings.sourceSystem, 'ORDERLY'),
          eq(inventoryItemExternalMappings.sourcePropertyId, batch.sourcePropertyId),
          sql`${inventoryItemExternalMappings.sourceExternalId} IN (${sql.join(codes.map(c => sql`${c}`), sql`, `)})`,
        ))
    : [];
  const mappingByCode = new Map<string, string[]>();
  for (const m of mappingRows) {
    const list = mappingByCode.get(m.sourceExternalId) ?? [];
    list.push(m.inventoryItemId);
    mappingByCode.set(m.sourceExternalId, list);
  }

  // Inventory item names for description evidence.
  const invItemIds = new Set<string>();
  for (const vi of vendorItemRows) invItemIds.add(vi.inventoryItemId);
  for (const ids of mappingByCode.values()) ids.forEach(id => invItemIds.add(id));
  const invItemRows = invItemIds.size
    ? await db
        .select({ id: inventoryItems.id, name: inventoryItems.name })
        .from(inventoryItems)
        .where(and(
          eq(inventoryItems.companyId, companyId),
          sql`${inventoryItems.id} IN (${sql.join([...invItemIds].map(id => sql`${id}`), sql`, `)})`,
        ))
    : [];
  const invNameById = new Map<string, string>(invItemRows.map((r: any) => [r.id, r.name]));

  // Invoice-number dedupe against already-persisted historical invoices.
  // Invoice numbers are only unique WITHIN a vendor — two vendors can reuse
  // the same number — so the dedupe is scoped to the resolved vendor. Without
  // a resolved vendor no dedupe claim can be made (every line is held on
  // vendor_unmatched anyway).
  const invoiceNumbers = [...new Set(stagedLines.map((l: any) => l.invoiceNumber))];
  const existingInvoices = invoiceNumbers.length && vendorId
    ? await db
        .select({ invoiceNumber: historicalInvoices.invoiceNumber })
        .from(historicalInvoices)
        .where(and(
          eq(historicalInvoices.companyId, companyId),
          eq(historicalInvoices.sourceSystem, 'ORDERLY'),
          eq(historicalInvoices.sourcePropertyId, batch.sourcePropertyId),
          eq(historicalInvoices.vendorId, vendorId),
          // Invoices this batch itself persisted are not "already imported" —
          // otherwise a post-approval preview would report its own output as
          // duplicates.
          sql`${historicalInvoices.importBatchId} != ${batchId}`,
          sql`${historicalInvoices.invoiceNumber} IN (${sql.join(invoiceNumbers.map(n => sql`${n}`), sql`, `)})`,
        ))
    : [];
  const alreadyImported = new Set(existingInvoices.map((r: any) => r.invoiceNumber).filter(Boolean) as string[]);

  const lines: LineResolution[] = [];
  for (const rawLine of stagedLines) {
    const line = rawLine as any;
    const base: LineResolution = {
      lineId: line.id,
      rowIndex: line.rowIndex,
      invoiceNumber: line.invoiceNumber,
      invoiceDate: line.invoiceDate,
      itemCode: line.itemCode,
      description: line.description,
      packSizeRaw: line.packSizeRaw,
      qty: line.qty,
      extendedAmount: line.extendedAmount,
      category: line.category ?? null,
      glCode: line.glCode ?? null,
      status: 'held',
      holdReason: null,
      matchStrategy: null,
      vendorItemId: null,
      inventoryItemId: null,
      inventoryItemName: null,
      packCrossCheck: null,
      descriptionAgrees: null,
      derivedCasePrice: null,
    };
    if (alreadyImported.has(line.invoiceNumber)) {
      lines.push({ ...base, holdReason: 'already_imported' });
      continue;
    }
    if (!vendorId) {
      lines.push({ ...base, holdReason: 'vendor_unmatched' });
      continue;
    }
    const code = (line.itemCode ?? '').trim();
    if (!code) {
      lines.push({ ...base, holdReason: 'no_item_code' });
      continue;
    }

    const candidates = vendorItemsBySku.get(code) ?? [];
    const distinctInvIds = [...new Set(candidates.map((c: any) => c.inventoryItemId))];
    const mappedInvIds = [...new Set(mappingByCode.get(code) ?? [])];

    if (candidates.length === 0) {
      lines.push({ ...base, holdReason: 'no_vendor_item' });
      continue;
    }
    if (distinctInvIds.length > 1) {
      lines.push({ ...base, holdReason: 'ambiguous_vendor_item' });
      continue;
    }
    // Canonical vendor-item row: active first, then most recently priced/updated.
    const canonical = [...candidates].sort((a, b) => {
      if ((b.active ?? 0) !== (a.active ?? 0)) return (b.active ?? 0) - (a.active ?? 0);
      const bp = b.pricedAt?.getTime() ?? b.updatedAt?.getTime() ?? 0;
      const ap = a.pricedAt?.getTime() ?? a.updatedAt?.getTime() ?? 0;
      return bp - ap;
    })[0];
    const inventoryItemId = canonical.inventoryItemId;

    // The property-scoped mapping is the claim authority for the canonical
    // item. If a mapping exists and disagrees with the vendor item's canonical
    // link, the line is a conflict — never silently pick one side.
    let matchStrategy: LineResolution['matchStrategy'] = 'vendor_item_code';
    if (mappedInvIds.length > 0) {
      if (mappedInvIds.length > 1 || mappedInvIds[0] !== inventoryItemId) {
        lines.push({
          ...base,
          holdReason: 'mapping_vendor_item_disagree',
          vendorItemId: canonical.id,
          inventoryItemId,
          inventoryItemName: invNameById.get(inventoryItemId) ?? null,
        });
        continue;
      }
      matchStrategy = 'external_mapping';
    }

    const packCheck = crossCheckPackSize(parsePackSize(line.packSizeRaw), {
      caseSize: canonical.caseSize,
      innerPackSize: canonical.innerPackSize,
      packUom: canonical.packUom,
    });
    const invName = invNameById.get(inventoryItemId) ?? null;
    const descriptionAgrees =
      line.description && invName
        ? normalizeDesc(invName).includes(normalizeDesc(line.description)) ||
          normalizeDesc(line.description).includes(normalizeDesc(invName))
        : null;

    if (packCheck === 'conflict') {
      lines.push({
        ...base,
        holdReason: 'pack_conflict',
        matchStrategy,
        vendorItemId: canonical.id,
        inventoryItemId,
        inventoryItemName: invName,
        packCrossCheck: packCheck,
        descriptionAgrees,
      });
      continue;
    }

    const derivedCasePrice =
      line.qty != null && line.qty > 0 && line.extendedAmount != null && line.extendedAmount > 0
        ? line.extendedAmount / line.qty
        : null;
    lines.push({
      ...base,
      status: 'resolved',
      matchStrategy,
      vendorItemId: canonical.id,
      inventoryItemId,
      inventoryItemName: invName,
      packCrossCheck: packCheck,
      descriptionAgrees,
      derivedCasePrice,
    });
  }

  // For approved batches, the persisted staging state is authoritative: it
  // records what actually happened at approval (resolved + observation written
  // vs held). A live recompute could disagree (e.g. mappings created since)
  // and must not misreport the historical outcome.
  if (batch.status === 'approved') {
    const stagedById = new Map(stagedLines.map((l: any) => [l.id, l]));
    for (const line of lines) {
      const staged = stagedById.get(line.lineId) as any;
      if (!staged?.resolutionStatus) continue;
      line.status = staged.resolutionStatus === 'resolved' ? 'resolved' : 'held';
      line.holdReason = line.status === 'held' ? (staged.holdReason ?? line.holdReason) : null;
      if (staged.resolvedVendorItemId) line.vendorItemId = staged.resolvedVendorItemId;
      if (staged.resolvedInventoryItemId) {
        line.inventoryItemId = staged.resolvedInventoryItemId;
        line.inventoryItemName = invNameById.get(staged.resolvedInventoryItemId) ?? line.inventoryItemName;
      }
    }
  }

  // Per-invoice reconciliation against the Invoice Totals sheet.
  const totals = (batch.invoiceTotals ?? []) as VendorInvoiceTotal[];
  const totalByInvoice = new Map(totals.map(t => [t.invoiceNumber, t]));
  const lineSumByInvoice = new Map<string, number>();
  for (const rawLine of stagedLines) {
    const line = rawLine as any;
    lineSumByInvoice.set(
      line.invoiceNumber,
      (lineSumByInvoice.get(line.invoiceNumber) ?? 0) + (line.extendedAmount ?? 0),
    );
  }
  const allInvoiceNumbers = [...new Set([...lineSumByInvoice.keys(), ...totalByInvoice.keys()])];
  const reconciliation: InvoiceReconciliation[] = allInvoiceNumbers.map(inv => {
    const stated = totalByInvoice.get(inv);
    const lineSum = Math.round((lineSumByInvoice.get(inv) ?? 0) * 100) / 100;
    const gap = stated ? Math.round((stated.amount - lineSum) * 100) / 100 : null;
    return {
      invoiceNumber: inv,
      invoiceDate: stated?.invoiceDate ?? stagedLines.find((l: any) => l.invoiceNumber === inv)?.invoiceDate ?? null,
      statedTotal: stated?.amount ?? null,
      lineSum,
      gap,
      reconciles: gap != null && Math.abs(gap) <= 0.01,
    };
  }).sort((a, b) => (a.invoiceDate ?? '').localeCompare(b.invoiceDate ?? ''));

  const resolved = lines.filter(l => l.status === 'resolved');
  const held = lines.filter(l => l.status === 'held');
  const holdReasonCounts: Record<string, number> = {};
  for (const l of held) {
    if (l.holdReason) holdReasonCounts[l.holdReason] = (holdReasonCounts[l.holdReason] ?? 0) + 1;
  }

  return {
    batchId,
    status: batch.status,
    vendorNameDetected: batch.vendorNameDetected,
    vendorId,
    vendorName,
    invoiceCount: batch.invoiceCount,
    lineCount: stagedLines.length,
    resolvedLines: resolved.length,
    heldLines: held.length,
    resolvedDollars: Math.round(resolved.reduce((n, l) => n + (l.extendedAmount ?? 0), 0) * 100) / 100,
    heldDollars: Math.round(held.reduce((n, l) => n + (l.extendedAmount ?? 0), 0) * 100) / 100,
    holdReasonCounts,
    alreadyImportedInvoices: [...alreadyImported],
    reconciliation,
    lines,
  };
}

// ─── Approval ─────────────────────────────────────────────────────────────────

export interface ApprovalResult {
  batchId: string;
  status: string;
  invoicesPersisted: number;
  invoicesSkipped: number;
  linesPersisted: number;
  linesResolved: number;
  linesHeld: number;
  priceObservations: number;
  alreadyApproved: boolean;
}

/**
 * Approve a staged batch: persist invoice headers + lines into the existing
 * historical invoice domain, link resolved lines, hold unresolved ones, and
 * record dated price observations through the shared vendor price gate.
 * Idempotent: an approved batch returns its result without writing;
 * already-persisted invoice numbers are skipped.
 */
export async function approveVendorInvoiceBatch(params: {
  batchId: string;
  companyId: string;
  userId: string | null;
}): Promise<ApprovalResult> {
  const { batchId, companyId, userId } = params;
  const [batch] = await db
    .select()
    .from(vendorInvoiceImportBatches)
    .where(and(
      eq(vendorInvoiceImportBatches.id, batchId),
      eq(vendorInvoiceImportBatches.companyId, companyId),
    ))
    .limit(1);
  if (!batch) throw new VendorInvoiceImportError('NOT_FOUND', 'Import batch not found.');
  if (batch.status === 'approved') {
    const lines = await db.select().from(vendorInvoiceImportLines)
      .where(eq(vendorInvoiceImportLines.batchId, batchId));
    return {
      batchId,
      status: 'approved',
      invoicesPersisted: 0,
      invoicesSkipped: batch.invoiceCount,
      linesPersisted: 0,
      linesResolved: lines.filter((l: any) => l.resolutionStatus === 'resolved').length,
      linesHeld: lines.filter((l: any) => l.resolutionStatus === 'held').length,
      priceObservations: lines.filter((l: any) => l.priceObservationWritten === 1).length,
      alreadyApproved: true,
    };
  }
  if (batch.status !== 'pending_review') {
    throw new VendorInvoiceImportError('CONFLICT', `Batch status is "${batch.status}"; only pending_review batches can be approved.`);
  }

  // Re-validate the persisted binding independently of the caller.
  const [binding] = await db
    .select()
    .from(importSourcePropertyBindings)
    .where(and(
      eq(importSourcePropertyBindings.id, batch.sourcePropertyBindingId),
      eq(importSourcePropertyBindings.companyId, companyId),
      eq(importSourcePropertyBindings.active, 1),
    ))
    .limit(1);
  if (!binding) throw new VendorInvoiceImportError('FORBIDDEN', 'The source-property binding for this batch is no longer active.');
  const [store] = await db
    .select({ id: companyStores.id, status: companyStores.status })
    .from(companyStores)
    .where(and(
      eq(companyStores.id, binding.destinationStoreId),
      eq(companyStores.companyId, companyId),
    ))
    .limit(1);
  if (!store || store.status !== 'active') {
    throw new VendorInvoiceImportError('FORBIDDEN', 'The bound destination store is unavailable.');
  }

  const preview = await runVendorInvoiceResolutionPreview(batchId, companyId);
  if (!preview.vendorId) {
    throw new VendorInvoiceImportError('INVALID_REQUEST', 'The vendor could not be uniquely matched; approval requires a resolved vendor.');
  }

  // Pack geometry + canonical unit names for price interpretation.
  const vendorItemIds = [...new Set(preview.lines.map(l => l.vendorItemId).filter(Boolean))] as string[];
  const geometryRows = vendorItemIds.length
    ? await db
        .select({
          id: vendorItems.id,
          caseSize: vendorItems.caseSize,
          innerPackSize: vendorItems.innerPackSize,
          packUom: vendorItems.packUom,
          inventoryItemId: vendorItems.inventoryItemId,
          unitName: units.name,
        })
        .from(vendorItems)
        .innerJoin(inventoryItems, eq(inventoryItems.id, vendorItems.inventoryItemId))
        .leftJoin(units, eq(units.id, inventoryItems.unitId))
        .where(sql`${vendorItems.id} IN (${sql.join(vendorItemIds.map(id => sql`${id}`), sql`, `)})`)
    : [];
  const geometryById = new Map<string, any>(geometryRows.map((g: any) => [g.id, g]));

  const totals = (batch.invoiceTotals ?? []) as VendorInvoiceTotal[];
  const totalByInvoice = new Map(totals.map(t => [t.invoiceNumber, t]));
  const alreadyImported = new Set(preview.alreadyImportedInvoices);

  // Group preview lines per invoice, ordered by invoice date so price
  // observations for the same vendor item apply chronologically.
  const byInvoice = new Map<string, LineResolution[]>();
  for (const line of preview.lines) {
    const list = byInvoice.get(line.invoiceNumber) ?? [];
    list.push(line);
    byInvoice.set(line.invoiceNumber, list);
  }
  const invoiceOrder = [...byInvoice.keys()].sort((a, b) => {
    const da = byInvoice.get(a)![0].invoiceDate;
    const dbb = byInvoice.get(b)![0].invoiceDate;
    return da.localeCompare(dbb) || a.localeCompare(b);
  });

  let invoicesPersisted = 0;
  let invoicesSkipped = 0;
  let linesPersisted = 0;
  let priceObservations = 0;

  let lostApprovalRace = false;
  await db.transaction(async (tx: any) => {
    // Serialize approvals: lock the batch row and re-check the status under
    // lock so concurrent approvals cannot both persist. A concurrent approval
    // that already completed is an idempotent no-op, not an error.
    const locked = await tx.execute(sql`
      SELECT status FROM vendor_invoice_import_batches
      WHERE id = ${batchId} AND company_id = ${companyId}
      FOR UPDATE
    `);
    const lockedRows: any[] = Array.isArray(locked) ? locked : (locked?.rows ?? []);
    const lockedStatus = lockedRows[0]?.status;
    if (lockedStatus === 'approved') {
      lostApprovalRace = true;
      return;
    }
    if (lockedStatus !== 'pending_review') {
      throw new VendorInvoiceImportError('CONFLICT', `Batch status is "${lockedStatus}"; only pending_review batches can be approved.`);
    }

    for (const invoiceNumber of invoiceOrder) {
      const invLines = byInvoice.get(invoiceNumber)!;
      if (alreadyImported.has(invoiceNumber)) {
        invoicesSkipped++;
        for (const line of invLines) {
          await tx.update(vendorInvoiceImportLines)
            .set({ resolutionStatus: 'held', holdReason: 'already_imported' })
            .where(eq(vendorInvoiceImportLines.id, line.lineId));
        }
        continue;
      }
      const invoiceDate = invLines[0].invoiceDate;
      const stated = totalByInvoice.get(invoiceNumber);
      const lineSum = Math.round(invLines.reduce((n, l) => n + (l.extendedAmount ?? 0), 0) * 100) / 100;
      // Vendor-scoped identity: invoice numbers are only unique per vendor, and
      // the DB uniqueness key is (company, source system, property, source
      // invoice id) — so the vendor must be part of the synthesized id.
      const sourceInvoiceId = `xlsx:${preview.vendorId}:${invoiceNumber}`;
      const sourceSnapshot = {
        importKind: 'vendor_invoice_xlsx',
        batchId,
        fileHash: batch.fileHash,
        invoiceNumber,
        invoiceDate,
        statedTotal: stated?.amount ?? null,
        vendorNameDetected: batch.vendorNameDetected,
        lines: invLines.map(l => ({
          rowIndex: l.rowIndex,
          itemCode: l.itemCode,
          description: l.description,
          packSizeRaw: l.packSizeRaw,
          qty: l.qty,
          extendedAmount: l.extendedAmount,
        })),
      };
      const inserted = await tx.insert(historicalInvoices).values({
        companyId,
        storeId: store.id,
        vendorId: preview.vendorId,
        importBatchId: batchId,
        sourceSystem: 'ORDERLY',
        sourcePropertyId: batch.sourcePropertyId,
        sourceInvoiceId,
        invoiceNumber,
        invoiceDate,
        invoicePeriod: invoiceDate.slice(0, 7),
        vendorNameSnapshot: batch.vendorNameDetected,
        subtotal: lineSum,
        totalAmount: stated?.amount ?? lineSum,
        sourceSnapshot,
        materialHash: hashValue(sourceSnapshot),
      }).onConflictDoNothing().returning({ id: historicalInvoices.id });
      const storedInvoice = inserted[0];
      if (!storedInvoice) {
        // Lost a race with a concurrent import of the same source invoice —
        // treat as an idempotent skip, exactly like the preview-time dedupe.
        invoicesSkipped++;
        for (const line of invLines) {
          await tx.update(vendorInvoiceImportLines)
            .set({ resolutionStatus: 'held', holdReason: 'already_imported' })
            .where(eq(vendorInvoiceImportLines.id, line.lineId));
        }
        continue;
      }
      invoicesPersisted++;

      for (const line of invLines) {
        const resolvedLink = line.status === 'resolved';
        const unitPrice =
          line.qty != null && line.qty > 0 && line.extendedAmount != null
            ? line.extendedAmount / line.qty
            : null;
        const lineSnapshot = {
          importKind: 'vendor_invoice_xlsx',
          rowIndex: line.rowIndex,
          itemCode: line.itemCode,
          description: line.description,
          packSizeRaw: line.packSizeRaw,
          qty: line.qty,
          extendedAmount: line.extendedAmount,
          holdReason: line.holdReason,
          matchStrategy: line.matchStrategy,
          packCrossCheck: line.packCrossCheck,
          descriptionAgrees: line.descriptionAgrees,
        };
        const [storedLine] = await tx.insert(historicalInvoiceLines).values({
          companyId,
          invoiceId: storedInvoice.id,
          sourceLineId: `xlsx-row-${line.rowIndex}`,
          vendorItemId: resolvedLink ? line.vendorItemId : null,
          inventoryItemId: resolvedLink ? line.inventoryItemId : null,
          resolutionStatus: resolvedLink ? 'resolved' : 'unresolved',
          productNameSnapshot: line.description,
          sourceExternalId: line.itemCode,
          quantity: line.qty,
          unitPrice,
          lineTotal: line.extendedAmount,
          packSnapshot: { raw: line.packSizeRaw },
          catchWeightSnapshot: {},
          glSnapshot: {
            glCode: line.glCode,
            category: line.category,
          },
          financialSnapshot: { extendedAmount: line.extendedAmount },
          sourceSnapshot: lineSnapshot,
          materialHash: hashValue(lineSnapshot),
        }).returning({ id: historicalInvoiceLines.id });
        linesPersisted++;

        // Price observation — resolved purchasing identity only, interpreted
        // through the stored vendor-product pack geometry, effective at the
        // invoice date. Held/conflicted lines never write a price.
        let priceWritten = 0;
        if (
          resolvedLink &&
          line.vendorItemId &&
          line.inventoryItemId &&
          line.qty != null && line.qty > 0 &&
          line.extendedAmount != null && line.extendedAmount > 0
        ) {
          const geom = geometryById.get(line.vendorItemId);
          if (geom) {
            await recordVendorPrice({
              vendorItemId: line.vendorItemId,
              inventoryItemId: line.inventoryItemId,
              companyId,
              priceBasis: 'case',
              price: line.extendedAmount / line.qty,
              caseSize: geom.caseSize ?? 1,
              innerPackSize: geom.innerPackSize ?? undefined,
              packUom: geom.packUom ?? '',
              inventoryUnitName: geom.unitName ?? '',
              source: 'historical_invoice_import',
              representsActualPurchase: true,
              referenceId: `${batchId}:${invoiceNumber}`,
              userId: userId ?? undefined,
              effectiveAt: new Date(`${invoiceDate}T12:00:00Z`),
            }, tx);
            priceObservations++;
            priceWritten = 1;
          }
        }

        await tx.update(vendorInvoiceImportLines).set({
          resolutionStatus: resolvedLink ? 'resolved' : 'held',
          holdReason: line.holdReason,
          resolvedVendorItemId: resolvedLink ? line.vendorItemId : null,
          resolvedInventoryItemId: resolvedLink ? line.inventoryItemId : null,
          historicalInvoiceLineId: storedLine.id,
          priceObservationWritten: priceWritten,
        }).where(eq(vendorInvoiceImportLines.id, line.lineId));
      }
    }

    await tx.update(vendorInvoiceImportBatches).set({
      status: 'approved',
      resolvedVendorId: preview.vendorId,
      approvedAt: new Date(),
      approvedBy: userId,
    }).where(eq(vendorInvoiceImportBatches.id, batchId));
  });

  if (lostApprovalRace) {
    const stagedNow = await db.select().from(vendorInvoiceImportLines)
      .where(eq(vendorInvoiceImportLines.batchId, batchId));
    return {
      batchId,
      status: 'approved',
      invoicesPersisted: 0,
      invoicesSkipped: batch.invoiceCount,
      linesPersisted: 0,
      linesResolved: stagedNow.filter((l: any) => l.resolutionStatus === 'resolved').length,
      linesHeld: stagedNow.filter((l: any) => l.resolutionStatus === 'held').length,
      priceObservations: stagedNow.filter((l: any) => l.priceObservationWritten === 1).length,
      alreadyApproved: true,
    };
  }

  return {
    batchId,
    status: 'approved',
    invoicesPersisted,
    invoicesSkipped,
    linesPersisted,
    linesResolved: preview.lines.filter(l => l.status === 'resolved' && !alreadyImported.has(l.invoiceNumber)).length,
    linesHeld: preview.lines.filter(l => l.status === 'held' || alreadyImported.has(l.invoiceNumber)).length,
    priceObservations,
    alreadyApproved: false,
  };
}

/**
 * List batches scoped to the company AND to the caller's accessible stores.
 * Store-scoped users must never see cross-store financial metadata.
 */
export async function listVendorInvoiceBatches(
  companyId: string,
  accessibleStoreIds: string[],
): Promise<VendorInvoiceImportBatch[]> {
  if (accessibleStoreIds.length === 0) return [];
  return db
    .select()
    .from(vendorInvoiceImportBatches)
    .where(and(
      eq(vendorInvoiceImportBatches.companyId, companyId),
      sql`${vendorInvoiceImportBatches.destinationStoreId} IN (${sql.join(accessibleStoreIds.map(id => sql`${id}`), sql`, `)})`,
    ))
    .orderBy(sql`${vendorInvoiceImportBatches.uploadedAt} DESC`);
}

export async function listHeldLines(companyId: string, batchId: string): Promise<VendorInvoiceImportLine[]> {
  const [batch] = await db
    .select({ id: vendorInvoiceImportBatches.id })
    .from(vendorInvoiceImportBatches)
    .where(and(
      eq(vendorInvoiceImportBatches.id, batchId),
      eq(vendorInvoiceImportBatches.companyId, companyId),
    ))
    .limit(1);
  if (!batch) throw new VendorInvoiceImportError('NOT_FOUND', 'Import batch not found.');
  return db
    .select()
    .from(vendorInvoiceImportLines)
    .where(and(
      eq(vendorInvoiceImportLines.batchId, batchId),
      eq(vendorInvoiceImportLines.resolutionStatus, 'held'),
    ))
    .orderBy(vendorInvoiceImportLines.rowIndex);
}

export { VendorInvoiceParseError };
