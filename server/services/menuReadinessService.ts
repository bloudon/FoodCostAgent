/**
 * Menu Readiness Service
 *
 * Computes a per-entry readiness report for a draft menu, surfacing blockers
 * (must-fix before marking ready/live) and warnings (should-fix, advisory).
 *
 * Blockers
 *   NO_PRICE            — entry has no selling price
 *   NO_RECIPE           — recipe item has no linked recipe
 *   PLACEHOLDER_RECIPE  — recipe exists but is a placeholder (not built out)
 *   NO_RECIPE_COST      — recipe exists but computedCost is 0/null
 *   POS_NOT_MAPPED      — active POS connector exists and item is not mapped/ignored
 *
 * Warnings
 *   STALE_VENDOR_PRICE  — ingredient vendor prices older than STALE_DAYS
 *   HIGH_FOOD_COST      — item food cost % above HIGH_FC_THRESHOLD_PCT
 *   MISSING_DESCRIPTION — no description on entry or canonical item
 */
import { db } from "../db";
import { sql, eq, and, inArray } from "drizzle-orm";
import {
  menuEntries,
  menuItems,
  recipes,
  recipeComponents,
  vendors,
  vendorItems,
  posConnections,
  posItemMappings,
} from "../../shared/schema";

// ── Thresholds ────────────────────────────────────────────────────────────────

const STALE_DAYS = 30;
const HIGH_FC_THRESHOLD_PCT = 33;

// ── Public types ──────────────────────────────────────────────────────────────

export interface ReadinessIssue {
  /** "blocker" must be resolved before the menu can be marked ready/live. */
  type: "blocker" | "warning";
  /** Machine-readable code identifying the issue kind. */
  code: string;
  entryId: string;
  menuItemId: string;
  itemName: string;
  /** Human-readable explanation surfaced in the UI. */
  message: string;
  /** Deep-link href the user can navigate to in order to fix the issue. */
  navigationHref: string;
}

export interface ReadinessReport {
  menuId: string;
  totalEntries: number;
  blockerCount: number;
  warningCount: number;
  /** True when there are zero blockers — gate check for draft→ready and ready→live. */
  canTransitionToReady: boolean;
  issues: ReadinessIssue[];
}

// ── Implementation ────────────────────────────────────────────────────────────

