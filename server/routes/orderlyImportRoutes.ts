/**
 * Orderly Import Routes
 *
 * POST /api/inventory-import/orderly/preview  — upload .xlsx, stage rows atomically, return preview
 * GET  /api/inventory-import/orderly/batches  — list batches for this company
 * PATCH /api/inventory-import/orderly/batches/:batchId/confirm-date — confirm/correct inventory date
 *
 * Idempotency & recovery
 * ─────────────────────
 * When the same file (companyId + SHA-256 hash) has already been staged the endpoint
 * returns duplicateWarning:true and does NOT create a new batch.
 *
 * The caller may send one of three recovery actions in the request body:
 *
 *   action: "reprocess"   — Parse first (so a parse error leaves the DB untouched),
 *                           then atomically delete old batch+rows and insert new ones
 *                           in a single transaction. Old data is NEVER deleted before
 *                           the replacement is guaranteed to succeed.
 *   action: "force_new"   — Stage a new batch alongside the existing one (different id).
 *                           Requires a non-blank `reason` field.
 *   action: "cancel"      — No-op; lets the client handle navigation.
 *
 * Atomicity guarantee
 * ───────────────────
 * Every write path (fresh upload, reprocess, force_new) stages all batch metadata
 * and all row inserts inside a single db.transaction() call. Partial writes cannot
 * persist — either everything commits or nothing does.
 */

import type { Express } from 'express';
import {
  previewCountSession,
  createCountSession,
  DEFAULT_RECONCILIATION_TOLERANCE,
} from '../services/orderly/orderlyCountSession';
import multer from 'multer';
import { requireAuth, requireTier } from '../auth';
import { db } from '../db';
import { sql, eq, and, isNull } from 'drizzle-orm';
import {
  inventoryImportBatches,
  inventoryImportRows,
  companyStores,
} from '@shared/schema';
import {
  parseOrderlyWorkbook,
  computeFileHash,
  ORDERLY_PARSER_VERSION,
  type OrderlyRow,
  type OrderlyParseResult,
} from '../services/orderly/OrderlyParser';
import {
  runResolutionPreview,
  applyBatchApproval,
  type RowDecision,
} from '../services/orderly/orderlyDomain';

// ─── Multer upload — memory storage, xlsx only, max 50 MB ────────────────────

const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const ok =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel';
    if (ok) cb(null, true);
    else cb(new Error('Only Excel files (.xlsx, .xls) are accepted'));
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build the column values for one inventory_import_rows insert. */
function rowInsertValues(r: OrderlyRow, batchId: string, sheetName: string) {
  return {
    batchId,
    rowIndex: r.rowIndex,
    sheetName,
    rawData: r.rawData,
    rawDescription: r.rawDescription || null,
    cleanedDescription: r.cleanedDescription || null,
    cleaningMethod: r.cleaningMethod,
    cleaningConfidence: r.cleaningConfidence,
    removedSuffix: r.removedSuffix || null,
    caseQuantity: r.caseQuantity,
    innerPackQuantity: r.innerPackQuantity,
    baseUnitQuantity: r.baseUnitQuantity,
    caseUnit: r.caseUnit || null,
    innerUnit: r.innerUnit || null,
    baseUnit: r.baseUnit || null,
    packParseStatus: r.packParseStatus,
    sourceItemCode: r.sourceItemCode || null,
    itemCodeStatus: r.itemCodeStatus,
    supplierRaw: r.supplierRaw || null,
    supplierStatus: r.supplierStatus,
    storageLocation: r.storageLocation || null,
    sourceCategory: r.sourceCategory || null,
    sourceGlCode: r.sourceGlCode || null,
    sourceParTarget: r.sourceParTarget,
    packagePrice: r.packagePrice,
    countUnit1: r.countUnit1 || null,
    count1: r.count1,
    countUnit2: r.countUnit2 || null,
    count2: r.count2,
    countUnit3: r.countUnit3 || null,
    count3: r.count3,
    totalUnits: r.totalUnits,
    totalCost: r.totalCost,
    previousCase: r.previousCase,
    previousPack: r.previousPack,
    previousUom: r.previousUom,
    previousCost: r.previousCost,
    rowStatus: r.rowStatus,
  };
}

