/**
 * Historical invoice retention for the approved Orderly exit migration.
 * This module deliberately has no dependency on PO, receiving, AP, or QuickBooks
 * services. Persisted records are immutable source evidence; review state lives
 * on import batches and conflict records.
 */
import crypto from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  companyStores,
  historicalInvoiceImportBatches,
  historicalInvoiceImportConflicts,
  historicalInvoiceLines,
  historicalInvoices,
  importSourcePropertyBindings,
  inventoryItems,
  vendorItemExternalMappings,
  vendorItems,
  vendors,
} from '@workspace/db';
import { db } from '../../db';
import { storage } from '../../storage';
import { getAccessibleStores, hasCompanyAccess } from '../../permissions';

export const BAY_HILL_ORDERLY_PROPERTY_ID = '24472';
export const ORDERLY_SOURCE_SYSTEM = 'ORDERLY';

const number = z.coerce.number().finite().optional().nullable();
const lineSchema = z.object({
  sourceLineId: z.string().min(1),
  packSizeId: z.string().min(1).optional().nullable(),
  productName: z.string().optional().nullable(),
  quantity: number,
  unitPrice: number,
  lineTotal: number,
  creditAmount: number,
  pack: z.record(z.string(), z.unknown()).optional().default({}),
  catchWeight: z.record(z.string(), z.unknown()).optional().default({}),
  gl: z.record(z.string(), z.unknown()).optional().default({}),
  financial: z.record(z.string(), z.unknown()).optional().default({}),
  source: z.record(z.string(), z.unknown()).optional().default({}),
});
const invoiceSchema = z.object({
  sourceInvoiceId: z.string().min(1),
  invoiceNumber: z.string().optional().nullable(),
  invoiceDate: z.string().date(),
  vendorName: z.string().optional().nullable(),
  vendorExternalId: z.string().optional().nullable(),
  subtotal: number,
  taxAmount: number,
  chargeAmount: number,
  creditAmount: number,
  totalAmount: number,
  source: z.record(z.string(), z.unknown()).optional().default({}),
  lines: z.array(lineSchema).min(1),
});
export const historicalInvoicePayloadSchema = z.object({
  sourceSystem: z.literal(ORDERLY_SOURCE_SYSTEM),
  sourcePropertyId: z.literal(BAY_HILL_ORDERLY_PROPERTY_ID),
  cutoverDate: z.string().date(),
  invoices: z.array(invoiceSchema),
});
export type HistoricalInvoicePayload = z.infer<typeof historicalInvoicePayloadSchema>;

