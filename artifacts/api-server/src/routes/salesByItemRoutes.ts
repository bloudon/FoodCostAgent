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
import { sql, eq, and, isNull } from 'drizzle-orm';
import type { User } from '@workspace/db';
import {
  companyStores,
  inventoryLocations,
  menuDepartments,
  menuItems,
  storeMenuItems,
  salesUploadBatches,
  dailyMenuItemSales,
  recipes,
} from '@workspace/db';

// ─── Fuzzy Matching ──────────────────────────────────────────────────────────

/**
 * Normalise a string for comparison: lowercase, strip non-alphanumeric, collapse spaces.
 */
function normaliseText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Tokenise the normalised string into a Set of words, removing common
 * stop-words that add noise (with, the, a, an, and, or, of, &).
 */
function tokenise(s: string): Set<string> {
  const stop = new Set(['with', 'the', 'a', 'an', 'and', 'or', 'of', '&', 'in', 'on', 'at']);
  return new Set(
    normaliseText(s)
      .split(' ')
      .filter((t) => t.length > 1 && !stop.has(t)),
  );
}

/**
 * Jaccard similarity between two token sets, boosted when one name is a
 * prefix-substring of the other (catches "Bacon Cheeseburger" → "Bacon CheeseBurger 8oz").
 */
function fuzzyScore(a: string, b: string): number {
  const ta = tokenise(a);
  const tb = tokenise(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  ta.forEach((t) => { if (tb.has(t)) intersection++; });
  const jaccard = intersection / (ta.size + tb.size - intersection);

  // Substring boost: if one normalised name contains the other
  const na = normaliseText(a);
  const nb = normaliseText(b);
  const substringBoost = (na.includes(nb) || nb.includes(na)) ? 0.15 : 0;

  return Math.min(1, jaccard + substringBoost);
}

/** Return top-N recipe suggestions for a menu item name. */
function suggestRecipes(
  itemName: string,
  allRecipes: Array<{ id: string; name: string; computedCost: number }>,
  topN = 3,
): Array<{ recipeId: string; recipeName: string; score: number; computedCost: number }> {
  return allRecipes
    .map((r) => ({ recipeId: r.id, recipeName: r.name, score: fuzzyScore(itemName, r.name), computedCost: r.computedCost }))
    .filter((r) => r.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
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
            // @ts-ignore
            eq(companyStores.companyId, companyId),
            // @ts-ignore
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

        if (parsed.unrecognizedPrefixCategories.length > 0) {
          console.warn(
            '[SalesByItemImport] preview: %d unrecognised QAC prefix(es) routed to "Unassigned": %s',
            parsed.unrecognizedPrefixCategories.length,
            parsed.unrecognizedPrefixCategories.join(', '),
          );
        }

        // Check which outlet names already exist as operating_unit records so the
        // preview UI can show "Already exists" vs "Will create" badges.
        const companyId = (req as any).companyId as string | undefined;
        const outletNames = Object.keys(parsed.outletCounts);
        const outletMatchStatus: Record<string, 'exists' | 'new'> = {};

        if (companyId && outletNames.length > 0) {
          const normalizedNames = outletNames.map(n => n.toLowerCase().trim());
          const existing = await db
            .select({ normalizedName: inventoryLocations.normalizedName })
            .from(inventoryLocations)
            .where(
              and(
                // @ts-ignore
                eq(inventoryLocations.companyId, companyId),
                // @ts-ignore
                eq(inventoryLocations.locationType, 'operating_unit'),
                // @ts-ignore
                eq(inventoryLocations.active, 1),
                sql`${inventoryLocations.normalizedName} = ANY(ARRAY[${sql.join(
                  normalizedNames.map(n => sql`${n}::text`),
                  sql`, `,
                )}])`,
              ),
            );
          // @ts-ignore
          const existingSet = new Set(existing.map(r => r.normalizedName));
          for (const name of outletNames) {
            outletMatchStatus[name] = existingSet.has(name.toLowerCase().trim())
              ? 'exists'
              : 'new';
          }
        } else {
          // No companyId (shouldn't happen for authenticated users) — treat all as new
          for (const name of outletNames) outletMatchStatus[name] = 'new';
        }

        return res.json({
          reportStart: parsed.reportStart,
          reportEnd: parsed.reportEnd,
          salesAreas: parsed.salesAreas,
          outletCounts: parsed.outletCounts,
          outletMatchStatus,
          categoryCounts: parsed.categoryCounts,
          totalItems: parsed.rows.length,
          totalQty: parsed.totalQty,
          totalNet: parsed.totalNet,
          uniqueOutlets: Object.keys(parsed.outletCounts).length,
          uniqueCategories: Object.keys(parsed.categoryCounts).length,
          unrecognizedPrefixCategories: parsed.unrecognizedPrefixCategories,
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

        if (parsed.unrecognizedPrefixCategories.length > 0) {
          console.warn(
            '[SalesByItemImport] approve: %d unrecognised QAC prefix(es) will be placed in "Unassigned" outlet: %s',
            parsed.unrecognizedPrefixCategories.length,
            parsed.unrecognizedPrefixCategories.join(', '),
          );
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

          // 1. Find-or-create the upload batch record (idempotent: reuse existing
          //    batch for the same company/store/date so that the dmis_csv_aggregate_uniq
          //    partial index can prevent duplicate sales rows on re-upload).
          const salesDate = new Date(parsed.reportStart + 'T00:00:00');
          let batchId: string | null = null;
          if (storeId && userId) {
            // Check whether a batch already exists for this company/store/report-date.
            const [existingBatch] = await tx
              .select({ id: salesUploadBatches.id })
              .from(salesUploadBatches)
              .where(
                and(
                  // @ts-ignore
                  eq(salesUploadBatches.companyId, companyId),
                  // @ts-ignore
                  eq(salesUploadBatches.storeId, storeId),
                  // @ts-ignore
                  eq(salesUploadBatches.salesDate, salesDate),
                ),
              )
              .limit(1);

            if (existingBatch) {
              // Reuse existing batch — sales rows with this batchId are already in
              // daily_menu_item_sales; the ON CONFLICT DO NOTHING below will skip them.
              batchId = existingBatch.id;
            } else {
              const [batch] = await tx
                .insert(salesUploadBatches)
                .values({
                  companyId,
                  storeId,
                  uploadedBy: userId,
                  fileName: req.file!.originalname,
                  salesDate,
                  status: 'completed',
                  rowsProcessed: parsed.rows.length,
                  rowsFailed: 0,
                })
                .returning({ id: salesUploadBatches.id });
              batchId = batch.id;
            }
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
                  // @ts-ignore
                  eq(inventoryLocations.companyId, companyId),
                  // @ts-ignore
                  eq(inventoryLocations.locationType, 'operating_unit'),
                  // @ts-ignore
                  eq(inventoryLocations.normalizedName, normalizedName),
                  // @ts-ignore
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
                  locationType: 'operating_unit',
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
                  // @ts-ignore
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
            // @ts-ignore
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
                    // @ts-ignore
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
              const inserted = await tx
                .insert(storeMenuItems)
                .values(
                  chunk.map((menuItemId) => ({
                    companyId,
                    storeId,
                    menuItemId,
                    active: 1,
                  })),
                )
                .onConflictDoNothing()
                .returning({ menuItemId: storeMenuItems.menuItemId });
              stats.storeItemsCreated += inserted.length;
            }
          }

          // 6. Insert daily_menu_item_sales — one aggregate row per (item, outlet) per batch.
          // Keying by (code + outlet) preserves per-outlet granularity so the TFC
          // "By Outlet" view can attribute sales and theoretical cost correctly.
          // The unique index dmis_csv_aggregate_uniq includes COALESCE(outlet_location_id,'')
          // so re-importing the same CSV is fully idempotent.
          if (batchId && storeId) {
            type AggEntry = { code: string; qty: number; net: number; outlet: string };
            const aggMap = new Map<string, AggEntry>();
            for (const row of parsed.rows) {
              // Key by "code|outlet" so the same QAC appearing in two different outlets
              // produces two separate rows instead of being collapsed into one.
              const key = `${row.code}|${row.outlet}`;
              const existing = aggMap.get(key);
              if (existing) {
                aggMap.set(key, { code: row.code, qty: existing.qty + row.qty, net: existing.net + row.netAmount, outlet: row.outlet });
              } else {
                aggMap.set(key, { code: row.code, qty: row.qty, net: row.netAmount, outlet: row.outlet });
              }
            }

            // salesDate is defined in step 1 (batch find-or-create) above.
            type SalesRow = {
              companyId: string;
              storeId: string;
              menuItemId: string;
              salesDate: Date;
              qtySold: number;
              netSales: number;
              sourceBatchId: string;
              outletLocationId?: string;
            };
            const salesRows: SalesRow[] = [];

            for (const [, agg] of Array.from(aggMap.entries())) {
              const menuItemId = menuItemIdMap.get(agg.code);
              if (!menuItemId) continue;
              salesRows.push({
                companyId,
                storeId,
                menuItemId,
                salesDate,
                qtySold: agg.qty,
                netSales: agg.net,
                sourceBatchId: batchId,
                outletLocationId: outletIdMap.get(agg.outlet) ?? undefined,
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

  // ── Unlinked Items (menu items with pluSku but no recipeId) ───────────────
  app.get(
    '/api/imports/sales-by-item/unlinked-items',
    requireAuth,
    requireTier('platform'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        if (!companyId) return res.status(400).json({ error: 'Company context required.' });

        // Fetch all POS-sourced menu items (have pluSku, no recipeId)
        const unlinkedItems = await db
          .select({
            id: menuItems.id,
            name: menuItems.name,
            pluSku: menuItems.pluSku,
            menuDepartmentId: menuItems.menuDepartmentId,
          })
          .from(menuItems)
          .where(
            and(
              // @ts-ignore
              eq(menuItems.companyId, companyId),
              // @ts-ignore
              eq(menuItems.active, 1),
              // @ts-ignore
              isNull(menuItems.recipeId),
              sql`${menuItems.pluSku} IS NOT NULL AND ${menuItems.pluSku} != ''`,
            ),
          )
          .orderBy(menuItems.name);

        // Fetch all departments for name lookup
        const depts = await db
          .select({ id: menuDepartments.id, name: menuDepartments.name })
          .from(menuDepartments)
          // @ts-ignore
          .where(eq(menuDepartments.companyId, companyId));
        // @ts-ignore
        const deptMap = new Map(depts.map((d) => [d.id, d.name]));

        // Fetch all active recipes (id, name, computedCost)
        const allRecipes = await db
          .select({ id: recipes.id, name: recipes.name, computedCost: recipes.computedCost })
          .from(recipes)
          .where(
            and(
              // @ts-ignore
              eq(recipes.companyId, companyId),
              // @ts-ignore
              eq(recipes.isActive, 1),
            ),
          )
          .orderBy(recipes.name);

        // Build response with fuzzy suggestions
        // @ts-ignore
        const items = unlinkedItems.map((item) => ({
          id: item.id,
          name: item.name,
          pluSku: item.pluSku,
          menuDepartmentId: item.menuDepartmentId,
          departmentName: item.menuDepartmentId ? (deptMap.get(item.menuDepartmentId) ?? null) : null,
          suggestions: suggestRecipes(item.name ?? '', allRecipes),
        }));

        return res.json({
          items,
          total: items.length,
          recipeCount: allRecipes.length,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[SalesByItemImport] unlinked-items error:', err);
        return res.status(500).json({ error: msg });
      }
    },
  );

  // ── Bulk link recipes to menu items ──────────────────────────────────────
  app.post(
    '/api/imports/sales-by-item/bulk-link-recipes',
    requireAuth,
    requireTier('platform'),
    async (req, res) => {
      try {
        const companyId = (req as any).companyId as string;
        if (!companyId) return res.status(400).json({ error: 'Company context required.' });

        const { links } = req.body as {
          links: Array<{ menuItemId: string; recipeId: string | null }>;
        };
        if (!Array.isArray(links) || links.length === 0) {
          return res.status(400).json({ error: 'links array is required.' });
        }

        let linked = 0;
        let skipped = 0;

        for (const { menuItemId, recipeId } of links) {
          if (!menuItemId) { skipped++; continue; }

          // Verify the menu item belongs to this company
          const [item] = await db
            .select({ id: menuItems.id })
            .from(menuItems)
            // @ts-ignore
            .where(and(eq(menuItems.id, menuItemId), eq(menuItems.companyId, companyId)))
            .limit(1);

          if (!item) { skipped++; continue; }

          // Verify recipe belongs to company if provided
          if (recipeId) {
            const [recipe] = await db
              .select({ id: recipes.id })
              .from(recipes)
              // @ts-ignore
              .where(and(eq(recipes.id, recipeId), eq(recipes.companyId, companyId)))
              .limit(1);
            if (!recipe) { skipped++; continue; }
          }

          await db
            .update(menuItems)
            .set({ recipeId: recipeId ?? null })
            // @ts-ignore
            .where(and(eq(menuItems.id, menuItemId), eq(menuItems.companyId, companyId)));

          linked++;
        }

        return res.json({ success: true, linked, skipped });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[SalesByItemImport] bulk-link-recipes error:', err);
        return res.status(500).json({ error: msg });
      }
    },
  );
}
