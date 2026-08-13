import type { Express } from 'express';
import { requireAuth, requireTier } from '../auth';
import {
  getHistoricalInvoiceCompleteness,
  HistoricalInvoiceImportError,
  listHistoricalInvoices,
  stageHistoricalInvoiceImport,
} from '../services/orderly/historicalInvoiceImport';

function status(error: unknown) {
  if (!(error instanceof HistoricalInvoiceImportError)) return 500;
  return error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : 400;
}
function auth(req: any) {
  return { actingUserId: req.user?.id, companyId: req.companyId };
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
}