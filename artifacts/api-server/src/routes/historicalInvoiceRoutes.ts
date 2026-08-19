import type { Express } from 'express';
import { requireAuth, requireTier } from '../auth';
import {
  getHistoricalInvoiceCompleteness,
  HistoricalInvoiceImportError,
  listHistoricalInvoices,
  stageHistoricalInvoiceImport,
} from '../services/orderly/historicalInvoiceImport';
import {
  getImportedInvoiceDetail,
  ImportedInvoiceReadError,
  listImportedInvoices,
} from '../services/orderly/importedInvoiceRead';

function status(error: unknown) {
  if (!(error instanceof HistoricalInvoiceImportError)) return 500;
  return error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : 400;
}
function auth(req: any) {
  return { actingUserId: req.user?.id, companyId: req.companyId };
}

function importedInvoiceErrStatus(error: unknown): number {
  if (error instanceof ImportedInvoiceReadError) {
    return error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : 401;
  }
  return 500;
}

export function registerHistoricalInvoiceRoutes(app: Express) {
  app.post('/api/historical-invoices/orderly/stage', requireAuth, requireTier('platform'), async (req, res) => {
    try {
      res.status(201).json(await stageHistoricalInvoiceImport(req.body, auth(req)));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to stage historical invoices.' });
    }
  });
  app.get('/api/historical-invoices/orderly/completeness', requireAuth, requireTier('platform'), async (req, res) => {
    try {
      res.json(await getHistoricalInvoiceCompleteness(auth(req)));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to read invoice completeness.' });
    }
  });
  app.get('/api/historical-invoices/orderly', requireAuth, requireTier('platform'), async (req, res) => {
    try {
      res.json(await listHistoricalInvoices(auth(req)));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to read historical invoices.' });
    }
  });

  // ── Imported-invoice read surface (basic tier) ────────────────────────────
  // @ts-ignore
  app.get('/api/imported-invoices', requireAuth, requireTier('basic'), async (req: any, res: any) => {
    try {
      const user = req.user;
      const companyId: string = req.companyId;
      if (!user || !companyId) {
        return res.status(401).json({ error: 'Not authenticated.' });
      }
      const summaries = await listImportedInvoices(user, companyId);
      res.json(summaries);
    } catch (error) {
      res.status(importedInvoiceErrStatus(error)).json({
        error: error instanceof Error ? error.message : 'Unable to list imported invoices.',
      });
    }
  });

  // @ts-ignore
  app.get('/api/imported-invoices/:invoiceId', requireAuth, requireTier('basic'), async (req: any, res: any) => {
    try {
      const user = req.user;
      const companyId: string = req.companyId;
      const invoiceId = String(req.params.invoiceId);
      if (!user || !companyId) {
        return res.status(401).json({ error: 'Not authenticated.' });
      }
      const detail = await getImportedInvoiceDetail(invoiceId, user, companyId);
      if (!detail) {
        return res.status(404).json({ error: 'Invoice not found.' });
      }
      res.json(detail);
    } catch (error) {
      res.status(importedInvoiceErrStatus(error)).json({
        error: error instanceof Error ? error.message : 'Unable to read imported invoice.',
      });
    }
  });
}
