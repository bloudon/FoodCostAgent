/**
 * Vendor invoice XLSX bulk import routes.
 *
 * POST /api/vendor-invoice-import/upload                       — upload + stage
 * GET  /api/vendor-invoice-import/batches                      — list batches
 * GET  /api/vendor-invoice-import/batches/:id/resolution-preview — pure read preview
 * POST /api/vendor-invoice-import/batches/:id/approve          — persist (idempotent)
 * GET  /api/vendor-invoice-import/batches/:id/held-lines       — held lines for linking
 */
import type { Express } from 'express';
import multer from 'multer';
import { requireAuth, requireCompanyAdmin, requireTier } from '../auth';
import { canAccessStore, getAccessibleStores } from '../permissions';
import {
  approveVendorInvoiceBatch,
  createVendorDepositRate,
  updateVendorDepositRateWindow,
  getActiveOrderlyBinding,
  getVendorDepositLedger,
  getBatchDestinationStoreId,
  listHeldLines,
  listVendorInvoiceBatches,
  runVendorInvoiceResolutionPreview,
  stageVendorInvoiceUpload,
  VendorInvoiceImportError,
} from '../services/orderly/vendorInvoiceImport';
import { VendorInvoiceParseError } from '../services/orderly/vendorInvoiceXlsx';
import { and, eq } from 'drizzle-orm';
import { insertVendorDepositRateSchema, vendorDepositRates, vendors } from '@workspace/db';
import { db } from '../db';

const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const ok =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel';
    if (ok) cb(null, true);
    else cb(new Error('Only Excel files (.xlsx, .xls) are accepted'));
  },
});

function errStatus(err: unknown): number {
  if (err instanceof VendorInvoiceParseError) return 422;
  if (err instanceof VendorInvoiceImportError) {
    return err.code === 'NOT_FOUND' ? 404
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : 400;
  }
  return 500;
}


async function assertStoreAccess(req: any, storeId: string): Promise<void> {
  const user = req.user;
  if (!user || !(await canAccessStore(user, storeId))) {
    throw new VendorInvoiceImportError('FORBIDDEN', 'You do not have access to the destination store for this import.');
  }
}