export async function computeMenuReadinessImpl(
  menuId: string,
  companyId: string,
): Promise<ReadinessReport> {
  // ── 1. Fetch entries + menu items + recipes in one join ──────────────────
  const rows = await db
    .select({
      entryId:            menuEntries.id,
      menuItemId:         menuEntries.menuItemId,
      entryPrice:         menuEntries.price,
      descriptionOverride: menuEntries.descriptionOverride,
      itemName:           menuItems.name,
      itemDescription:    menuItems.description,
      itemIsRecipeItem:   menuItems.isRecipeItem,
      recipeId:           menuItems.recipeId,
      recipeComputedCost: recipes.computedCost,
      recipeIsPlaceholder: recipes.isPlaceholder,
    })
    .from(menuEntries)
    .innerJoin(menuItems, eq(menuEntries.menuItemId, menuItems.id))
    .leftJoin(recipes, eq(menuItems.recipeId, recipes.id))
    .where(and(
      eq(menuEntries.menuId, menuId),
      eq(menuEntries.companyId, companyId),
    ));

  if (rows.length === 0) {
    return {
      menuId,
      totalEntries: 0,
      blockerCount: 0,
      warningCount: 0,
      canTransitionToReady: true,
      issues: [],
    };
  }

  // ── 2. Collect recipe IDs for stale-pricing check ────────────────────────
  const recipeIdSet = new Set<string>();
  for (const r of rows) {
    if (r.recipeId) recipeIdSet.add(r.recipeId);
  }
  const recipeIds = Array.from(recipeIdSet);

  // ── 3. Check for active POS connector ────────────────────────────────────
  const posConnRows = await db
    .select({ id: posConnections.id })
    .from(posConnections)
    .where(and(
      eq(posConnections.companyId, companyId),
      sql`${posConnections.status} = 'active'`,
    ))
    .limit(1);

  const hasPosConnector = posConnRows.length > 0;

  // ── 4. POS item mappings ─────────────────────────────────────────────────
  const mappedMenuItemIds  = new Set<string>();
  const ignoredMenuItemIds = new Set<string>();

  if (hasPosConnector) {
    const connectionId = posConnRows[0].id;
    const mappings = await db
      .select({
        menuItemId: posItemMappings.menuItemId,
        ignored:    posItemMappings.ignored,
      })
      .from(posItemMappings)
      .where(eq(posItemMappings.connectionId, connectionId));

    for (const m of mappings) {
      if (m.menuItemId) {
        if (m.ignored) ignoredMenuItemIds.add(m.menuItemId);
        else mappedMenuItemIds.add(m.menuItemId);
      }
    }
  }

  // ── 5. Stale vendor pricing — recipes that have any stale ingredient ──────
  const recipeIdsWithStalePrice = new Set<string>();

  if (recipeIds.length > 0) {
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 86_400_000);

    const staleRows = await db
      .selectDistinct({ recipeId: recipeComponents.recipeId })
      .from(recipeComponents)
      .innerJoin(vendorItems, eq(recipeComponents.componentId, vendorItems.inventoryItemId))
      .innerJoin(vendors, eq(vendorItems.vendorId, vendors.id))
      .where(and(
        inArray(recipeComponents.recipeId, recipeIds),
        eq(recipeComponents.componentType, "inventory_item"),
        eq(vendorItems.active, 1),
        eq(vendors.companyId, companyId),
        sql`(${vendorItems.pricedAt} IS NULL OR ${vendorItems.pricedAt} < ${staleCutoff})`,
      ));

    for (const { recipeId } of staleRows) {
      recipeIdsWithStalePrice.add(recipeId);
    }
  }

  // ── 6. Build issues list ──────────────────────────────────────────────────
  const issues: ReadinessIssue[] = [];

  for (const row of rows) {
    const itemHref   = `/menu-items/${row.menuItemId}`;
    const recipeHref = row.recipeId ? `/recipes/${row.recipeId}` : itemHref;

    // ── Blockers ──────────────────────────────────────────────────────────

    if (row.entryPrice == null || row.entryPrice <= 0) {
      issues.push({
        type:           "blocker",
        code:           "NO_PRICE",
        entryId:        row.entryId,
        menuItemId:     row.menuItemId,
        itemName:       row.itemName,
        message:        "No selling price set",
        navigationHref: itemHref,
      });
    }

    if (row.itemIsRecipeItem === 1 && !row.recipeId) {
      issues.push({
        type:           "blocker",
        code:           "NO_RECIPE",
        entryId:        row.entryId,
        menuItemId:     row.menuItemId,
        itemName:       row.itemName,
        message:        "No recipe linked — add a recipe so the item has a cost",
        navigationHref: itemHref,
      });
    } else if (row.recipeId) {
      if (row.recipeIsPlaceholder === 1) {
        issues.push({
          type:           "blocker",
          code:           "PLACEHOLDER_RECIPE",
          entryId:        row.entryId,
          menuItemId:     row.menuItemId,
          itemName:       row.itemName,
          message:        "Recipe is a placeholder — build it out before publishing",
          navigationHref: recipeHref,
        });
      } else if (!row.recipeComputedCost || row.recipeComputedCost <= 0) {
        issues.push({
          type:           "blocker",
          code:           "NO_RECIPE_COST",
          entryId:        row.entryId,
          menuItemId:     row.menuItemId,
          itemName:       row.itemName,
          message:        "Recipe has no calculable cost — add ingredients with prices",
          navigationHref: recipeHref,
        });
      }
    }

    if (
      hasPosConnector &&
      row.itemIsRecipeItem === 1 &&
      !mappedMenuItemIds.has(row.menuItemId) &&
      !ignoredMenuItemIds.has(row.menuItemId)
    ) {
      issues.push({
        type:           "blocker",
        code:           "POS_NOT_MAPPED",
        entryId:        row.entryId,
        menuItemId:     row.menuItemId,
        itemName:       row.itemName,
        message:        "Not mapped to a POS item — customers won't be able to order it",
        navigationHref: "/pos/mappings",
      });
    }

    // ── Warnings ──────────────────────────────────────────────────────────

    if (row.recipeId && recipeIdsWithStalePrice.has(row.recipeId)) {
      issues.push({
        type:           "warning",
        code:           "STALE_VENDOR_PRICE",
        entryId:        row.entryId,
        menuItemId:     row.menuItemId,
        itemName:       row.itemName,
        message:        `Ingredient pricing is more than ${STALE_DAYS} days old — cost estimate may be inaccurate`,
        navigationHref: recipeHref,
      });
    }

    if (
      row.recipeComputedCost &&
      row.recipeComputedCost > 0 &&
      row.entryPrice &&
      row.entryPrice > 0
    ) {
      const fcPct = (row.recipeComputedCost / row.entryPrice) * 100;
      if (fcPct > HIGH_FC_THRESHOLD_PCT) {
        issues.push({
          type:           "warning",
          code:           "HIGH_FOOD_COST",
          entryId:        row.entryId,
          menuItemId:     row.menuItemId,
          itemName:       row.itemName,
          message:        `Food cost is ${fcPct.toFixed(1)}% — above the ${HIGH_FC_THRESHOLD_PCT}% threshold`,
          navigationHref: itemHref,
        });
      }
    }

    const hasDescription =
      (row.descriptionOverride?.trim() ?? "") ||
      (row.itemDescription?.trim() ?? "");
    if (!hasDescription) {
      issues.push({
        type:           "warning",
        code:           "MISSING_DESCRIPTION",
        entryId:        row.entryId,
        menuItemId:     row.menuItemId,
        itemName:       row.itemName,
        message:        "No description — add one to improve the guest experience",
        navigationHref: itemHref,
      });
    }
  }

  const blockerCount = issues.filter((i) => i.type === "blocker").length;
  const warningCount = issues.filter((i) => i.type === "warning").length;

  return {
    menuId,
    totalEntries: rows.length,
    blockerCount,
    warningCount,
    canTransitionToReady: blockerCount === 0,
    issues,
  };
}
