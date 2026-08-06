/**
 * Menu Dashboard Count Accuracy — Integration Tests
 *
 * Verifies that `getMenusWithStats` returns correct scalar counts even when
 * a menu has entries across multiple sections, multiple recipes per item, and
 * multiple location assignments simultaneously.  A naïve JOIN-based query
 * would Cartesian-multiply those relationships; these tests guard against that.
 *
 * Requires a live DATABASE_URL (same as all other integration tests).
 * Tests are skipped automatically when DATABASE_URL is absent.
 */

import { describe, it, expect, afterAll } from "vitest";
import { db } from "./db";
import { eq, inArray } from "drizzle-orm";
import {
  companies as companiesTable,
  companyStores,
  menus,
  menuSections,
  menuEntries,
  menuItems,
  menuItemRecipes,
  menuLocationAssignments,
} from "@shared/schema";
import { storage } from "./storage";

// ─── Unique run tag (prevents cross-test row leakage) ─────────────────────────
const RUN = Date.now().toString(36);

const IDs = {
  company:    `test-mdc-co-${RUN}`,
  store1:     `test-mdc-s1-${RUN}`,
  store2:     `test-mdc-s2-${RUN}`,
  item1:      `test-mdc-mi1-${RUN}`,
  item2:      `test-mdc-mi2-${RUN}`,
  item3:      `test-mdc-mi3-${RUN}`,
  menu:       `test-mdc-menu-${RUN}`,
  section1:   `test-mdc-sec1-${RUN}`,
  section2:   `test-mdc-sec2-${RUN}`,
  section3:   `test-mdc-sec3-${RUN}`,
  // Synthetic recipe IDs — no FK constraint on menu_item_recipes.recipe_id
  recipeA:    `test-mdc-rA-${RUN}`,
  recipeB:    `test-mdc-rB-${RUN}`,
};

// ─── Cleanup ──────────────────────────────────────────────────────────────────
afterAll(async () => {
  // Delete in dependency order (children before parents)
  await db.delete(menuLocationAssignments).where(eq(menuLocationAssignments.menuId, IDs.menu));
  await db.delete(menuItemRecipes).where(
    inArray(menuItemRecipes.menuItemId, [IDs.item1, IDs.item2, IDs.item3]),
  );
  await db.delete(menuEntries).where(eq(menuEntries.menuId, IDs.menu));
  await db.delete(menuSections).where(eq(menuSections.menuId, IDs.menu));
  await db.delete(menus).where(eq(menus.id, IDs.menu));
  await db.delete(menuItems).where(
    inArray(menuItems.id, [IDs.item1, IDs.item2, IDs.item3]),
  );
  await db.delete(companyStores).where(eq(companyStores.companyId, IDs.company));
  await db.delete(companiesTable).where(eq(companiesTable.id, IDs.company));
});

