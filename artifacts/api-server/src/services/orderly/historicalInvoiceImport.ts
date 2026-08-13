/**
 * Historical invoice retention for the approved Orderly exit migration.
 * This module deliberately has no dependency on PO, receiving, AP, or QuickBooks
 * services. Persisted records are immutable source evidence; review state lives
 * on import batches and conflict records.
 */
import crypto from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
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
}).superRefine((invoice, ctx) => {
  const seen = new Set<string>();
  for (const [index, line] of invoice.lines.entries()) {
    if (seen.has(line.sourceLineId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lines', index, 'sourceLineId'],
        message: `Duplicate source line identity "${line.sourceLineId}" is not allowed within an invoice.`,
      });
    }
    seen.add(line.sourceLineId);
  }
});
export const historicalInvoicePayloadSchema = z.object({
  sourceSystem: z.literal(ORDERLY_SOURCE_SYSTEM),
  sourcePropertyId: z.literal(BAY_HILL_ORDERLY_PROPERTY_ID),
  cutoverDate: z.string().date(),
  // A source extract may explicitly establish a quiet/closed month. This is
  // evidence of zero activity, not a guess based on an absent invoice.
  explainedZeroMonths: z.array(z.string().regex(/^\d{4}-\d{2}$/)).optional().default([]),
  invoices: z.array(invoiceSchema),
}).superRefine((payload, ctx) => {
  const expected = new Set(historicalInvoiceWindowMonths(deriveHistoricalInvoiceWindow(payload.cutoverDate)));
  const seen = new Set<string>();
  for (const [index, month] of payload.explainedZeroMonths.entries()) {
    if (seen.has(month)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['explainedZeroMonths', index], message: `Duplicate explained-zero month "${month}".` });
    } else if (!expected.has(month)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['explainedZeroMonths', index], message: `Explained-zero month "${month}" is outside the required 12-month window.` });
    }
    seen.add(month);
  }
});
export type HistoricalInvoicePayload = z.infer<typeof historicalInvoicePayloadSchema>;
type HistoricalInvoiceInput = z.infer<typeof invoiceSchema>;
type HistoricalInvoiceLineInput = z.infer<typeof lineSchema>;

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

/**
 * The source snapshots include useful diagnostic metadata, but not every field
 * in them determines whether retained evidence materially changed. Keep the
 * comparison surface explicit and stable: invoice identity, dates, vendor and
 * financial totals; plus every line identity, quantity, price/amount, credit,
 * pack/UOM, catch-weight, GL, and financial classification value.
 */
function invoiceHeaderMaterial(invoice: HistoricalInvoiceInput) {
  return {
    sourceInvoiceId: invoice.sourceInvoiceId,
    invoiceNumber: invoice.invoiceNumber ?? null,
    invoiceDate: invoice.invoiceDate,
    vendorName: invoice.vendorName ?? null,
    vendorExternalId: invoice.vendorExternalId ?? null,
    subtotal: invoice.subtotal ?? null,
    taxAmount: invoice.taxAmount ?? null,
    chargeAmount: invoice.chargeAmount ?? null,
    creditAmount: invoice.creditAmount ?? null,
    totalAmount: invoice.totalAmount ?? null,
  };
}
function lineMaterial(line: HistoricalInvoiceLineInput) {
  return {
    sourceLineId: line.sourceLineId,
    packSizeId: line.packSizeId ?? null,
    productName: line.productName ?? null,
    quantity: line.quantity ?? null,
    unitPrice: line.unitPrice ?? null,
    lineTotal: line.lineTotal ?? null,
    creditAmount: line.creditAmount ?? null,
    pack: line.pack ?? {},
    catchWeight: line.catchWeight ?? {},
    gl: line.gl ?? {},
    financial: line.financial ?? {},
  };
}
function lineMaterialHash(line: HistoricalInvoiceLineInput) {
  return hash(lineMaterial(line));
}
function invoiceMaterialHash(invoice: HistoricalInvoiceInput) {
  return hash({
    header: invoiceHeaderMaterial(invoice),
    // Source line IDs form the identity, not the source array order.
    lines: invoice.lines.map(lineMaterial).sort((a, b) => a.sourceLineId.localeCompare(b.sourceLineId)),
  });
}
function invoiceHeaderMaterialHash(invoice: HistoricalInvoiceInput) {
  return hash(invoiceHeaderMaterial(invoice));
}

function deduplicateExactInvoices(invoices: HistoricalInvoiceInput[]) {
  const firstBySourceId = new Map<string, HistoricalInvoiceInput>();
  const toProcess: HistoricalInvoiceInput[] = [];
  let exactDuplicateCount = 0;
  for (const invoice of invoices) {
    const first = firstBySourceId.get(invoice.sourceInvoiceId);
    if (!first) {
      firstBySourceId.set(invoice.sourceInvoiceId, invoice);
      toProcess.push(invoice);
      continue;
    }
    if (invoiceMaterialHash(first) === invoiceMaterialHash(invoice)) {
      exactDuplicateCount++;
      continue;
    }
    // Keep the conflicting instance in the transaction so it creates conflict
    // evidence against the first retained source invoice, never a second row.
    toProcess.push(invoice);
  }
  return {
    toProcess,
    uniqueInvoices: [...firstBySourceId.values()],
    exactDuplicateCount,
  };
}
export interface HistoricalInvoiceWindow {
  start: string;
  end: string;
}

