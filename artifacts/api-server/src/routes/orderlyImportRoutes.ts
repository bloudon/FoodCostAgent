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
import { canApproveOrderlyImport, getAccessibleStores } from '../permissions';
import { db } from '../db';
import { sql, eq, and, isNull, ne } from 'drizzle-orm';
import {
  inventoryImportBatches,
  inventoryImportRows,
  importSourcePropertyBindings,
  companyStores,
} from '@workspace/db';
import {
  parseOrderlyWorkbook,
  computeFileHash,
  ORDERLY_PARSER_VERSION,
  type OrderlyRow,
  type OrderlyParseResult,
} from '../services/orderly/OrderlyParser';
import {
  runResolutionPreview,
  getOrderlyReviewDecisions,
  exportOrderlyReviewDecisionManifest,
  importOrderlyReviewDecisionManifest,
  saveOrderlyReviewDecisionChanges,
  ImportApprovalError,
  authorizeOrderlyApprovalJobAccess,
} from '../services/orderly/orderlyDomain';
import {
  getReconciliationReport,
  reportToCsvRows,
} from '../services/orderly/orderlyReport';
import {
  claimApprovalJob,
  getApprovalJob,
  runApprovalJob,
} from '../services/orderly/orderlyApprovalJobs';

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

/**
 * Validate an inventory date string against the two-layer guard that the
 * confirm-date route applies before any DB write.
 *
 * Exported so it can be unit-tested directly without an HTTP layer or DB.
 *
 * Layer 1 — format: must match /^\d{4}-\d{2}-\d{2}$/
 * Layer 2 — plausibility: year 2000–2100; must be a real calendar day
 *   (e.g. 2026-02-30 overflows into March and is rejected via ISO round-trip).
 *
 * @returns `{ valid: true }` or `{ valid: false, reason: string }`.
 */
export function validateInventoryDateString(
  value: string | undefined,
): { valid: true } | { valid: false; reason: string } {
  // Layer 1: format
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { valid: false, reason: 'inventoryDate must be a YYYY-MM-DD string' };
  }

  // Layer 2: plausibility — parse at UTC midnight so the check is timezone-
  // independent; non-calendar dates overflow into the next month and the
  // ISO round-trip detects the mismatch.
  const parsedDate = new Date(`${value}T00:00:00Z`);
  const year = Number(value.slice(0, 4));
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== value ||
    year < 2000 ||
    year > 2100
  ) {
    return {
      valid: false,
      reason:
        'inventoryDate must be a real calendar date with a 4-digit year between 2000 and 2100',
    };
  }

  return { valid: true };
}

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
  // @ts-ignore
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    companyId: string;
    userId: string | null;
    fileHash: string;
    filename: string;
    parseResult: OrderlyParseResult;
    forceNewBatchReason?: string | null;
    targetStoreId?: string | null;
    sourcePropertyBindingId?: string | null;
    sourcePropertyId?: string | null;
  },
) {
  const {
    companyId, userId, fileHash, filename, parseResult, forceNewBatchReason, targetStoreId,
    sourcePropertyBindingId, sourcePropertyId,
  } = params;

  const [batch] = await tx
    // @ts-ignore
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
      sourcePropertyBindingId: sourcePropertyBindingId ?? null,
      sourcePropertyId: sourcePropertyId ?? null,
    })
    .returning();

  // Insert rows in chunks of 500 — all within the same transaction
  const CHUNK = 500;
  for (let i = 0; i < parseResult.rows.length; i += CHUNK) {
    const chunk = parseResult.rows.slice(i, i + CHUNK);
    // @ts-ignore
    await tx.insert(inventoryImportRows).values(
      chunk.map(r => rowInsertValues(r, batch.id, parseResult.sheetName)),
    );
  }

  return batch;
}

