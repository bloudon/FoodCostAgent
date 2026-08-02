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
import { getAccessibleStores } from '../permissions';
import { db } from '../db';
import { sql, eq, and, isNull, ne } from 'drizzle-orm';
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
import {
  getReconciliationReport,
  reportToCsvRows,
} from '../services/orderly/orderlyReport';

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
    targetStoreId?: string | null;
  },
) {
  const { companyId, userId, fileHash, filename, parseResult, forceNewBatchReason, targetStoreId } = params;

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
      targetStoreId: targetStoreId ?? null,
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
        const requestedStoreId = (req.body?.storeId as string | undefined)?.trim() ?? null;

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

        // ── Resolve target store ──────────────────────────────────────────
        // Bind the store at upload time so preview, matching, and approval all
        // operate in the same store context.
        // Use getAccessibleStores so users can only target stores they are authorised for.
        const user = (req as any).user;
        const accessibleStoreIds = await getAccessibleStores(user, companyId);

        // Fetch names only for accessible stores (needed for requiresStoreSelection response).
        const accessibleStores = accessibleStoreIds.length > 0
          ? await db
              .select({ id: companyStores.id, name: companyStores.name })
              .from(companyStores)
              .where(
                and(
                  eq(companyStores.companyId, companyId),
                  eq(companyStores.status, 'active'),
                ),
              )
              .then(rows => rows.filter(r => accessibleStoreIds.includes(r.id)))
          : [];

        let targetStoreId: string | null = null;

        if (accessibleStores.length === 0) {
          // No accessible stores — proceed as catalog-only import
          targetStoreId = null;
        } else if (accessibleStores.length === 1) {
          // Single accessible store: auto-resolve; ignore any storeId the client sent
          targetStoreId = accessibleStores[0].id;
        } else {
          // Multiple accessible stores: client must supply a valid storeId
          if (!requestedStoreId) {
            return res.status(400).json({
              error: 'This company has multiple stores. Select a target store before uploading.',
              requiresStoreSelection: true,
              stores: accessibleStores.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })),
            });
          }
          const match = accessibleStores.find((s: { id: string; name: string }) => s.id === requestedStoreId);
          if (!match) {
            return res.status(403).json({
              error: 'The selected store was not found or is not accessible to you.',
            });
          }
          targetStoreId = match.id;
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
              targetStoreId,
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
            .select({ id: inventoryImportBatches.id, status: inventoryImportBatches.status })
            .from(inventoryImportBatches)
            .where(
              and(
                eq(inventoryImportBatches.companyId, companyId),
                eq(inventoryImportBatches.fileHash, fileHash),
                isNull(inventoryImportBatches.forceNewBatchReason),
              ),
            )
            .limit(1);
          const oldBatch = existing[0] ?? null;
          const oldBatchId = oldBatch?.id ?? null;

          // Guard: never delete an approved batch — its history and downstream
          // duplicate-date checks depend on it remaining in place.
          if (oldBatch?.status === 'approved') {
            return res.status(409).json({
              error: 'Cannot reprocess an approved batch. Use force_new to create a parallel import.',
            });
          }

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
              targetStoreId,
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
            targetStoreId: inventoryImportBatches.targetStoreId,
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
          // Detect store mismatch: the same file was previously staged for a different store.
          const storeMismatch = !!targetStoreId && !!b.targetStoreId && targetStoreId !== b.targetStoreId;
          return res.status(200).json({
            duplicateWarning: true,
            storeMismatch,
            existingBatch: {
              batchId: b.id,
              status: b.status,
              uploadedAt: b.uploadedAt,
              inventoryDate: b.inventoryDate,
              sourceRowCount: b.sourceRowCount,
              parserVersion: b.parserVersion,
              targetStoreId: b.targetStoreId,
            },
            options: [
              // 'view' is only valid when the store matches — client should hide it on mismatch.
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
            targetStoreId,
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
   *   force: boolean               — skip the duplicate-date guard when true
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
        const force: boolean = req.body?.force === true;
        // Optional: caller may supply a storeId to assign a store to a legacy batch
        // that was created before target_store_id was persisted at upload time.
        const overrideStoreId = (req.body?.storeId as string | undefined)?.trim() ?? null;

        // Look up the current batch to get its inventoryDate and targetStoreId.
        const [currentBatch] = await db
          .select({
            id: inventoryImportBatches.id,
            inventoryDate: inventoryImportBatches.inventoryDate,
            targetStoreId: inventoryImportBatches.targetStoreId,
          })
          .from(inventoryImportBatches)
          .where(
            and(
              eq(inventoryImportBatches.id, batchId),
              eq(inventoryImportBatches.companyId, companyId),
            ),
          )
          .limit(1);

        if (!currentBatch) {
          return res.status(404).json({ error: 'Batch not found' });
        }

        // Resolve accessible stores once — used for both existing and null targetStoreId paths.
        const accessibleStoreIds = await getAccessibleStores((req as any).user, companyId);

        if (currentBatch.targetStoreId) {
          // Guard: the batch's target store must still be accessible to the approving user.
          if (!accessibleStoreIds.includes(currentBatch.targetStoreId)) {
            return res.status(403).json({ error: 'You do not have access to the store this batch targets.' });
          }
        } else {
          // Legacy batch: target_store_id was not set at upload time.
          // Auto-resolve for single accessible store; require selection otherwise.
          if (accessibleStoreIds.length > 1) {
            if (!overrideStoreId) {
              // Return accessible stores so the UI can show a selector.
              const storeNames = await db
                .select({ id: companyStores.id, name: companyStores.name })
                .from(companyStores)
                .where(
                  and(
                    eq(companyStores.companyId, companyId),
                    eq(companyStores.status, 'active'),
                  ),
                )
                .then(rows => rows.filter(r => accessibleStoreIds.includes(r.id)));
              return res.status(400).json({
                error: 'This import was created before store selection was required. Choose a store to continue.',
                requiresStoreSelection: true,
                stores: storeNames,
              });
            }
            // Validate the supplied override store.
            if (!accessibleStoreIds.includes(overrideStoreId)) {
              return res.status(403).json({ error: 'The selected store is not accessible to you.' });
            }
            // Write the resolved storeId onto the batch so applyBatchApproval picks it up.
            await db
              .update(inventoryImportBatches)
              .set({ targetStoreId: overrideStoreId })
              .where(eq(inventoryImportBatches.id, batchId));
          }
          // Single accessible store: persist it now so applyBatchApproval doesn't need to
          // re-resolve from all company stores (which would throw for scoped multi-store users).
          if (accessibleStoreIds.length === 1) {
            await db
              .update(inventoryImportBatches)
              .set({ targetStoreId: accessibleStoreIds[0] })
              .where(eq(inventoryImportBatches.id, batchId));
          }
          // Zero accessible stores: proceed without store linkage (catalog-only).
        }

        // Guard: check for another already-approved batch with the same inventory date.
        if (!force && currentBatch.inventoryDate) {
          const [prior] = await db
            .select({
              id: inventoryImportBatches.id,
              inventoryDate: inventoryImportBatches.inventoryDate,
              approvedAt: inventoryImportBatches.approvedAt,
            })
            .from(inventoryImportBatches)
            .where(
              and(
                eq(inventoryImportBatches.companyId, companyId),
                eq(inventoryImportBatches.inventoryDate, currentBatch.inventoryDate),
                eq(inventoryImportBatches.status, 'approved'),
                ne(inventoryImportBatches.id, batchId),
              ),
            )
            .limit(1);

          if (prior) {
            return res.status(409).json({
              error: 'duplicate_date',
              duplicateDateWarning: {
                inventoryDate: prior.inventoryDate,
                approvedAt: prior.approvedAt,
                priorBatchId: prior.id,
              },
            });
          }
        }

        const result = await applyBatchApproval(batchId, companyId, userId, rowDecisions);
        res.json(result);
      } catch (err: any) {
        console.error('[OrderlyImport] approve error:', err);
        const status =
          err.message?.includes('not found') ? 404
          : err.message?.includes('already been approved') ? 409
          : err.message?.includes('multiple stores') || err.message?.includes('target store') ? 400
          : 500;
        res.status(status).json({ error: err.message });
      }
    },
  );

  /**
   * DELETE /api/inventory-import/orderly/batches/:batchId
   *
   * Permanently removes a pending-review batch and all its rows.
   * Returns 409 if the batch has already been approved — approved data is never deleted.
   */
  app.delete(
    '/api/inventory-import/orderly/batches/:batchId',
    requireAuth,
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const { batchId } = req.params;

        const [batch] = await db
          .select({ id: inventoryImportBatches.id, status: inventoryImportBatches.status })
          .from(inventoryImportBatches)
          .where(
            and(
              eq(inventoryImportBatches.id, batchId),
              eq(inventoryImportBatches.companyId, companyId),
            ),
          )
          .limit(1);

        if (!batch) {
          return res.status(404).json({ error: 'Batch not found' });
        }
        if (batch.status === 'approved') {
          return res.status(409).json({ error: 'Approved batches cannot be discarded' });
        }

        // Two sequential deletes — no transaction needed.
        // Rows first so the batch is never left with orphaned rows.
        // If the batch delete fails after rows are gone, re-discarding is safe (no-op rows delete, batch deleted).
        await db.delete(inventoryImportRows)
          .where(eq(inventoryImportRows.batchId, batchId));
        await db.delete(inventoryImportBatches)
          .where(eq(inventoryImportBatches.id, batchId));

        res.json({ deleted: true });
      } catch (err: any) {
        console.error('[OrderlyImport] discard error:', err);
        res.status(500).json({ error: err.message });
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
   *
   * Returns: { batchId, inventoryDate, confirmed, duplicateDateWarning? }
   * duplicateDateWarning is set when another approved batch for this
   * company + inventoryDate already exists, so the UI can warn the user
   * before they advance to the 5,000-row review step.
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

        // Warn if another approved batch already covers this date.
        const [prior] = await db
          .select({
            id: inventoryImportBatches.id,
            inventoryDate: inventoryImportBatches.inventoryDate,
            approvedAt: inventoryImportBatches.approvedAt,
          })
          .from(inventoryImportBatches)
          .where(
            and(
              eq(inventoryImportBatches.companyId, companyId),
              eq(inventoryImportBatches.inventoryDate, inventoryDate),
              eq(inventoryImportBatches.status, 'approved'),
              ne(inventoryImportBatches.id, batchId),
            ),
          )
          .limit(1);

        const response: Record<string, unknown> = { batchId, inventoryDate, confirmed: true };
        if (prior) {
          response.duplicateDateWarning = {
            inventoryDate: prior.inventoryDate,
            approvedAt: prior.approvedAt,
            priorBatchId: prior.id,
          };
        }

        res.json(response);
      } catch (err: any) {
        console.error('[OrderlyImport] confirm-date error:', err);
        res.status(500).json({ error: err.message });
      }
    },
  );

  /**
   * GET /api/inventory-import/orderly/report
   * Returns the full reconciliation report for all approved Orderly batches.
   */
  app.get(
    '/api/inventory-import/orderly/report',
    requireAuth,
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const report = await getReconciliationReport(companyId);
        res.json(report);
      } catch (err: any) {
        console.error('[OrderlyImport] report error:', err);
        res.status(500).json({ error: err.message });
      }
    },
  );

  /**
   * GET /api/inventory-import/orderly/report/export/csv
   * Returns the full report as a downloadable CSV file.
   */
  app.get(
    '/api/inventory-import/orderly/report/export/csv',
    requireAuth,
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const report = await getReconciliationReport(companyId);
        const csv = reportToCsvRows(report);
        const filename = `orderly-reconciliation-report-${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
      } catch (err: any) {
        console.error('[OrderlyImport] report CSV export error:', err);
        res.status(500).json({ error: err.message });
      }
    },
  );

}
// NOTE: The legacy conversion-preview and convert-to-count-session endpoints have been
// removed. Use count-session-preview and create-count-session instead (registered above).