/**
 * Derives the twelve *complete calendar months* preceding a date-only cutover.
 * Date components are parsed directly rather than through a local-time Date
 * constructor, so server timezone cannot shift a boundary.
 */
export function deriveHistoricalInvoiceWindow(cutoverDate: string): HistoricalInvoiceWindow {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cutoverDate);
  if (!match) throw new HistoricalInvoiceImportError('INVALID_REQUEST', 'Invalid cutover date.');
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const cutover = new Date(Date.UTC(year, monthIndex, day));
  if (
    cutover.getUTCFullYear() !== year
    || cutover.getUTCMonth() !== monthIndex
    || cutover.getUTCDate() !== day
  ) {
    throw new HistoricalInvoiceImportError('INVALID_REQUEST', 'Invalid cutover date.');
  }
  // The floor is twelve *complete calendar months*: for a cutover during
  // August 2026, retain August 2025 through July 2026.
  const end = new Date(Date.UTC(year, monthIndex, 0));
  const start = new Date(Date.UTC(year, monthIndex - 12, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function historicalInvoiceWindowMonths(window: HistoricalInvoiceWindow): string[] {
  const months: string[] = [];
  const start = /^(\d{4})-(\d{2})-\d{2}$/.exec(window.start);
  const end = /^(\d{4})-(\d{2})-\d{2}$/.exec(window.end);
  if (!start || !end) throw new HistoricalInvoiceImportError('INVALID_REQUEST', 'Invalid historical invoice window.');
  let year = Number(start[1]);
  let monthIndex = Number(start[2]) - 1;
  const endYear = Number(end[1]);
  const endMonthIndex = Number(end[2]) - 1;
  while (year < endYear || (year === endYear && monthIndex <= endMonthIndex)) {
    months.push(`${year}-${String(monthIndex + 1).padStart(2, '0')}`);
    monthIndex++;
    if (monthIndex === 12) {
      year++;
      monthIndex = 0;
    }
  }
  return months;
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
  const window = deriveHistoricalInvoiceWindow(payload.cutoverDate);
  const deduplicated = deduplicateExactInvoices(payload.invoices);
  for (const invoice of deduplicated.uniqueInvoices) {
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
      explainedZeroMonths: payload.explainedZeroMonths,
      importedBy: contract.user.id,
      // Counts describe distinct source identities, so exact duplicate payload
      // entries can never inflate the retained-history import summary.
      invoiceCount: deduplicated.uniqueInvoices.length,
      lineCount: deduplicated.uniqueInvoices.reduce((n, invoice) => n + invoice.lines.length, 0),
    }).returning();
    let resolved = 0, unresolved = 0, conflicts = 0, skipped = deduplicated.exactDuplicateCount;
    for (const invoice of deduplicated.toProcess) {
      const invoiceSnapshot = { ...invoice, sourceSystem: ORDERLY_SOURCE_SYSTEM, sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID };
      const invoiceHash = invoiceMaterialHash(invoice);
      const [existing] = await tx.select().from(historicalInvoices).where(and(
        eq(historicalInvoices.companyId, auth!.companyId),
        eq(historicalInvoices.sourceSystem, ORDERLY_SOURCE_SYSTEM),
        eq(historicalInvoices.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
        eq(historicalInvoices.sourceInvoiceId, invoice.sourceInvoiceId),
      )).limit(1);
      if (existing) {
        const existingSnapshot = existing.sourceSnapshot as HistoricalInvoiceInput;
        if (invoiceMaterialHash(existingSnapshot) === invoiceHash) {
          skipped++;
          continue;
        }
        // Materially changed source data is surfaced for review; stored evidence
        // is never overwritten. Header-level and line-level differences are
        // recorded separately so reviewers can see exactly what moved.
        const storedLines: Array<{ sourceLineId: string; sourceSnapshot: unknown }> = await tx
          .select({ sourceLineId: historicalInvoiceLines.sourceLineId, sourceSnapshot: historicalInvoiceLines.sourceSnapshot })
          .from(historicalInvoiceLines)
          .where(eq(historicalInvoiceLines.invoiceId, existing.id));
        const storedLineHashes = new Map(storedLines.map(line => [
          line.sourceLineId,
          lineMaterialHash(line.sourceSnapshot as HistoricalInvoiceLineInput),
        ]));

        const existingHeaderHash = invoiceHeaderMaterialHash(existingSnapshot);
        const incomingHeaderHash = invoiceHeaderMaterialHash(invoice);
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
          const incomingLineHash = lineMaterialHash(line);
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
            existingMaterialHash: storedLineHashes.get(stored.sourceLineId)!, incomingMaterialHash: '',
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
          sourceSnapshot: lineSnapshot, materialHash: lineMaterialHash(line),
        });
      }
    }
    const status = conflicts ? 'completed_with_conflicts' : 'completed';
    await tx.update(historicalInvoiceImportBatches).set({
      status, resolvedLineCount: resolved, unresolvedLineCount: unresolved, conflictCount: conflicts, skippedCount: skipped,
    }).where(eq(historicalInvoiceImportBatches.id, batch.id));
    return {
      batchId: batch.id,
      status,
      window,
      invoices: deduplicated.uniqueInvoices.length,
      resolvedLines: resolved,
      unresolvedLines: unresolved,
      conflicts,
      skipped,
    };
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
  cutoverDate: string;
  explainedZeroMonths: unknown;
  conflictCount: number | null;
  skippedCount: number | null;
}