export class HistoricalInvoiceImportError extends Error {
  constructor(
    public readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_REQUEST',
    message: string,
  ) {
    super(message);
    this.name = 'HistoricalInvoiceImportError';
  }
}
export interface HistoricalInvoiceAuthorization {
  actingUserId: string;
  companyId: string;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(k => `${JSON.stringify(k)}:${stable(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function hash(value: unknown): string {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}
function twelveMonthWindow(cutoverDate: string) {
  const cutover = new Date(`${cutoverDate}T00:00:00.000Z`);
  if (Number.isNaN(cutover.getTime())) throw new HistoricalInvoiceImportError('INVALID_REQUEST', 'Invalid cutover date.');
  // The floor is twelve *complete calendar months*: for a cutover during
  // August 2026, retain August 2025 through July 2026.
  const end = new Date(Date.UTC(cutover.getUTCFullYear(), cutover.getUTCMonth(), 0));
  const start = new Date(Date.UTC(cutover.getUTCFullYear(), cutover.getUTCMonth() - 12, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function resolveAuthorizedBinding(auth: HistoricalInvoiceAuthorization | null | undefined) {
  if (!auth?.actingUserId?.trim() || !auth.companyId?.trim()) {
    throw new HistoricalInvoiceImportError('UNAUTHENTICATED', 'An acting user and company context are required.');
  }
  const user = await storage.getUser(auth.actingUserId.trim());
  if (!user || user.active !== 1) throw new HistoricalInvoiceImportError('UNAUTHENTICATED', 'The acting user could not be verified.');
  if (!(hasCompanyAccess(user, auth.companyId) || user.companyId === auth.companyId)) {
    throw new HistoricalInvoiceImportError('FORBIDDEN', 'You are not authorized for this company.');
  }
  const [binding] = await db.select().from(importSourcePropertyBindings).where(and(
    eq(importSourcePropertyBindings.companyId, auth.companyId),
    eq(importSourcePropertyBindings.sourceSystem, ORDERLY_SOURCE_SYSTEM),
    eq(importSourcePropertyBindings.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
    eq(importSourcePropertyBindings.active, 1),
  )).limit(1);
  if (!binding) throw new HistoricalInvoiceImportError('FORBIDDEN', 'The active Bay Hill source-property binding is required.');
  const [store] = await db.select({ id: companyStores.id, status: companyStores.status }).from(companyStores).where(and(
    eq(companyStores.id, binding.destinationStoreId), eq(companyStores.companyId, auth.companyId),
  )).limit(1);
  if (!store || store.status !== 'active') throw new HistoricalInvoiceImportError('FORBIDDEN', 'The bound destination store is unavailable.');
  const accessible = await getAccessibleStores(user, auth.companyId);
  if (!accessible.includes(store.id)) throw new HistoricalInvoiceImportError('FORBIDDEN', 'You do not have access to the bound destination store.');
  return { user, binding, storeId: store.id };
}

export async function stageHistoricalInvoiceImport(
  input: unknown,
  auth: HistoricalInvoiceAuthorization | null | undefined,
) {
  const parsed = historicalInvoicePayloadSchema.safeParse(input);
  if (!parsed.success) throw new HistoricalInvoiceImportError('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid invoice payload.');
  const payload = parsed.data;
  const contract = await resolveAuthorizedBinding(auth);
  const window = twelveMonthWindow(payload.cutoverDate);
  for (const invoice of payload.invoices) {
    if (invoice.invoiceDate < window.start || invoice.invoiceDate > window.end) {
      throw new HistoricalInvoiceImportError('INVALID_REQUEST', `Invoice ${invoice.sourceInvoiceId} is outside the required 12-month window.`);
    }
  }
  const payloadHash = hash(payload);
  return db.transaction(async (tx: any) => {
    const [batch] = await tx.insert(historicalInvoiceImportBatches).values({
      companyId: auth!.companyId,
      sourceSystem: ORDERLY_SOURCE_SYSTEM,
      sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
      sourcePropertyBindingId: contract.binding.id,
      destinationStoreId: contract.storeId,
      cutoverDate: payload.cutoverDate,
      windowStart: window.start,
      windowEnd: window.end,
      payloadHash,
      importedBy: contract.user.id,
      invoiceCount: payload.invoices.length,
      lineCount: payload.invoices.reduce((n, invoice) => n + invoice.lines.length, 0),
    }).returning();
    let resolved = 0, unresolved = 0, conflicts = 0, skipped = 0;
    for (const invoice of payload.invoices) {
      const invoiceSnapshot = { ...invoice, sourceSystem: ORDERLY_SOURCE_SYSTEM, sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID };
      const invoiceHash = hash(invoiceSnapshot);
      const [existing] = await tx.select().from(historicalInvoices).where(and(
        eq(historicalInvoices.companyId, auth!.companyId),
        eq(historicalInvoices.sourceSystem, ORDERLY_SOURCE_SYSTEM),
        eq(historicalInvoices.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
        eq(historicalInvoices.sourceInvoiceId, invoice.sourceInvoiceId),
      )).limit(1);
      if (existing) {
        if (existing.materialHash === invoiceHash) {
          skipped++;
          continue;
        }
        // Materially changed source data is surfaced for review; stored evidence
        // is never overwritten. Header-level and line-level differences are
        // recorded separately so reviewers can see exactly what moved.
        const storedLines: Array<{ sourceLineId: string; materialHash: string }> = await tx
          .select({ sourceLineId: historicalInvoiceLines.sourceLineId, materialHash: historicalInvoiceLines.materialHash })
          .from(historicalInvoiceLines)
          .where(eq(historicalInvoiceLines.invoiceId, existing.id));
        const storedLineHashes = new Map(storedLines.map(l => [l.sourceLineId, l.materialHash]));

        const headerOf = (source: Record<string, unknown>) => {
          const { lines: _lines, ...header } = source as Record<string, unknown> & { lines?: unknown };
          return header;
        };
        const existingHeaderHash = hash(headerOf(existing.sourceSnapshot as Record<string, unknown>));
        const incomingHeaderHash = hash(headerOf(invoiceSnapshot as unknown as Record<string, unknown>));
        if (existingHeaderHash !== incomingHeaderHash) {
          conflicts++;
          await tx.insert(historicalInvoiceImportConflicts).values({
            importBatchId: batch.id, companyId: auth!.companyId, historicalInvoiceId: existing.id,
            sourceSystem: ORDERLY_SOURCE_SYSTEM, sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
            sourceInvoiceId: invoice.sourceInvoiceId, conflictType: 'invoice_changed',
            existingMaterialHash: existingHeaderHash, incomingMaterialHash: incomingHeaderHash, incomingSnapshot: invoiceSnapshot,
          });
        }
        const incomingLineIds = new Set<string>();
        for (const line of invoice.lines) {
          incomingLineIds.add(line.sourceLineId);
          const lineSnapshot = { ...line, sourceSystem: ORDERLY_SOURCE_SYSTEM, sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID };
          const incomingLineHash = hash(lineSnapshot);
          const storedLineHash = storedLineHashes.get(line.sourceLineId);
          if (storedLineHash === incomingLineHash) continue;
          conflicts++;
          await tx.insert(historicalInvoiceImportConflicts).values({
            importBatchId: batch.id, companyId: auth!.companyId, historicalInvoiceId: existing.id,
            sourceSystem: ORDERLY_SOURCE_SYSTEM, sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
            sourceInvoiceId: invoice.sourceInvoiceId, conflictType: 'line_changed',
            existingMaterialHash: storedLineHash ?? '', incomingMaterialHash: incomingLineHash, incomingSnapshot: lineSnapshot,
          });
        }
        // A stored line missing from the re-import is also a material change:
        // retained evidence must never be dropped without review.
        for (const stored of storedLines) {
          if (incomingLineIds.has(stored.sourceLineId)) continue;
          conflicts++;
          await tx.insert(historicalInvoiceImportConflicts).values({
            importBatchId: batch.id, companyId: auth!.companyId, historicalInvoiceId: existing.id,
            sourceSystem: ORDERLY_SOURCE_SYSTEM, sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
            sourceInvoiceId: invoice.sourceInvoiceId, conflictType: 'line_missing',
            existingMaterialHash: stored.materialHash, incomingMaterialHash: '',
            incomingSnapshot: { sourceLineId: stored.sourceLineId, absentFromReimport: true },
          });
        }
        continue;
      }
      const vendorMatches = invoice.vendorName ? await tx.select({ id: vendors.id }).from(vendors).where(and(
        eq(vendors.companyId, auth!.companyId), sql`lower(${vendors.name}) = lower(${invoice.vendorName.trim()})`,
      )) : [];
      const vendorId = vendorMatches.length === 1 ? vendorMatches[0].id : null;
      const [storedInvoice] = await tx.insert(historicalInvoices).values({
        companyId: auth!.companyId, storeId: contract.storeId, vendorId, importBatchId: batch.id,
        sourceSystem: ORDERLY_SOURCE_SYSTEM, sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
        sourceInvoiceId: invoice.sourceInvoiceId, invoiceNumber: invoice.invoiceNumber ?? null,
        invoiceDate: invoice.invoiceDate, invoicePeriod: invoice.invoiceDate.slice(0, 7),
        vendorNameSnapshot: invoice.vendorName ?? null, vendorExternalIdSnapshot: invoice.vendorExternalId ?? null,
        subtotal: invoice.subtotal ?? 0, taxAmount: invoice.taxAmount ?? 0, chargeAmount: invoice.chargeAmount ?? 0,
        creditAmount: invoice.creditAmount ?? 0, totalAmount: invoice.totalAmount ?? 0,
        sourceSnapshot: invoiceSnapshot, materialHash: invoiceHash,
      }).returning();
      for (const line of invoice.lines) {
        const mapping = line.packSizeId ? await tx.select({ vendorItemId: vendorItemExternalMappings.vendorItemId }).from(vendorItemExternalMappings).where(and(
          eq(vendorItemExternalMappings.companyId, auth!.companyId),
          eq(vendorItemExternalMappings.sourceSystem, ORDERLY_SOURCE_SYSTEM),
          eq(vendorItemExternalMappings.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
          eq(vendorItemExternalMappings.sourceExternalId, line.packSizeId),
        )).limit(1) : [];
        const mappedVendorItemId = mapping[0]?.vendorItemId ?? null;
        // Never trust the mapping row alone: prove the vendor item and its
        // inventory item belong to the acting company before linking. A stale
        // or corrupted mapping must degrade to "unresolved", not cross tenants.
        const [vendorItem] = mappedVendorItemId
          ? await tx
              .select({ id: vendorItems.id, inventoryItemId: vendorItems.inventoryItemId })
              .from(vendorItems)
              .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
              .innerJoin(inventoryItems, eq(inventoryItems.id, vendorItems.inventoryItemId))
              .where(and(
                eq(vendorItems.id, mappedVendorItemId),
                eq(vendors.companyId, auth!.companyId),
                eq(inventoryItems.companyId, auth!.companyId),
              ))
              .limit(1)
          : [];
        const vendorItemId = vendorItem?.id ?? null;
        const inventoryItemId = vendorItem?.inventoryItemId ?? null;
        const resolutionStatus = vendorItemId && inventoryItemId ? 'resolved' : 'unresolved';
        if (resolutionStatus === 'resolved') resolved++; else unresolved++;
        const lineSnapshot = { ...line, sourceSystem: ORDERLY_SOURCE_SYSTEM, sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID };
        await tx.insert(historicalInvoiceLines).values({
          companyId: auth!.companyId, invoiceId: storedInvoice.id, sourceLineId: line.sourceLineId,
          vendorItemId, inventoryItemId, resolutionStatus, productNameSnapshot: line.productName ?? null,
          sourceExternalId: line.packSizeId ?? null, quantity: line.quantity ?? null, unitPrice: line.unitPrice ?? null,
          lineTotal: line.lineTotal ?? null, packSnapshot: line.pack, catchWeightSnapshot: line.catchWeight,
          glSnapshot: line.gl, financialSnapshot: { ...line.financial, creditAmount: line.creditAmount ?? null },
          sourceSnapshot: lineSnapshot, materialHash: hash(lineSnapshot),
        });
      }
    }
    const status = conflicts ? 'completed_with_conflicts' : 'completed';
    await tx.update(historicalInvoiceImportBatches).set({
      status, resolvedLineCount: resolved, unresolvedLineCount: unresolved, conflictCount: conflicts, skippedCount: skipped,
    }).where(eq(historicalInvoiceImportBatches.id, batch.id));
    return { batchId: batch.id, status, window, invoices: payload.invoices.length, resolvedLines: resolved, unresolvedLines: unresolved, conflicts, skipped };
  });
}

interface CompletenessInvoiceRow {
  id: string;
  total: number | null;
  period: string;
  vendorId: string | null;
}
interface CompletenessLineRow {
  resolutionStatus: string;
  glSnapshot: unknown;
}
interface CompletenessBatchRow {
  conflictCount: number | null;
  skippedCount: number | null;
}

export async function getHistoricalInvoiceCompleteness(auth: HistoricalInvoiceAuthorization | null | undefined) {
  const contract = await resolveAuthorizedBinding(auth);
  const batches = await db.select().from(historicalInvoiceImportBatches).where(and(
    eq(historicalInvoiceImportBatches.companyId, auth!.companyId),
    eq(historicalInvoiceImportBatches.sourceSystem, ORDERLY_SOURCE_SYSTEM),
    eq(historicalInvoiceImportBatches.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
    eq(historicalInvoiceImportBatches.destinationStoreId, contract.storeId),
  ));
  const invoices: CompletenessInvoiceRow[] = await db.select({ id: historicalInvoices.id, total: historicalInvoices.totalAmount, period: historicalInvoices.invoicePeriod, vendorId: historicalInvoices.vendorId })
    .from(historicalInvoices).where(and(
      eq(historicalInvoices.companyId, auth!.companyId),
      eq(historicalInvoices.storeId, contract.storeId),
      eq(historicalInvoices.sourceSystem, ORDERLY_SOURCE_SYSTEM),
      eq(historicalInvoices.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
    ));
  // Lines must be scoped through their invoice to the authorized store and
  // source property — a company-only filter would leak other stores' history
  // into this report.
  const lines: CompletenessLineRow[] = await db
    .select({ resolutionStatus: historicalInvoiceLines.resolutionStatus, glSnapshot: historicalInvoiceLines.glSnapshot })
    .from(historicalInvoiceLines)
    .innerJoin(historicalInvoices, eq(historicalInvoices.id, historicalInvoiceLines.invoiceId))
    .where(and(
      eq(historicalInvoiceLines.companyId, auth!.companyId),
      eq(historicalInvoices.companyId, auth!.companyId),
      eq(historicalInvoices.storeId, contract.storeId),
      eq(historicalInvoices.sourceSystem, ORDERLY_SOURCE_SYSTEM),
      eq(historicalInvoices.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
    ));
  const batchRows = batches as CompletenessBatchRow[];
  const resolvedLines = lines.filter(l => l.resolutionStatus === 'resolved').length;
  const unresolvedLines = lines.length - resolvedLines;
  return {
    batches,
    months: [...new Set(invoices.map(i => i.period))].sort(),
    invoiceCount: invoices.length,
    totalAmount: invoices.reduce((n: number, i) => n + (i.total ?? 0), 0),
    lineCount: lines.length,
    resolvedLines,
    unresolvedLines,
    vendorCoverage: { resolved: invoices.filter(i => i.vendorId).length, unresolved: invoices.filter(i => !i.vendorId).length },
    sourceKeyCoverage: { resolved: resolvedLines, unresolved: unresolvedLines },
    missingGlMappings: lines.filter(l => !l.glSnapshot || Object.keys(l.glSnapshot as object).length === 0).length,
    conflicts: batchRows.reduce((n: number, b) => n + (b.conflictCount ?? 0), 0),
    skipped: batchRows.reduce((n: number, b) => n + (b.skippedCount ?? 0), 0),
  };
}

export async function listHistoricalInvoices(auth: HistoricalInvoiceAuthorization | null | undefined) {
  const contract = await resolveAuthorizedBinding(auth);
  return db.select().from(historicalInvoices).where(and(
    eq(historicalInvoices.companyId, auth!.companyId),
    eq(historicalInvoices.storeId, contract.storeId),
    eq(historicalInvoices.sourceSystem, ORDERLY_SOURCE_SYSTEM),
    eq(historicalInvoices.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
  ));
}