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
import { requireAuth, requireTier } from '../auth';
import { canAccessStore, getAccessibleStores } from '../permissions';
import {
  approveVendorInvoiceBatch,
  getActiveOrderlyBinding,
  getBatchDestinationStoreId,
  listHeldLines,
  listVendorInvoiceBatches,
  runVendorInvoiceResolutionPreview,
  stageVendorInvoiceUpload,
  VendorInvoiceImportError,
} from '../services/orderly/vendorInvoiceImport';
import { VendorInvoiceParseError } from '../services/orderly/vendorInvoiceXlsx';

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
