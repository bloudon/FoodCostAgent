import type { Express } from 'express';
import multer from 'multer';
import { requireAuth, requireCompanyAdmin, requireTier } from '../auth';
import {
  AccountingClassificationError,
  createAccountingAccount,
  getCurrentAccountingClassification,
  listAccountingAccounts,
  setCategoryAccountingDefault,
  setInventoryItemAccountingOverride,
  updateAccountingAccount,
} from '../services/accountingClassification';
import {
  confirmAccountingImport,
  getCategoryMappingPreview,
  getCurrentAccountingImport,
  previewAccountingImport,
  type AccountingImportMapping,
} from '../services/accountingImport';

const chartUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const name = file.originalname.toLocaleLowerCase();
    const accepted = name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls');
    if (!accepted) {
      callback(new Error('Only CSV, XLSX, and XLS files are accepted.'));
      return;
    }
    callback(null, true);
  },
});

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

  const importGuards = [requireAuth, requireTier('enterprise'), requireCompanyAdmin] as const;

  app.get('/api/accounting/imports/current', ...importGuards, async (req, res) => {
    try {
      res.json(await getCurrentAccountingImport(auth(req)));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to read accounting import.' });
    }
  });

  app.get('/api/accounting/categories/mapping-preview', ...importGuards, async (req, res) => {
    try {
      res.json(await getCategoryMappingPreview(auth(req)));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to preview category mappings.' });
    }
  });

  app.post('/api/accounting/imports/preview', ...importGuards, chartUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'A CSV or Excel file is required.' });
        return;
      }
      const headerRow = Number(req.body?.headerRow ?? 1);
      let mapping: AccountingImportMapping | undefined;
      if (req.body?.mapping) {
        try {
          mapping = JSON.parse(String(req.body.mapping));
        } catch {
          res.status(400).json({ error: 'Column mapping must be valid JSON.' });
          return;
        }
      }
      res.json(await previewAccountingImport({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        headerRow,
        mapping,
        auth: auth(req),
      }));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to preview accounting import.' });
    }
  });

  app.post('/api/accounting/imports/:sessionId/confirm', ...importGuards, async (req, res) => {
    try {
      res.json(await confirmAccountingImport(
        String(req.params.sessionId),
        req.body?.applyExactCategoryMappings === true,
        auth(req),
      ));
    } catch (error) {
      res.status(status(error)).json({ error: error instanceof Error ? error.message : 'Unable to confirm accounting import.' });
    }
  });
}