export async function getHistoricalInvoiceCompleteness(auth: HistoricalInvoiceAuthorization | null | undefined) {
  const contract = await resolveAuthorizedBinding(auth);
  const batches = await db.select().from(historicalInvoiceImportBatches)
    .where(and(
      eq(historicalInvoiceImportBatches.companyId, auth!.companyId),
      eq(historicalInvoiceImportBatches.sourceSystem, ORDERLY_SOURCE_SYSTEM),
      eq(historicalInvoiceImportBatches.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
      eq(historicalInvoiceImportBatches.destinationStoreId, contract.storeId),
    ))
    .orderBy(desc(historicalInvoiceImportBatches.importedAt), desc(historicalInvoiceImportBatches.id));
  const batchRows = batches as CompletenessBatchRow[];
  const configuredCutoverDate = batchRows[0]?.cutoverDate ?? null;
  if (!configuredCutoverDate) {
    return {
      batches,
      cutoverDate: null,
      window: null,
      expectedMonths: [],
      months: [],
      representedMonths: [],
      missingMonths: [],
      explainedZeroMonths: [],
      readiness: { ready: false, status: 'not_ready' as const, reason: 'no_staged_import' as const },
      invoiceCount: 0,
      totalAmount: 0,
      lineCount: 0,
      resolvedLines: 0,
      unresolvedLines: 0,
      vendorCoverage: { resolved: 0, unresolved: 0 },
      sourceKeyCoverage: { resolved: 0, unresolved: 0 },
      missingGlMappings: 0,
      conflicts: 0,
      skipped: 0,
    };
  }
  const window = deriveHistoricalInvoiceWindow(configuredCutoverDate);
  const expectedMonths = historicalInvoiceWindowMonths(window);
  const explainedZeroMonths = new Set(
    batchRows
      .filter(batch => batch.cutoverDate === configuredCutoverDate)
      .flatMap(batch => Array.isArray(batch.explainedZeroMonths) ? batch.explainedZeroMonths : [])
      .filter((month): month is string => typeof month === 'string' && expectedMonths.includes(month)),
  );
  const invoices: CompletenessInvoiceRow[] = await db.select({ id: historicalInvoices.id, total: historicalInvoices.totalAmount, period: historicalInvoices.invoicePeriod, vendorId: historicalInvoices.vendorId })
    .from(historicalInvoices).where(and(
      eq(historicalInvoices.companyId, auth!.companyId),
      eq(historicalInvoices.storeId, contract.storeId),
      eq(historicalInvoices.sourceSystem, ORDERLY_SOURCE_SYSTEM),
      eq(historicalInvoices.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
      sql`${historicalInvoices.invoiceDate} >= ${window.start}`,
      sql`${historicalInvoices.invoiceDate} <= ${window.end}`,
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
      sql`${historicalInvoices.invoiceDate} >= ${window.start}`,
      sql`${historicalInvoices.invoiceDate} <= ${window.end}`,
    ));
  const resolvedLines = lines.filter(l => l.resolutionStatus === 'resolved').length;
  const unresolvedLines = lines.length - resolvedLines;
  const invoiceCountByMonth = new Map<string, number>();
  for (const invoice of invoices) {
    invoiceCountByMonth.set(invoice.period, (invoiceCountByMonth.get(invoice.period) ?? 0) + 1);
  }
  const months = expectedMonths.map(month => {
    const invoiceCount = invoiceCountByMonth.get(month) ?? 0;
    return {
      month,
      status: invoiceCount > 0
        ? 'represented' as const
        : explainedZeroMonths.has(month)
          ? 'explained_zero' as const
          : 'missing' as const,
      invoiceCount,
    };
  });
  const missingMonths = months.filter(month => month.status === 'missing').map(month => month.month);
  return {
    batches,
    cutoverDate: configuredCutoverDate,
    window,
    expectedMonths,
    months,
    representedMonths: months.filter(month => month.status === 'represented').map(month => month.month),
    missingMonths,
    explainedZeroMonths: months.filter(month => month.status === 'explained_zero').map(month => month.month),
    readiness: missingMonths.length === 0
      ? { ready: true, status: 'ready' as const, reason: 'all_months_represented_or_explained' as const }
      : { ready: false, status: 'not_ready' as const, reason: 'missing_months' as const },
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