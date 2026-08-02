/**
 * Sales-by-Item Import Routes
 *
 * POST /api/imports/sales-by-item/preview
 *   Accept xlsx, parse it, return a dry-run preview (no DB writes).
 *
 * POST /api/imports/sales-by-item/approve
 *   Accept xlsx + optional storeId, parse and write in a transaction:
 *     1. sales_upload_batches  — import batch record
 *     2. inventory_locations   — outlet type, find-or-create
 *     3. menu_departments      — find-or-create by name
 *     4. menu_items            — find-or-create by pluSku (Quick Access Code)
 *     5. store_menu_items      — link each menu item to the store
 *     6. daily_menu_item_sales — aggregate row per item for the report period
 */

import type { Express } from 'express';
import multer from 'multer';
import { requireAuth, requireTier } from '../auth';
import { getAccessibleStores } from '../permissions';
import { db } from '../db';
import { sql, eq, and } from 'drizzle-orm';
import type { User } from '@shared/schema';
import {
  companyStores,
  inventoryLocations,
  menuDepartments,
  menuItems,
  storeMenuItems,
  salesUploadBatches,
  dailyMenuItemSales,
} from '@shared/schema';
import {
  parseSalesByItemWorkbook,
  type SalesByItemParseResult,
} from '../services/salesByItem/SalesByItemParser';

// ─── Multer ───────────────────────────────────────────────────────────────────

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

interface StoreInfo {
  id: string;
  name: string;
}