/**
 * Core staging function — insert batch metadata + all rows inside one transaction.
 * If any chunk insert fails the entire transaction is rolled back (batch included).
 */
async function stageBatchInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    companyId: string;
    userId: string | null;
    fileHash: string;
    filename: string;
    parseResult: OrderlyParseResult;
    forceNewBatchReason?: string | null;
  },
) {
  const { companyId, userId, fileHash, filename, parseResult, forceNewBatchReason } = params;

  const [batch] = await tx
    .insert(inventoryImportBatches)
    .values({
      companyId,
      sourceSystem: 'ORDERLY',
      fileHash,
      originalFilename: filename,
      sheetName: parseResult.sheetName,
      parserVersion: ORDERLY_PARSER_VERSION,
      inventoryDate: parseResult.inventoryDate.detectedDate,
      inventoryDateDetectedFrom: parseResult.inventoryDate.detectedFrom,
      inventoryDateConfirmed: 0,
      uploadedBy: userId,
      status: 'pending_review',
      sourceRowCount: parseResult.sourceRowCount,
      snapshotTotal: parseResult.snapshotTotal,
      forceNewBatchReason: forceNewBatchReason ?? null,
    })
    .returning();

  // Insert rows in chunks of 500 — all within the same transaction
  const CHUNK = 500;
  for (let i = 0; i < parseResult.rows.length; i += CHUNK) {
    const chunk = parseResult.rows.slice(i, i + CHUNK);
    await tx.insert(inventoryImportRows).values(
      chunk.map(r => rowInsertValues(r, batch.id, parseResult.sheetName)),
    );
  }

  return batch;
}