// ─── Fixture setup ────────────────────────────────────────────────────────────
async function buildFixtures() {
  // Company
  await db.insert(companiesTable).values({
    id: IDs.company,
    name: "Menu Count Test Co",
    country: "US",
    timezone: "America/New_York",
  }).onConflictDoNothing();

  // Two active store locations
  await db.insert(companyStores).values([
    { id: IDs.store1, companyId: IDs.company, code: `ST1-${RUN}`, name: "Store One", status: "active" },
    { id: IDs.store2, companyId: IDs.company, code: `ST2-${RUN}`, name: "Store Two", status: "active" },
  ]).onConflictDoNothing();

  // Three menu items.  pluSku must be unique per company.
  await db.insert(menuItems).values([
    { id: IDs.item1, companyId: IDs.company, name: "Item One",   pluSku: `PLU-1-${RUN}` },
    { id: IDs.item2, companyId: IDs.company, name: "Item Two",   pluSku: `PLU-2-${RUN}` },
    { id: IDs.item3, companyId: IDs.company, name: "Item Three", pluSku: `PLU-3-${RUN}` },
  ]).onConflictDoNothing();

  // Menu
  await db.insert(menus).values({
    id: IDs.menu,
    companyId: IDs.company,
    name: "Test Dashboard Menu",
    status: "draft",
  }).onConflictDoNothing();

  // Three sections
  await db.insert(menuSections).values([
    { id: IDs.section1, menuId: IDs.menu, companyId: IDs.company, name: "Section A", displayOrder: 0 },
    { id: IDs.section2, menuId: IDs.menu, companyId: IDs.company, name: "Section B", displayOrder: 1 },
    { id: IDs.section3, menuId: IDs.menu, companyId: IDs.company, name: "Section C", displayOrder: 2 },
  ]).onConflictDoNothing();

  // Three entries — one per section.
  // Item 1: priced ($12.99); Items 2 & 3: no price.
  await db.insert(menuEntries).values([
    {
      menuId: IDs.menu, menuSectionId: IDs.section1, menuItemId: IDs.item1,
      companyId: IDs.company, displayOrder: 0, price: 12.99,
    },
    {
      menuId: IDs.menu, menuSectionId: IDs.section2, menuItemId: IDs.item2,
      companyId: IDs.company, displayOrder: 0, price: null,
    },
    {
      menuId: IDs.menu, menuSectionId: IDs.section3, menuItemId: IDs.item3,
      companyId: IDs.company, displayOrder: 0, price: null,
    },
  ]).onConflictDoNothing();

  // Items 1 & 2 each get 2 recipe links (recipeA and recipeB).
  // Item 3 has no recipe links.
  // menu_item_recipes has no FK on recipe_id, so synthetic UUIDs are fine.
  await db.insert(menuItemRecipes).values([
    { companyId: IDs.company, menuItemId: IDs.item1, recipeId: IDs.recipeA, prepStyleLabel: "Prep A", sortOrder: 0 },
    { companyId: IDs.company, menuItemId: IDs.item1, recipeId: IDs.recipeB, prepStyleLabel: "Prep B", sortOrder: 1 },
    { companyId: IDs.company, menuItemId: IDs.item2, recipeId: IDs.recipeA, prepStyleLabel: "Prep A", sortOrder: 0 },
    { companyId: IDs.company, menuItemId: IDs.item2, recipeId: IDs.recipeB, prepStyleLabel: "Prep B", sortOrder: 1 },
  ]).onConflictDoNothing();

  // Two active location assignments
  await db.insert(menuLocationAssignments).values([
    { menuId: IDs.menu, storeId: IDs.store1, companyId: IDs.company },
    { menuId: IDs.menu, storeId: IDs.store2, companyId: IDs.company },
  ]).onConflictDoNothing();
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("getMenusWithStats — count accuracy (no Cartesian-product inflation)", () => {
  it("returns correct counts when sections × recipes × locations coexist", async () => {
    if (!process.env.DATABASE_URL) {
      console.warn("[skip] DATABASE_URL not set — integration test requires a live DB");
      return;
    }

    await buildFixtures();

    const menus = await storage.getMenusWithStats(IDs.company);
    expect(menus).toHaveLength(1);

    const m = menus[0];

    // ── Core count assertions ─────────────────────────────────────────────────
    expect(m.itemCount, "itemCount: one entry per section = 3").toBe(3);
    expect(m.pricedItems, "pricedItems: only item 1 has a price > 0").toBe(1);
    expect(m.recipedItems, "recipedItems: items 1 & 2 each have ≥1 recipe link = 2").toBe(2);
    expect(m.sectionCount, "sectionCount: all 3 sections have an entry = 3").toBe(3);
    expect(m.totalSectionCount, "totalSectionCount: 3 sections exist on the menu").toBe(3);
    expect(m.locationCount, "locationCount: 2 active location assignments").toBe(2);

    // ── Anti-inflation guard ──────────────────────────────────────────────────
    // None of the counts should exceed the true row count (3 items).
    // If a JOIN were used instead of independent subqueries, recipes × locations
    // would multiply entries and produce inflated numbers (e.g. 3 × 2 × 2 = 12).
    const ACTUAL_ITEM_COUNT = 3;
    expect(m.itemCount,       "itemCount must not be inflated by other relationships").toBeLessThanOrEqual(ACTUAL_ITEM_COUNT);
    expect(m.pricedItems,     "pricedItems must not exceed actual item count").toBeLessThanOrEqual(ACTUAL_ITEM_COUNT);
    expect(m.recipedItems,    "recipedItems must not exceed actual item count").toBeLessThanOrEqual(ACTUAL_ITEM_COUNT);
    expect(m.sectionCount,    "sectionCount must not exceed total section count").toBeLessThanOrEqual(m.totalSectionCount);
    expect(m.locationCount,   "locationCount must not be inflated").toBeLessThanOrEqual(2);

    // ── Location names ────────────────────────────────────────────────────────
    expect(Array.isArray(m.locationNames), "locationNames must be an array").toBe(true);
    expect(m.locationNames).toHaveLength(2);
    expect(m.locationNames).toContain("Store One");
    expect(m.locationNames).toContain("Store Two");
  });

  it("returns zero counts for a menu with no entries, sections, or assignments", async () => {
    if (!process.env.DATABASE_URL) return;

    // Insert a bare-bones menu (no sections, entries, or assignments)
    const bareMenuId = `test-mdc-bare-${RUN}`;
    await db.insert(menus).values({
      id: bareMenuId,
      companyId: IDs.company,
      name: "Empty Menu",
      status: "draft",
    }).onConflictDoNothing();

    try {
      const results = await storage.getMenusWithStats(IDs.company);
      const bare = results.find((m) => m.id === bareMenuId);
      expect(bare, "empty menu must appear in results").toBeDefined();
      if (!bare) return;

      expect(bare.itemCount,        "empty menu: itemCount = 0").toBe(0);
      expect(bare.pricedItems,      "empty menu: pricedItems = 0").toBe(0);
      expect(bare.recipedItems,     "empty menu: recipedItems = 0").toBe(0);
      expect(bare.sectionCount,     "empty menu: sectionCount = 0").toBe(0);
      expect(bare.totalSectionCount,"empty menu: totalSectionCount = 0").toBe(0);
      expect(bare.locationCount,    "empty menu: locationCount = 0").toBe(0);
      expect(bare.locationNames,    "empty menu: locationNames = []").toEqual([]);
    } finally {
      await db.delete(menus).where(eq(menus.id, bareMenuId));
    }
  });
});