/** Map an authoritative approval failure onto an HTTP status code. */
function approvalErrorStatus(err: unknown): number {
  if (err instanceof ImportApprovalError) {
    switch (err.code) {
      case 'UNAUTHENTICATED': return 401;
      case 'FORBIDDEN':       return 403;
      case 'NOT_FOUND':       return 404;
      case 'CONFLICT':        return 409;
      case 'INVALID_REQUEST': return 400;
    }
  }
  return 500;
}

/** Only authoritative domain failures are safe and useful to return verbatim. */
function approvalErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ImportApprovalError ? err.message : fallback;
}

/** Route-level defense for the irreversible Orderly approval action. */
function requireOrderlyApprovalRole(req: any, res: any, next: any) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!canApproveOrderlyImport(user)) {
    return res.status(403).json({
      error: 'Only company admins and managers can approve Orderly imports.',
    });
  }
  return next();
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
      packSizeRaw: typeof r.rawData['Pack Size'] === 'string' && r.rawData['Pack Size'].trim()
        ? r.rawData['Pack Size']
        : null,
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
    // @ts-ignore
    requireTier('basic'),
    xlsxUpload.single('file'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).user?.id as string | null ?? null;

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
                  // @ts-ignore
                  eq(companyStores.companyId, companyId),
                  // @ts-ignore
                  eq(companyStores.status, 'active'),
                ),
              )
              // @ts-ignore
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

        // ── Resolve the approved source-property binding ─────────────────
        // When a company has adopted the source-property contract (migration
        // customers such as Bay Hill), the destination is governed by an
        // approved binding rather than by whatever store the client picked.
        // Companies with no bindings keep the existing behavior.
        const companyBindings = await db
          .select({
            id: importSourcePropertyBindings.id,
            sourcePropertyId: importSourcePropertyBindings.sourcePropertyId,
            destinationStoreId: importSourcePropertyBindings.destinationStoreId,
          })
          .from(importSourcePropertyBindings)
          .where(
            and(
              // @ts-ignore
              eq(importSourcePropertyBindings.companyId, companyId),
              // @ts-ignore
              eq(importSourcePropertyBindings.sourceSystem, 'ORDERLY'),
              // @ts-ignore
              eq(importSourcePropertyBindings.active, 1),
            ),
          );

        let sourcePropertyBindingId: string | null = null;
        let sourcePropertyId: string | null = null;

        if (companyBindings.length > 0) {
          type Binding = { id: string; sourcePropertyId: string; destinationStoreId: string };
          const bindings = companyBindings as Binding[];

          if (!targetStoreId && bindings.length === 1) {
            // Single approved destination — bind to it rather than staging
            // a catalog-only import.
            targetStoreId = bindings[0].destinationStoreId;
          }

          const binding = bindings.find(b => b.destinationStoreId === targetStoreId);
          if (!binding) {
            return res.status(403).json({
              error:
                'This company imports through approved source-property bindings. The selected store is not an approved import destination.',
            });
          }
          // The destination must still be one the acting user may write to.
          if (!accessibleStoreIds.includes(binding.destinationStoreId)) {
            return res.status(403).json({
              error: 'You do not have access to the approved destination store for this import.',
            });
          }
          sourcePropertyBindingId = binding.id;
          sourcePropertyId = binding.sourcePropertyId;
          targetStoreId = binding.destinationStoreId;
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
          // @ts-ignore
          const batch = await db.transaction(async (tx) =>
            // @ts-ignore
            stageBatchInTransaction(tx, {
              companyId, userId, fileHash, filename, parseResult,
              forceNewBatchReason: reason,
              targetStoreId,
              sourcePropertyBindingId,
              sourcePropertyId,
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
                // @ts-ignore
                eq(inventoryImportBatches.companyId, companyId),
                // @ts-ignore
                eq(inventoryImportBatches.fileHash, fileHash),
                // @ts-ignore
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
          // @ts-ignore
          const batch = await db.transaction(async (tx) => {
            if (oldBatchId) {
              await tx.delete(inventoryImportRows)
                // @ts-ignore
                .where(eq(inventoryImportRows.batchId, oldBatchId));
              await tx.delete(inventoryImportBatches)
                // @ts-ignore
                .where(eq(inventoryImportBatches.id, oldBatchId));
            }
            // @ts-ignore
            return stageBatchInTransaction(tx, {
              companyId, userId, fileHash, filename, parseResult,
              forceNewBatchReason: null,
              targetStoreId,
              sourcePropertyBindingId,
              sourcePropertyId,
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
              // @ts-ignore
              eq(inventoryImportBatches.companyId, companyId),
              // @ts-ignore
              eq(inventoryImportBatches.fileHash, fileHash),
              // @ts-ignore
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

        // @ts-ignore
        const batch = await db.transaction(async (tx) =>
          // @ts-ignore
          stageBatchInTransaction(tx, {
            companyId, userId, fileHash, filename, parseResult,
            targetStoreId,
            sourcePropertyBindingId,
            sourcePropertyId,
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
    // @ts-ignore
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const batches = await db
          .select()
          .from(inventoryImportBatches)
          .where(
            and(
              // @ts-ignore
              eq(inventoryImportBatches.companyId, companyId),
              // @ts-ignore
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
    // @ts-ignore
    requireTier('basic'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const { batchId } = req.params;
        // @ts-ignore
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
   * GET /api/inventory-import/orderly/batches/:batchId/review-decisions
   *
   * Returns the durable, pending-review decision draft. The matching preview
   * remains a read-only calculation; review choices are stored separately so
   * reloading the wizard never changes source rows or catalog data.
   */
  app.get(
    '/api/inventory-import/orderly/batches/:batchId/review-decisions',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).user?.id as string | null ?? null;
        const result = await getOrderlyReviewDecisions(
          String(req.params.batchId),
          { actingUserId: userId as string, companyId },
        );
        res.json(result);
      } catch (err: any) {
        console.error('[OrderlyImport] review decision load error:', err);
        res.status(approvalErrorStatus(err)).json({
          error: approvalErrorMessage(err, 'Saved review decisions could not be loaded. Please try again.'),
        });
      }
    },
  );

  /**
   * PUT /api/inventory-import/orderly/batches/:batchId/review-decisions
   *
   * Saves one or more reviewer choices atomically. Every change carries the
   * revision the browser read; a concurrent reviewer therefore gets a conflict
   * instead of silently overwriting another saved choice.
   */
  app.put(
    '/api/inventory-import/orderly/batches/:batchId/review-decisions',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).user?.id as string | null ?? null;
        const result = await saveOrderlyReviewDecisionChanges(
          String(req.params.batchId),
          { actingUserId: userId as string, companyId },
          req.body?.changes,
          { preserveExistingActions: req.body?.preserveExistingActions === true },
        );
        res.json(result);
      } catch (err: any) {
        console.error('[OrderlyImport] review decision save error:', err);
        res.status(approvalErrorStatus(err)).json({
          error: approvalErrorMessage(err, 'The review decision could not be saved. Please try again.'),
        });
      }
    },
  );

  /**
   * GET /api/inventory-import/orderly/batches/:batchId/review-decisions/manifest
   *
   * Produces a signed, batch-bound record of the current saved decisions and
   * the reviewer-facing evidence that supported them. It is never an approval
   * token: imports re-check the current preview and all decision rules.
   */
  app.get(
    '/api/inventory-import/orderly/batches/:batchId/review-decisions/manifest',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).user?.id as string | null ?? null;
        const manifest = await exportOrderlyReviewDecisionManifest(
          String(req.params.batchId),
          { actingUserId: userId as string, companyId },
        );
        res
          .type('application/json')
          .attachment(`orderly-review-decisions-${req.params.batchId}.json`)
          .send(manifest);
      } catch (err: any) {
        console.error('[OrderlyImport] review decision manifest export error:', err);
        res.status(approvalErrorStatus(err)).json({ error: err.message });
      }
    },
  );

  /**
   * POST /api/inventory-import/orderly/batches/:batchId/review-decisions/manifest
   *
   * Applies a signed manifest only to its original pending batch. The entire
   * manifest is rejected on stale, cross-scope, or invalid evidence; no partial
   * decision set is ever written.
   */
  app.post(
    '/api/inventory-import/orderly/batches/:batchId/review-decisions/manifest',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).user?.id as string | null ?? null;
        const result = await importOrderlyReviewDecisionManifest(
          String(req.params.batchId),
          { actingUserId: userId as string, companyId },
          req.body?.manifest ?? req.body,
        );
        const status = result.status === 'accepted' ? 200 : result.status === 'stale' ? 409 : 400;
        res.status(status).json(result);
      } catch (err: any) {
        console.error('[OrderlyImport] review decision manifest import error:', err);
        res.status(approvalErrorStatus(err)).json({ error: err.message });
      }
    },
  );

  /**
   * POST /api/inventory-import/orderly/batches/:batchId/approve
   *
   * Starts or resumes the one durable approval job for this batch.
   *
   * The endpoint returns 202 while work is running and 200 once completed.
   * Clients poll GET .../approval-job. The documented processing budget is
   * returned as timeoutBudgetMs (currently three minutes). Retrying the POST
   * reuses the same batch-scoped job and the apply path remains protected by
   * the batch row lock, so a lost/stalled response cannot double-apply writes.
   *
   * Body (optional):
   *   rowDecisions: RowDecision[]  — per-row overrides for ambiguous matches
   *   force: boolean               — skip the duplicate-date guard when true
   */
  app.post(
    '/api/inventory-import/orderly/batches/:batchId/approve',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    requireOrderlyApprovalRole,
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).user?.id as string | null ?? null;
        const { batchId } = req.params;
        // Authorize before even reading batch/date metadata. This prevents a
        // manager scoped to another store from probing batch existence or
        // receiving duplicate-date details for an inaccessible destination.
        await authorizeOrderlyApprovalJobAccess(
          String(batchId),
          { actingUserId: userId as string, companyId },
          { allowApproved: true },
        );
        // Review choices are written through the draft endpoint before this
        // irreversible operation. Refusing a client-supplied override means a
        // reload, stale tab, or forged request cannot swap the peer-reviewed
        // saved decision set at approval time.
        if (Array.isArray(req.body?.rowDecisions) && req.body.rowDecisions.length > 0) {
          return res.status(400).json({
            error: 'Review decisions must be saved to the batch before approval.',
          });
        }
        const force: boolean = req.body?.force === true;

        // Destination binding is NOT accepted from the client. The shared
        // approval service resolves and validates the destination itself from
        // the persisted source-property binding, so a request cannot redirect
        // an approved batch to a different store.

        // Read-only: needed for the duplicate-date guard below. All
        // authorization and destination checks are performed authoritatively
        // inside applyBatchApproval.
        const [currentBatch] = await db
          .select({
            id: inventoryImportBatches.id,
            inventoryDate: inventoryImportBatches.inventoryDate,
          })
          .from(inventoryImportBatches)
          .where(
            and(
              // @ts-ignore
              eq(inventoryImportBatches.id, batchId),
              // @ts-ignore
              eq(inventoryImportBatches.companyId, companyId),
            ),
          )
          .limit(1);

        if (!currentBatch) {
          return res.status(404).json({ error: 'Batch not found' });
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
                // @ts-ignore
                eq(inventoryImportBatches.companyId, companyId),
                // @ts-ignore
                eq(inventoryImportBatches.inventoryDate, currentBatch.inventoryDate),
                // @ts-ignore
                eq(inventoryImportBatches.status, 'approved'),
                // @ts-ignore
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

        const claimed = await claimApprovalJob(String(batchId), companyId, userId as string, {
          forceDuplicateDate: force,
        });
        if (claimed.shouldRun) {
          setImmediate(() => {
            void runApprovalJob(
              claimed.job.jobId,
              String(batchId),
              companyId,
              userId as string,
              claimed.job.attemptCount,
              force,
            );
          });
        }
        res.status(claimed.job.status === 'completed' ? 200 : 202).json(claimed.job);
      } catch (err: any) {
        console.error('[OrderlyImport] approve error:', err);
        res.status(approvalErrorStatus(err)).json({ error: err.message });
      }
    },
  );

  app.get(
    '/api/inventory-import/orderly/batches/:batchId/approval-job',
    requireAuth,
    // @ts-ignore
    requireTier('basic'),
    requireOrderlyApprovalRole,
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).user?.id as string;
        await authorizeOrderlyApprovalJobAccess(
          String(req.params.batchId),
          { actingUserId: userId, companyId },
          { allowApproved: true },
        );
        const job = await getApprovalJob(String(req.params.batchId), companyId);
        if (!job) return res.status(404).json({ error: 'Approval job not found' });
        res.json(job);
      } catch (err: any) {
        res.status(approvalErrorStatus(err)).json({ error: err.message });
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
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const { batchId } = req.params;

        const [batch] = await db
          .select({ id: inventoryImportBatches.id, status: inventoryImportBatches.status })
          .from(inventoryImportBatches)
          .where(
            and(
              // @ts-ignore
              eq(inventoryImportBatches.id, batchId),
              // @ts-ignore
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
          // @ts-ignore
          .where(eq(inventoryImportRows.batchId, batchId));
        await db.delete(inventoryImportBatches)
          // @ts-ignore
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
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
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

        // @ts-ignore
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
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId = (req as any).user?.id as string | null ?? null;
        const { batchId } = req.params;
        const { storeId, acknowledgedVariance, reconciliationTolerance } = req.body as {
          storeId?: string;
          acknowledgedVariance?: boolean;
          reconciliationTolerance?: number;
        };

        if (!storeId) {
          return res.status(400).json({ error: 'storeId is required' });
        }

        // Security: verify storeId is accessible to the acting user.
        // getAccessibleStores already scopes by company, so this check subsumes
        // the previous bare company-membership guard and adds user-level isolation.
        const accessibleStoreIds = await getAccessibleStores((req as any).user, companyId);
        if (!accessibleStoreIds.includes(storeId)) {
          return res.status(403).json({
            error: 'Store not found or is not accessible to you.',
          });
        }

        const result = await createCountSession({
          // @ts-ignore
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
          : err.code === 'BATCH_STORE_MISMATCH' ? 409
          : err.message?.includes('must be approved') ? 409
          : err.message?.includes('variance') ? 422
          : err.message?.includes('No rows') ? 422
          : 500;
        res.status(status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
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
    // @ts-ignore
    requireTier('basic'),
    // @ts-ignore
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const { batchId } = req.params;
        const { inventoryDate } = req.body as { inventoryDate?: string };

        const dateValidation = validateInventoryDateString(inventoryDate);
        if (!dateValidation.valid) {
          return res.status(400).json({ error: dateValidation.reason });
        }

        const [updated] = await db
          .update(inventoryImportBatches)
          .set({ inventoryDate, inventoryDateConfirmed: 1 })
          .where(
            and(
              // @ts-ignore
              eq(inventoryImportBatches.id, batchId),
              // @ts-ignore
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
              // @ts-ignore
              eq(inventoryImportBatches.companyId, companyId),
              // @ts-ignore
              eq(inventoryImportBatches.inventoryDate, inventoryDate),
              // @ts-ignore
              eq(inventoryImportBatches.status, 'approved'),
              // @ts-ignore
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
    // @ts-ignore
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
    // @ts-ignore
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