export function registerVendorInvoiceImportRoutes(app: Express) {
  app.post(
    '/api/vendor-invoice-import/upload',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    xlsxUpload.single('file'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = ((req as any).user?.id as string | undefined) ?? null;
        const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
        if (!file) return res.status(400).json({ error: 'No file uploaded. Send the workbook as multipart field "file".' });
        const binding = await getActiveOrderlyBinding(companyId);
        await assertStoreAccess(req, binding.destinationStoreId as string);
        const result = await stageVendorInvoiceUpload({
          buffer: file.buffer,
          originalFilename: file.originalname,
          companyId,
          userId,
        });
        res.status(result.duplicateWarning ? 200 : 201).json(result);
      } catch (err: any) {
        console.error('[VendorInvoiceImport] upload error:', err);
        res.status(errStatus(err)).json({ error: err?.message ?? 'Upload failed.' });
      }
    },
  );

  app.get(
    '/api/vendor-invoice-import/batches',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const user = (req as any).user;
        const accessibleStoreIds = user ? await getAccessibleStores(user, companyId) : [];
        res.json(await listVendorInvoiceBatches(companyId, accessibleStoreIds));
      } catch (err: any) {
        console.error('[VendorInvoiceImport] batches error:', err);
        res.status(errStatus(err)).json({ error: err?.message ?? 'Could not list batches.' });
      }
    },
  );

  app.get(
    '/api/vendor-invoice-import/batches/:batchId/resolution-preview',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const batchId = String(req.params.batchId);
        await assertStoreAccess(req, await getBatchDestinationStoreId(batchId, companyId));
        res.json(await runVendorInvoiceResolutionPreview(batchId, companyId));
      } catch (err: any) {
        console.error('[VendorInvoiceImport] preview error:', err);
        res.status(errStatus(err)).json({ error: err?.message ?? 'Preview failed.' });
      }
    },
  );

  app.post(
    '/api/vendor-invoice-import/batches/:batchId/approve',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const batchId = String(req.params.batchId);
        await assertStoreAccess(req, await getBatchDestinationStoreId(batchId, companyId));
        const result = await approveVendorInvoiceBatch({
          batchId,
          companyId,
          userId: ((req as any).user?.id as string | undefined) ?? null,
        });
        res.json(result);
      } catch (err: any) {
        console.error('[VendorInvoiceImport] approve error:', err);
        res.status(errStatus(err)).json({ error: err?.message ?? 'Approval failed.' });
      }
    },
  );

  // ── Vendor keg-deposit rates (effective-dated) ─────────────────────────────
  // Consumed by deposit-aware reconciliation. Company-scoped and admin-only
  // (rates are company-wide financial configuration); writes reject
  // overlapping windows so "exactly one effective rate" stays provable.
  app.get(
    '/api/vendor-invoice-import/deposit-rates/:vendorId',
    requireAuth,
    // @ts-ignore
    requireCompanyAdmin,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const vendorId = String(req.params.vendorId);
        const [vendor] = await db.select({ id: vendors.id }).from(vendors)
          .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId))).limit(1);
        if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });
        const rates = await db.select().from(vendorDepositRates)
          .where(and(eq(vendorDepositRates.companyId, companyId), eq(vendorDepositRates.vendorId, vendorId)))
          .orderBy(vendorDepositRates.effectiveFrom);
        res.json(rates);
      } catch (err: any) {
        console.error('[VendorInvoiceImport] deposit-rates list error:', err);
        res.status(500).json({ error: err?.message ?? 'Could not list deposit rates.' });
      }
    },
  );

  app.post(
    '/api/vendor-invoice-import/deposit-rates/:vendorId',
    requireAuth,
    // Rates are company-wide reconciliation evidence: only company admins may
    // configure them (store users could otherwise reshape ledger evidence).
    // @ts-ignore
    requireCompanyAdmin,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const vendorId = String(req.params.vendorId);
        const [vendor] = await db.select({ id: vendors.id }).from(vendors)
          .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId))).limit(1);
        if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });
        const parsed = insertVendorDepositRateSchema.safeParse({
          ...req.body,
          companyId,
          vendorId,
          createdBy: ((req as any).user?.id as string | undefined) ?? null,
        });
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid deposit rate.', details: parsed.error.flatten() });
        }
        // Atomic create: overlap check + insert serialized per (company,
        // vendor), so concurrent writers cannot both pass validation.
        const created = await createVendorDepositRate({
          companyId,
          vendorId,
          ratePerKeg: parsed.data.ratePerKeg,
          effectiveFrom: parsed.data.effectiveFrom,
          effectiveTo: parsed.data.effectiveTo ?? null,
          createdBy: parsed.data.createdBy ?? null,
        });
        if (!created) {
          return res.status(409).json({ error: 'The date window overlaps an existing deposit rate for this vendor. End the existing rate first (PATCH its effectiveTo).' });
        }
        res.status(201).json(created);
      } catch (err: any) {
        console.error('[VendorInvoiceImport] deposit-rates create error:', err);
        res.status(errStatus(err)).json({ error: err?.message ?? 'Could not create deposit rate.' });
      }
    },
  );

  // ── Vendor keg-deposit ledger (read-only) ──────────────────────────────────
  // Derived balance + immutable event history for the vendor page: "we have
  // $X tied up in keg deposits with this vendor, ~N outstanding kegs."
  // Company-scoped read; no mutation paths exist (events are posted only by
  // batch approval).
  app.get(
    '/api/vendor-invoice-import/deposit-ledger/:vendorId',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const vendorId = String(req.params.vendorId);
        const [vendor] = await db.select({ id: vendors.id }).from(vendors)
          .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId))).limit(1);
        if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });
        res.json(await getVendorDepositLedger(companyId, vendorId));
      } catch (err: any) {
        console.error('[VendorInvoiceImport] deposit-ledger error:', err);
        res.status(errStatus(err)).json({ error: err?.message ?? 'Could not load deposit ledger.' });
      }
    },
  );

  // Close (or re-open/extend) a rate window so a successor rate can start.
  app.patch(
    '/api/vendor-invoice-import/deposit-rates/:vendorId/:rateId',
    requireAuth,
    // @ts-ignore
    requireCompanyAdmin,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const vendorId = String(req.params.vendorId);
        const rateId = String(req.params.rateId);
        const [vendor] = await db.select({ id: vendors.id }).from(vendors)
          .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId))).limit(1);
        if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });
        const effectiveTo = req.body?.effectiveTo ?? null;
        if (effectiveTo != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveTo))) {
          return res.status(400).json({ error: 'effectiveTo must be YYYY-MM-DD or null.' });
        }
        const updated = await updateVendorDepositRateWindow({
          companyId,
          vendorId,
          rateId,
          effectiveTo: effectiveTo == null ? null : String(effectiveTo),
        });
        res.json(updated);
      } catch (err: any) {
        console.error('[VendorInvoiceImport] deposit-rates update error:', err);
        res.status(errStatus(err)).json({ error: err?.message ?? 'Could not update deposit rate.' });
      }
    },
  );

  app.get(
    '/api/vendor-invoice-import/batches/:batchId/held-lines',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const batchId = String(req.params.batchId);
        await assertStoreAccess(req, await getBatchDestinationStoreId(batchId, companyId));
        res.json(await listHeldLines(companyId, batchId));
      } catch (err: any) {
        console.error('[VendorInvoiceImport] held-lines error:', err);
        res.status(errStatus(err)).json({ error: err?.message ?? 'Could not list held lines.' });
      }
    },
  );
}