/** Resolve which store to use — same logic as Orderly import. */
async function resolveTargetStore(
  user: User | undefined,
  companyId: string,
  requestedStoreId?: string | null,
): Promise<{ storeId: string | null; requiresSelection: boolean; stores?: StoreInfo[] }> {
  const accessibleStoreIds = await getAccessibleStores(user as User, companyId);

  const accessibleStores: StoreInfo[] = accessibleStoreIds.length > 0
    ? await db
        .select({ id: companyStores.id, name: companyStores.name })
        .from(companyStores)
        .where(
          and(
            eq(companyStores.companyId, companyId),
            eq(companyStores.status, 'active'),
          ),
        )
        .then((rows: { id: string; name: string }[]) =>
          rows.filter((r) => accessibleStoreIds.includes(r.id)),
        )
    : [];

  if (accessibleStores.length === 0) return { storeId: null, requiresSelection: false };
  if (accessibleStores.length === 1) return { storeId: accessibleStores[0].id, requiresSelection: false };

  if (!requestedStoreId) {
    return {
      storeId: null,
      requiresSelection: true,
      stores: accessibleStores.map((s) => ({ id: s.id, name: s.name })),
    };
  }
  const match = accessibleStores.find((s) => s.id === requestedStoreId);
  if (!match) {
    return {
      storeId: null,
      requiresSelection: true,
      stores: accessibleStores.map((s) => ({ id: s.id, name: s.name })),
    };
  }
  return { storeId: match.id, requiresSelection: false };
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerSalesByItemRoutes(app: Express): void {
  // ── Preview ──────────────────────────────────────────────────────────────────
  app.post(
    '/api/imports/sales-by-item/preview',
    requireAuth,
    requireTier('platform'),
    xlsxUpload.single('file'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field "file".' });
        }

        let parsed: SalesByItemParseResult;
        try {
          parsed = parseSalesByItemWorkbook(req.file.buffer, req.file.originalname);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return res.status(422).json({ error: 'Failed to parse workbook', detail: msg });
        }

        if (parsed.rows.length === 0) {
          return res.status(422).json({ error: 'No sales items found. Is this a Sales by Item report?' });
        }

        return res.json({
          reportStart: parsed.reportStart,
          reportEnd: parsed.reportEnd,
          salesAreas: parsed.salesAreas,
          outletCounts: parsed.outletCounts,
          categoryCounts: parsed.categoryCounts,
          totalItems: parsed.rows.length,
          totalQty: parsed.totalQty,
          totalNet: parsed.totalNet,
          uniqueOutlets: Object.keys(parsed.outletCounts).length,
          uniqueCategories: Object.keys(parsed.categoryCounts).length,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[SalesByItemImport] preview error:', err);
        return res.status(500).json({ error: msg });
      }
    },
  );

  // ── Approve ──────────────────────────────────────────────────────────────────
  app.post(
    '/api/imports/sales-by-item/approve',
    requireAuth,
    requireTier('platform'),
    xlsxUpload.single('file'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        const userId    = (req as any).userId as string | null ?? null;

        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded.' });
        }
        if (!companyId) {
          return res.status(400).json({ error: 'Company context required.' });
        }

        // Parse workbook outside the transaction
        let parsed: SalesByItemParseResult;
        try {
          parsed = parseSalesByItemWorkbook(req.file.buffer, req.file.originalname);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return res.status(422).json({ error: 'Failed to parse workbook', detail: msg });
        }

        if (parsed.rows.length === 0) {
          return res.status(422).json({ error: 'No sales items found.' });
        }

        // Resolve store
        const requestedStoreId = (req.body?.storeId as string | undefined)?.trim() ?? null;
        const storeResult = await resolveTargetStore((req as any).user as User | undefined, companyId, requestedStoreId);
        if (storeResult.requiresSelection) {
          return res.status(400).json({
            error: 'Multiple stores found. Select a target store before approving.',
            requiresStoreSelection: true,
            stores: storeResult.stores,
          });
        }
        const storeId = storeResult.storeId;

        // ── Transaction writes ────────────────────────────────────────────────
        const result = await db.transaction(async (tx: typeof db) => {
          const stats = {
            outletsCreated: 0,
            outletsLinked: 0,
            departmentsCreated: 0,
            departmentsLinked: 0,
            itemsCreated: 0,
            itemsLinked: 0,
            storeItemsCreated: 0,
            salesRowsInserted: 0,
          };

          // 1. Create the upload batch record (required FK for daily_menu_item_sales)
          let batchId: string | null = null;
          if (storeId && userId) {
            const [batch] = await tx
              .insert(salesUploadBatches)
              .values({
                companyId,
                storeId,
                uploadedBy: userId,
                fileName: req.file!.originalname,
                salesDate: new Date(parsed.reportStart + 'T00:00:00'),
                status: 'completed',
                rowsProcessed: parsed.rows.length,
                rowsFailed: 0,
              })
              .returning({ id: salesUploadBatches.id });
            batchId = batch.id;
          }

          // 2. Find-or-create inventory_locations (outlet type) for each unique outlet
          const uniqueOutlets = Array.from(new Set(parsed.rows.map((r) => r.outlet)));
          const outletIdMap = new Map<string, string>(); // outlet name → location id

          for (const outletName of uniqueOutlets) {
            const normalizedName = outletName.toLowerCase().trim();
            const [existing] = await tx
              .select({ id: inventoryLocations.id })
              .from(inventoryLocations)
              .where(
                and(
                  eq(inventoryLocations.companyId, companyId),
                  eq(inventoryLocations.normalizedName, normalizedName),
                  eq(inventoryLocations.active, 1),
                ),
              )
              .limit(1);

            if (existing) {
              outletIdMap.set(outletName, existing.id);
              stats.outletsLinked++;
            } else {
              const [created] = await tx
                .insert(inventoryLocations)
                .values({
                  companyId,
                  name: outletName,
                  normalizedName,
                  locationType: 'outlet',
                  sourceSystem: 'SALES_BY_ITEM',
                  active: 1,
                })
                .returning({ id: inventoryLocations.id });
              outletIdMap.set(outletName, created.id);
              stats.outletsCreated++;
            }
          }

          // 3. Find-or-create menu_departments for each unique category
          const uniqueCategories = Array.from(new Set(parsed.rows.map((r) => r.category)));
          const deptIdMap = new Map<string, string>(); // category name → dept id

          for (const catName of uniqueCategories) {
            const normCat = catName.toLowerCase().trim();
            const [existing] = await tx
              .select({ id: menuDepartments.id })
              .from(menuDepartments)
              .where(
                and(
                  eq(menuDepartments.companyId, companyId),
                  sql`lower(${menuDepartments.name}) = ${normCat}`,
                ),
              )
              .limit(1);

            if (existing) {
              deptIdMap.set(catName, existing.id);
              stats.departmentsLinked++;
            } else {
              const [created] = await tx
                .insert(menuDepartments)
                .values({ companyId, name: catName, sortOrder: 0 })
                .returning({ id: menuDepartments.id });
              deptIdMap.set(catName, created.id);
              stats.departmentsCreated++;
            }
          }

          // 4. Find-or-create menu_items by pluSku (Quick Access Code)
          const menuItemIdMap = new Map<string, string>(); // QAC → menu item id

          // Fetch all existing menu items for this company in one shot
          const existingItems: { id: string; pluSku: string | null }[] = await tx
            .select({ id: menuItems.id, pluSku: menuItems.pluSku })
            .from(menuItems)
            .where(eq(menuItems.companyId, companyId));
          const existingByCode = new Map(
            existingItems
              .filter((i): i is { id: string; pluSku: string } => i.pluSku !== null)
              .map((i): [string, string] => [i.pluSku, i.id]),
          );

          type NewItemValue = {
            companyId: string;
            name: string;
            pluSku: string;
            menuDepartmentId: string | null;
            active: number;
            isRecipeItem: number;
            sortOrder: number;
          };
          const newItemValues: NewItemValue[] = [];

          // Deduplicate rows by QAC (first occurrence wins)
          const seenCodes = new Set<string>();
          for (const row of parsed.rows) {
            if (seenCodes.has(row.code)) continue;
            seenCodes.add(row.code);

            const existingId = existingByCode.get(row.code);
            if (existingId) {
              menuItemIdMap.set(row.code, existingId);
              stats.itemsLinked++;
            } else {
              newItemValues.push({
                companyId,
                name: row.description,
                pluSku: row.code,
                menuDepartmentId: deptIdMap.get(row.category) ?? null,
                active: 1,
                isRecipeItem: 1,
                sortOrder: 0,
              });
            }
          }

          // Batch insert new items in chunks of 200
          const CHUNK = 200;
          for (let i = 0; i < newItemValues.length; i += CHUNK) {
            const chunk = newItemValues.slice(i, i + CHUNK);
            const inserted = await tx
              .insert(menuItems)
              .values(chunk)
              .onConflictDoNothing()
              .returning({ id: menuItems.id, pluSku: menuItems.pluSku });
            for (const item of inserted) {
              menuItemIdMap.set(item.pluSku!, item.id);
              stats.itemsCreated++;
            }
          }

          // 5. Find-or-create store_menu_items linking each menu item to the store
          if (storeId) {
            const menuItemIds = Array.from(menuItemIdMap.values());
            // Fetch existing store_menu_items for this store in bulk
            let existingStoreItems: { menuItemId: string | null }[] = [];
            if (menuItemIds.length > 0) {
              existingStoreItems = await tx
                .select({ menuItemId: storeMenuItems.menuItemId })
                .from(storeMenuItems)
                .where(
                  and(
                    eq(storeMenuItems.storeId, storeId),
                    sql`${storeMenuItems.menuItemId} = ANY(ARRAY[${sql.join(
                      menuItemIds.map((id) => sql`${id}::text`),
                      sql`, `,
                    )}])`,
                  ),
                );
            }
            const linkedSet = new Set(
              existingStoreItems.map((s) => s.menuItemId).filter((id): id is string => id !== null),
            );

            const toLink = menuItemIds.filter((id) => !linkedSet.has(id));
            for (let i = 0; i < toLink.length; i += CHUNK) {
              const chunk = toLink.slice(i, i + CHUNK);
              await tx
                .insert(storeMenuItems)
                .values(
                  chunk.map((menuItemId) => ({
                    companyId,
                    storeId,
                    menuItemId,
                    active: 1,
                  })),
                )
                .onConflictDoNothing();
              stats.storeItemsCreated += chunk.length;
            }
          }

          // 6. Insert daily_menu_item_sales — one aggregate row per item per batch
          if (batchId && storeId) {
            // Group rows by QAC — aggregate qty + net if same code appears multiple times
            const aggMap = new Map<string, { qty: number; net: number }>();
            for (const row of parsed.rows) {
              const existing = aggMap.get(row.code) ?? { qty: 0, net: 0 };
              aggMap.set(row.code, {
                qty: existing.qty + row.qty,
                net: existing.net + row.netAmount,
              });
            }

            const salesDate = new Date(parsed.reportStart + 'T00:00:00');
            type SalesRow = {
              companyId: string;
              storeId: string;
              menuItemId: string;
              salesDate: Date;
              qtySold: number;
              netSales: number;
              sourceBatchId: string;
            };
            const salesRows: SalesRow[] = [];

            for (const [code, agg] of Array.from(aggMap.entries())) {
              const menuItemId = menuItemIdMap.get(code);
              if (!menuItemId) continue;
              salesRows.push({
                companyId,
                storeId,
                menuItemId,
                salesDate,
                qtySold: agg.qty,
                netSales: agg.net,
                sourceBatchId: batchId,
              });
            }

            for (let i = 0; i < salesRows.length; i += CHUNK) {
              const chunk = salesRows.slice(i, i + CHUNK);
              await tx
                .insert(dailyMenuItemSales)
                .values(chunk)
                .onConflictDoNothing();
            }
            stats.salesRowsInserted = salesRows.length;
          }

          return stats;
        });

        return res.json({
          success: true,
          reportStart: parsed.reportStart,
          reportEnd: parsed.reportEnd,
          ...result,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[SalesByItemImport] approve error:', err);
        return res.status(500).json({ error: msg });
      }
    },
  );
}
