import type { Express } from 'express';
import { requireAuth } from '../auth';
import {
  AccountingClassificationError,
  createAccountingAccount,
  getCurrentAccountingClassification,
  listAccountingAccounts,
  setCategoryAccountingDefault,
  setInventoryItemAccountingOverride,
  updateAccountingAccount,
} from '../services/accountingClassification';

function status(error: unknown) {
  if (!(error instanceof AccountingClassificationError)) return 500;
  switch (error.code) {
    case 'UNAUTHENTICATED': return 401;
    case 'FORBIDDEN': return 403;
    case 'NOT_FOUND': return 404;
    case 'CONFLICT': return 409;
    default: return 400;
  }
}

function auth(req: any) {
  return { actingUserId: req.user?.id, companyId: req.companyId };
}

export function registerAccountingRoutes(app: Express) {
  app.get('/api/accounting/accounts', requireAuth, async (req, res) => {
    try {
      res.json(await listAccountingAccounts(auth(req), req.query.includeInactive === 'true'));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to read accounting accounts.' });
    }
  });

  app.post('/api/accounting/accounts', requireAuth, async (req, res) => {
    try {
      res.status(201).json(await createAccountingAccount(req.body, auth(req)));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to create accounting account.' });
    }
  });

  app.patch('/api/accounting/accounts/:id', requireAuth, async (req, res) => {
    try {
      res.json(await updateAccountingAccount(String(req.params.id), req.body, auth(req)));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to update accounting account.' });
    }
  });

  app.patch('/api/accounting/categories/:id/default-account', requireAuth, async (req, res) => {
    try {
      const accountId = req.body?.accountId === undefined ? null : req.body.accountId;
      if (accountId !== null && typeof accountId !== 'string') {
        res.status(400).json({ error: 'accountId must be a string or null.' });
        return;
      }
      res.json(await setCategoryAccountingDefault(String(req.params.id), accountId, auth(req)));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to set category accounting default.' });
    }
  });

  app.patch('/api/accounting/items/:id/override', requireAuth, async (req, res) => {
    try {
      const accountId = req.body?.accountId === undefined ? null : req.body.accountId;
      if (accountId !== null && typeof accountId !== 'string') {
        res.status(400).json({ error: 'accountId must be a string or null.' });
        return;
      }
      res.json(await setInventoryItemAccountingOverride(String(req.params.id), accountId, auth(req)));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to set item accounting override.' });
    }
  });

  app.get('/api/accounting/items/:id/classification', requireAuth, async (req, res) => {
    try {
      res.json(await getCurrentAccountingClassification(String(req.params.id), auth(req)));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to resolve accounting classification.' });
    }
  });
}