/** Build the unified preview response shape. */
function buildPreviewResponse(batchId: string, parseResult: OrderlyParseResult) {
  return {
    batchId,
    inventoryDate: {
      detectedDate: parseResult.inventoryDate.detectedDate,
      detectedFrom: parseResult.inventoryDate.detectedFrom,
      confidence: parseResult.inventoryDate.confidence,
      requiresConfirmation: true,
    },
    summary: parseResult.summary,
    // First 50 rows as a preview sample
    sampleRows: parseResult.rows.slice(0, 50).map(r => ({
      rowIndex: r.rowIndex,
      storageLocation: r.storageLocation,
      sourceItemCode: r.sourceItemCode,
      itemCodeStatus: r.itemCodeStatus,
      rawDescription: r.rawDescription,
      cleanedDescription: r.cleanedDescription,
      cleaningMethod: r.cleaningMethod,
      cleaningConfidence: r.cleaningConfidence,
      supplierRaw: r.supplierRaw,
      supplierStatus: r.supplierStatus,
      packSizeDisplay: [r.caseQuantity, r.innerPackQuantity, r.baseUnit]
        .filter(v => v != null && v !== '')
        .join('/'),
      packParseStatus: r.packParseStatus,
      sourceCategory: r.sourceCategory,
      sourceGlCode: r.sourceGlCode,
      totalCost: r.totalCost,
      rowStatus: r.rowStatus,
    })),
  };
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerOrderlyImportRoutes(app: Express): void {
  /**
   * POST /api/inventory-import/orderly/preview
   *
   * Accepts multipart/form-data with field "file" (.xlsx/.xls, max 50 MB).
   *
   * Optional body fields (when handling a duplicate):
   *   action: "reprocess" | "force_new" | "cancel"
   *   reason: string  (required when action === "force_new")
   *
   * Fresh upload:
   *   Parses the workbook → stages batch + rows atomically → returns preview payload.
   *
   * action = "reprocess":
   *   1. Parse workbook (parse failure → 422, DB untouched).
   *   2. In ONE transaction: delete old batch+rows, then insert new batch+rows.
   *      If insert fails the delete is rolled back — old data is preserved.
   *
   * action = "force_new":
   *   Stage a new batch alongside the existing one. Requires `reason` field.
   *
   * action = "cancel":
   *   No-op response.
   */
  app.post(
    '/api/inventory-import/orderly/preview',
    requireAuth,
    requireTier('basic'),
    xlsxUpload.single('file'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).userId as string | null ?? null;

        if (!req.file) {
          return res.status(400).json({
            error: 'No file uploaded. Use multipart/form-data with field "file".',
          });
        }
        if (!companyId) {
          return res.status(400).json({ error: 'Company context required' });
        }

        const buffer = req.file.buffer;
        const filename = req.file.originalname;
        const fileHash = computeFileHash(buffer);
        const action = (req.body?.action as string | undefined)?.trim() ?? null;
        const reason = (req.body?.reason as string | undefined)?.trim() ?? null;

        // ── Validate known actions ────────────────────────────────────────
        const VALID_ACTIONS = new Set(['reprocess', 'force_new', 'cancel', null]);
        if (!VALID_ACTIONS.has(action)) {
          return res.status(400).json({
            error: `Unknown action "${action}". Valid values: reprocess, force_new, cancel`,
          });
        }

        // ── cancel ───────────────────────────────────────────────────────
        if (action === 'cancel') {
          return res.status(200).json({ cancelled: true });
        }

        // ── force_new ────────────────────────────────────────────────────
        if (action === 'force_new') {
          if (!reason || reason.length < 3) {
            return res.status(400).json({
              error: 'A non-blank reason (≥3 characters) is required for force_new',
            });
          }
          // Parse, then stage alongside any existing batch
          let parseResult: OrderlyParseResult;
          try {
            parseResult = parseOrderlyWorkbook(buffer, filename);
          } catch (err: any) {
            return res.status(422).json({ error: 'Failed to parse workbook', detail: err.message });
          }
          const batch = await db.transaction(async (tx) =>
            stageBatchInTransaction(tx, {
              companyId, userId, fileHash, filename, parseResult,
              forceNewBatchReason: reason,
            }),
          );
          return res.status(200).json(buildPreviewResponse(batch.id, parseResult));
        }

        // ── reprocess ────────────────────────────────────────────────────
        if (action === 'reprocess') {
          // Step 1: Parse outside any transaction — a parse failure leaves DB intact.
          let parseResult: OrderlyParseResult;
          try {
            parseResult = parseOrderlyWorkbook(buffer, filename);
          } catch (err: any) {
            return res.status(422).json({ error: 'Failed to parse workbook', detail: err.message });
          }

          // Step 2: Look up old batch id (outside tx — read-only).
          const existing = await db
            .select({ id: inventoryImportBatches.id })
            .from(inventoryImportBatches)
            .where(
              and(
                eq(inventoryImportBatches.companyId, companyId),
                eq(inventoryImportBatches.fileHash, fileHash),
                isNull(inventoryImportBatches.forceNewBatchReason),
              ),
            )
            .limit(1);
          const oldBatchId = existing[0]?.id ?? null;

          // Step 3: Atomic replace — delete old + insert new in ONE transaction.
          // If the new inserts fail, the delete is rolled back and old data survives.
          const batch = await db.transaction(async (tx) => {
            if (oldBatchId) {
              await tx.delete(inventoryImportRows)
                .where(eq(inventoryImportRows.batchId, oldBatchId));
              await tx.delete(inventoryImportBatches)
                .where(eq(inventoryImportBatches.id, oldBatchId));
            }
            return stageBatchInTransaction(tx, {
              companyId, userId, fileHash, filename, parseResult,
              forceNewBatchReason: null,
            });
          });

          return res.status(200).json(buildPreviewResponse(batch.id, parseResult));
        }

        // ── Fresh upload (no action) ──────────────────────────────────────
        // Idempotency check: block duplicate uploads for same company + hash.
        const existing = await db
          .select({
            id: inventoryImportBatches.id,
            status: inventoryImportBatches.status,
            uploadedAt: inventoryImportBatches.uploadedAt,
            parserVersion: inventoryImportBatches.parserVersion,
            inventoryDate: inventoryImportBatches.inventoryDate,
            sourceRowCount: inventoryImportBatches.sourceRowCount,
          })
          .from(inventoryImportBatches)
          .where(
            and(
              eq(inventoryImportBatches.companyId, companyId),
              eq(inventoryImportBatches.fileHash, fileHash),
              isNull(inventoryImportBatches.forceNewBatchReason),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          const b = existing[0];
          return res.status(200).json({
            duplicateWarning: true,
            existingBatch: {
              batchId: b.id,
              status: b.status,
              uploadedAt: b.uploadedAt,
              inventoryDate: b.inventoryDate,
              sourceRowCount: b.sourceRowCount,
              parserVersion: b.parserVersion,
            },
            options: [
              { action: 'view', label: 'View existing import' },
              {
                action: 'reprocess',
                label: 'Re-stage with current parser (atomically replaces existing rows)',
              },
              {
                action: 'force_new',
                label: 'Create a new batch alongside the existing one',
                requiresReason: true,
              },
              { action: 'cancel', label: 'Cancel' },
            ],
          });
        }

        // Parse and stage atomically
        let parseResult: OrderlyParseResult;
        try {
          parseResult = parseOrderlyWorkbook(buffer, filename);
        } catch (err: any) {
          return res.status(422).json({ error: 'Failed to parse workbook', detail: err.message });
        }

        const batch = await db.transaction(async (tx) =>
          stageBatchInTransaction(tx, {
            companyId, userId, fileHash, filename, parseResult,
          }),
        );

        return res.status(200).json(buildPreviewResponse(batch.id, parseResult));
      } catch (err: any) {
        console.error('[OrderlyImport] preview error:', err);
        res.status(500).json({ error: err.message });
      }
    },
  );

  /**
   * GET /api/inventory-import/orderly/batches
   * Lists all Orderly import batches for the authenticated company.
   */
  app.get(
    '/api/inventory-import/orderly/batches',
    requireAuth,
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const batches = await db
          .select()
          .from(inventoryImportBatches)
          .where(
            and(
              eq(inventoryImportBatches.companyId, companyId),
              eq(inventoryImportBatches.sourceSystem, 'ORDERLY'),
            ),
          )
          .orderBy(sql`${inventoryImportBatches.uploadedAt} DESC`);
        res.json(batches);
      } catch (err: any) {
        console.error('[OrderlyImport] batches list error:', err);
        res.status(500).json({ error: err.message });
      }
    },
  );

  /**
   * GET /api/inventory-import/orderly/batches/:batchId/resolution-preview
   *
   * Runs the 4-strategy matching algorithm against the company's existing
   * inventory items / vendors / locations and returns per-row decisions.
   * Pure read — no DB writes.
   */
  app.get(
    '/api/inventory-import/orderly/batches/:batchId/resolution-preview',
    requireAuth,
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const { batchId } = req.params;
        const preview = await runResolutionPreview(batchId, companyId);
        res.json(preview);
      } catch (err: any) {
        console.error('[OrderlyImport] resolution-preview error:', err);
        const status = err.message?.includes('not found') ? 404 : 500;
        res.status(status).json({ error: err.message });
      }
    },
  );

  /**
   * POST /api/inventory-import/orderly/batches/:batchId/approve
   *
   * Commits the import — creates/links items, vendors, vendor-items, locations,
   * and external mappings inside a single transaction.
   *
   * Body (optional):
   *   rowDecisions: RowDecision[]  — per-row overrides for ambiguous matches
   */
  app.post(
    '/api/inventory-import/orderly/batches/:batchId/approve',
    requireAuth,
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).userId as string | null ?? null;
        const { batchId } = req.params;
        const rowDecisions: RowDecision[] = req.body?.rowDecisions ?? [];

        const result = await applyBatchApproval(batchId, companyId, userId, rowDecisions);
        res.json(result);
      } catch (err: any) {
        console.error('[OrderlyImport] approve error:', err);
        const status =
          err.message?.includes('not found') ? 404
          : err.message?.includes('already been approved') ? 409
          : 500;
        res.status(status).json({ error: err.message });
      }
    },
  );

  /**
   * GET /api/inventory-import/orderly/batches/:batchId/count-session-preview
   *
   * Pre-conversion review before creating a historical count session.
   * Returns: included items, valuation, excluded rows, reconciliation delta,
   *          duplicate warnings, and May/June cross-reference discrepancies.
   *
   * Query params:
   *   tolerance: number (0–1 fraction, default 0.005 = 0.5%)
   */
  app.get(
    '/api/inventory-import/orderly/batches/:batchId/count-session-preview',
    requireAuth,
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const { batchId } = req.params;
        const tolerance = req.query.tolerance
          ? parseFloat(req.query.tolerance as string)
          : DEFAULT_RECONCILIATION_TOLERANCE;

        if (isNaN(tolerance) || tolerance < 0 || tolerance > 1) {
          return res.status(400).json({ error: 'tolerance must be a number between 0 and 1' });
        }

        const preview = await previewCountSession(batchId, companyId, { tolerance });
        res.json(preview);
      } catch (err: any) {
        console.error('[OrderlyImport] count-session-preview error:', err);
        const status =
          err.message?.includes('not found') ? 404
          : err.message?.includes('must be approved') ? 409
          : 500;
        res.status(status).json({ error: err.message });
      }
    },
  );

  /**
   * POST /api/inventory-import/orderly/batches/:batchId/create-count-session
   *
   * Creates a historical inventory count session from the approved batch.
   *
   * Body:
   *   storeId: string           — required; which store to attach the session to
   *   acknowledgedVariance?: boolean  — if true, proceed even if reconciliation > tolerance
   *   reconciliationTolerance?: number  — override tolerance (0–1 fraction)
   */
  app.post(
    '/api/inventory-import/orderly/batches/:batchId/create-count-session',
    requireAuth,
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).userId as string | null ?? null;
        const { batchId } = req.params;
        const { storeId, acknowledgedVariance, reconciliationTolerance } = req.body as {
          storeId?: string;
          acknowledgedVariance?: boolean;
          reconciliationTolerance?: number;
        };

        if (!storeId) {
          return res.status(400).json({ error: 'storeId is required' });
        }

        // Security: verify storeId belongs to the caller's company before insertion
        const [store] = await db
          .select({ id: companyStores.id })
          .from(companyStores)
          .where(
            and(
              eq(companyStores.id, storeId),
              eq(companyStores.companyId, companyId),
            ),
          )
          .limit(1);

        if (!store) {
          return res.status(403).json({
            error: 'Store not found or does not belong to your company',
          });
        }

        const result = await createCountSession({
          batchId,
          companyId,
          userId,
          storeId,
          acknowledgedVariance: acknowledgedVariance ?? false,
          reconciliationTolerance: reconciliationTolerance ?? DEFAULT_RECONCILIATION_TOLERANCE,
        });

        res.status(201).json(result);
      } catch (err: any) {
        console.error('[OrderlyImport] create-count-session error:', err);
        const status =
          err.message?.includes('not found') ? 404
          : err.message?.includes('must be approved') ? 409
          : err.message?.includes('variance') ? 422
          : err.message?.includes('No rows') ? 422
          : 500;
        res.status(status).json({ error: err.message });
      }
    },
  );

  /**
   * PATCH /api/inventory-import/orderly/batches/:batchId/confirm-date
   * Body: { inventoryDate: "YYYY-MM-DD" }
   */
  app.patch(
    '/api/inventory-import/orderly/batches/:batchId/confirm-date',
    requireAuth,
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const { batchId } = req.params;
        const { inventoryDate } = req.body as { inventoryDate?: string };

        if (!inventoryDate || !/^\d{4}-\d{2}-\d{2}$/.test(inventoryDate)) {
          return res.status(400).json({
            error: 'inventoryDate must be a YYYY-MM-DD string',
          });
        }

        const [updated] = await db
          .update(inventoryImportBatches)
          .set({ inventoryDate, inventoryDateConfirmed: 1 })
          .where(
            and(
              eq(inventoryImportBatches.id, batchId),
              eq(inventoryImportBatches.companyId, companyId),
            ),
          )
          .returning({ id: inventoryImportBatches.id });

        if (!updated) {
          return res.status(404).json({ error: 'Batch not found' });
        }

        res.json({ batchId, inventoryDate, confirmed: true });
      } catch (err: any) {
        console.error('[OrderlyImport] confirm-date error:', err);
        res.status(500).json({ error: err.message });
      }
    },
  );

}
// NOTE: The legacy conversion-preview and convert-to-count-session endpoints have been
// removed. Use count-session-preview and create-count-session instead (registered above).
