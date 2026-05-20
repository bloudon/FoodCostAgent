/**
 * CI-specific Playwright test fixture seed.
 *
 * Creates the exact users, companies, stores, and data records that every
 * Playwright spec file expects to find in the database.  All inserts are
 * idempotent — safe to run on a fresh or partially-seeded DB.
 *
 * Run with:
 *   npx tsx scripts/ci-seed.ts
 *
 * Fixed identifiers (must match the constants in the spec files):
 *   Company A  – Brian's Pizza      ad95ecda-74a9-49d7-833b-6d7d2f48efd1
 *   Company B  – The Breakfast Nook bn-company-0001
 *   Store A                          ci-store-brians-001
 *   Store B                          ci-store-nook-001
 *   Count A                          5f72014d-2b56-43ad-bc07-1dbf679336c5
 *   Count B                          dfc5aa03-0055-4b2e-ab88-fb4a11750b12
 *   Order guide                      3d91e5f0-71c6-457a-88cb-17353ae49e00
 *   Vendor (CI)                      ci-vendor-sysco-001
 */

import { db } from "../server/db";
import { hashPassword } from "../server/auth";
import {
  companies,
  companyStores,
  users,
  userStores,
  inventoryCounts,
  orderGuides,
  vendors,
  units,
  menuItems,
  recipes,
  recipeComponents,
} from "../shared/schema";
import { eq } from "drizzle-orm";

const COMPANY_A_ID   = "ad95ecda-74a9-49d7-833b-6d7d2f48efd1";
const COMPANY_B_ID   = "bn-company-0001";
const STORE_A_ID     = "ci-store-brians-001";
const STORE_B_ID     = "ci-store-nook-001";
const COUNT_A_ID     = "5f72014d-2b56-43ad-bc07-1dbf679336c5";
const COUNT_B_ID     = "dfc5aa03-0055-4b2e-ab88-fb4a11750b12";
const ORDER_GUIDE_ID = "3d91e5f0-71c6-457a-88cb-17353ae49e00";
const VENDOR_ID      = "ci-vendor-sysco-001";

async function run() {
  console.log("🌱 CI seed: creating Playwright test fixtures...");

  // ── 1. Company A — Brian's Pizza ──────────────────────────────────────────
  const existingA = await db
    .select()
    .from(companies)
    .where(eq(companies.id, COMPANY_A_ID));

  if (existingA.length === 0) {
    await db.insert(companies).values({
      id: COMPANY_A_ID,
      name: "Brian's Pizza",
      legalName: "Brian's Pizza LLC",
      contactEmail: "brian@brianspizza.com",
      status: "active",
    });
    console.log("  ✅ Company A (Brian's Pizza) created");
  } else {
    console.log("  ⏭  Company A already exists");
  }

  // ── 2. Company B — The Breakfast Nook ────────────────────────────────────
  const existingB = await db
    .select()
    .from(companies)
    .where(eq(companies.id, COMPANY_B_ID));

  if (existingB.length === 0) {
    await db.insert(companies).values({
      id: COMPANY_B_ID,
      name: "The Breakfast Nook",
      contactEmail: "hello@breakfastnook.com",
      status: "active",
    });
    console.log("  ✅ Company B (The Breakfast Nook) created");
  } else {
    console.log("  ⏭  Company B already exists");
  }

  // ── 3. Store A ────────────────────────────────────────────────────────────
  const existingStoreA = await db
    .select()
    .from(companyStores)
    .where(eq(companyStores.id, STORE_A_ID));

  if (existingStoreA.length === 0) {
    await db.insert(companyStores).values({
      id: STORE_A_ID,
      companyId: COMPANY_A_ID,
      code: "CI001",
      name: "Brian's Pizza Main",
      status: "active",
    });
    console.log("  ✅ Store A created");
  } else {
    console.log("  ⏭  Store A already exists");
  }

  // ── 4. Store B ────────────────────────────────────────────────────────────
  const existingStoreB = await db
    .select()
    .from(companyStores)
    .where(eq(companyStores.id, STORE_B_ID));

  if (existingStoreB.length === 0) {
    await db.insert(companyStores).values({
      id: STORE_B_ID,
      companyId: COMPANY_B_ID,
      code: "BN001",
      name: "The Breakfast Nook Main",
      status: "active",
    });
    console.log("  ✅ Store B created");
  } else {
    console.log("  ⏭  Store B already exists");
  }

  // ── 5. Test user — admin@brians.pizza / test123 ───────────────────────────
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, "admin@brians.pizza"));

  const passwordHash = await hashPassword("test123");

  if (existingUser.length === 0) {
    await db.insert(users).values({
      email: "admin@brians.pizza",
      passwordHash,
      role: "company_admin",
      companyId: COMPANY_A_ID,
      firstName: "Brian",
      lastName: "Admin",
      active: 1,
    });
    console.log("  ✅ Test user admin@brians.pizza created");
  } else {
    // Reset password every run so CI always has a known-good credential
    await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.email, "admin@brians.pizza"));
    console.log("  ⏭  Test user exists — password reset");
  }

  // Re-fetch user ID for FK references
  const [testUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, "admin@brians.pizza"));

  // ── 6. User–store assignment ───────────────────────────────────────────────
  const existingAssignment = await db
    .select()
    .from(userStores)
    .where(eq(userStores.userId, testUser.id));

  const alreadyAssignedToA = existingAssignment.some(
    (a) => a.storeId === STORE_A_ID,
  );

  if (!alreadyAssignedToA) {
    await db.insert(userStores).values({
      userId: testUser.id,
      storeId: STORE_A_ID,
    });
    console.log("  ✅ User–store A assignment created");
  } else {
    console.log("  ⏭  User–store A assignment already exists");
  }

  // ── 7. Vendor (needed by order-guide-scan spec) ───────────────────────────
  const existingVendor = await db
    .select()
    .from(vendors)
    .where(eq(vendors.id, VENDOR_ID));

  if (existingVendor.length === 0) {
    await db.insert(vendors).values({
      id: VENDOR_ID,
      companyId: COMPANY_A_ID,
      name: "Sysco (CI)",
      orderGuideType: "manual",
      active: 1,
    });
    console.log("  ✅ CI vendor created");
  } else {
    console.log("  ⏭  CI vendor already exists");
  }

  // ── 8. Order guide for Company A ─────────────────────────────────────────
  const existingOG = await db
    .select()
    .from(orderGuides)
    .where(eq(orderGuides.id, ORDER_GUIDE_ID));

  if (existingOG.length === 0) {
    await db.insert(orderGuides).values({
      id: ORDER_GUIDE_ID,
      companyId: COMPANY_A_ID,
      vendorId: VENDOR_ID,
      vendorKey: "sysco",
      source: "csv",
      rowCount: 0,
      status: "approved",
    });
    console.log("  ✅ Order guide created");
  } else {
    console.log("  ⏭  Order guide already exists");
  }

  // ── 9. Inventory count for Company A ─────────────────────────────────────
  const existingCountA = await db
    .select()
    .from(inventoryCounts)
    .where(eq(inventoryCounts.id, COUNT_A_ID));

  if (existingCountA.length === 0) {
    await db.insert(inventoryCounts).values({
      id: COUNT_A_ID,
      companyId: COMPANY_A_ID,
      storeId: STORE_A_ID,
      userId: testUser.id,
      countDate: new Date("2025-10-01T00:00:00Z"),
      name: "CI Fixture Count A",
      applied: 0,
    });
    console.log("  ✅ Inventory count A created");
  } else {
    console.log("  ⏭  Inventory count A already exists");
  }

  // ── 10. Test user — ci-staff@breakfastnook.com / ci-pass-nook ───────────
  // Created/updated unconditionally so password is always valid in CI.
  const existingBUser = await db
    .select()
    .from(users)
    .where(eq(users.email, "ci-staff@breakfastnook.com"));

  const bPasswordHash = await hashPassword("ci-pass-nook");

  let bUserId: string;
  if (existingBUser.length === 0) {
    const [newBUser] = await db
      .insert(users)
      .values({
        email: "ci-staff@breakfastnook.com",
        passwordHash: bPasswordHash,
        role: "company_admin",
        companyId: COMPANY_B_ID,
        active: 1,
      })
      .returning({ id: users.id });
    bUserId = newBUser.id;
    console.log("  ✅ Test user ci-staff@breakfastnook.com created");
  } else {
    bUserId = existingBUser[0].id;
    await db
      .update(users)
      .set({ passwordHash: bPasswordHash, active: 1 })
      .where(eq(users.email, "ci-staff@breakfastnook.com"));
    console.log("  ⏭  Company B user exists — password reset");
  }

  // ── 11. Inventory count for Company B ────────────────────────────────────
  const existingCountB = await db
    .select()
    .from(inventoryCounts)
    .where(eq(inventoryCounts.id, COUNT_B_ID));

  if (existingCountB.length === 0) {
    await db.insert(inventoryCounts).values({
      id: COUNT_B_ID,
      companyId: COMPANY_B_ID,
      storeId: STORE_B_ID,
      userId: bUserId,
      countDate: new Date("2025-10-01T00:00:00Z"),
      name: "CI Fixture Count B",
      applied: 0,
    });
    console.log("  ✅ Inventory count B created");
  } else {
    console.log("  ⏭  Inventory count B already exists");
  }

  // ── 11. Menu insights fixtures ────────────────────────────────────────────
  // Each company gets a menu item and a recipe with a unique missingItemName
  // so the menu-insights-isolation spec can assert cross-company scoping.

  // Resolve any unit ID — needed for recipe yieldUnitId
  const [anyUnit] = await db.select({ id: units.id }).from(units).limit(1);
  const unitId = anyUnit?.id ?? "fallback-unit-id";

  // Company A menu item
  const existingMenuA = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.id, "ci-menu-brians-001"));

  if (existingMenuA.length === 0) {
    await db.insert(menuItems).values({
      id: "ci-menu-brians-001",
      companyId: COMPANY_A_ID,
      name: "CI Margherita Pizza",
      pluSku: "CI-BRIANS-PIZZA-001",
      price: 14.99,
      active: 1,
    });
    console.log("  ✅ Company A CI menu item created");
  } else {
    console.log("  ⏭  Company A CI menu item already exists");
  }

  // Company B menu item
  const existingMenuB = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.id, "ci-menu-nook-001"));

  if (existingMenuB.length === 0) {
    await db.insert(menuItems).values({
      id: "ci-menu-nook-001",
      companyId: COMPANY_B_ID,
      name: "CI Eggs Benedict",
      pluSku: "CI-NOOK-EGGS-001",
      price: 12.5,
      active: 1,
    });
    console.log("  ✅ Company B CI menu item created");
  } else {
    console.log("  ⏭  Company B CI menu item already exists");
  }

  // Company A recipe with a uniquely identifiable missingItemName
  const existingRecipeA = await db
    .select()
    .from(recipes)
    .where(eq(recipes.id, "ci-recipe-brians-001"));

  if (existingRecipeA.length === 0) {
    await db.insert(recipes).values({
      id: "ci-recipe-brians-001",
      companyId: COMPANY_A_ID,
      name: "CI Margherita Base",
      yieldQty: 1,
      yieldUnitId: unitId,
      computedCost: 0,
      isActive: 1,
    });
    console.log("  ✅ Company A CI recipe created");
  } else {
    console.log("  ⏭  Company A CI recipe already exists");
  }

  // Company A recipe component with unique missingItemName sentinel
  const existingCompA = await db
    .select()
    .from(recipeComponents)
    .where(eq(recipeComponents.id, "ci-comp-brians-001"));

  if (existingCompA.length === 0) {
    await db.insert(recipeComponents).values({
      id: "ci-comp-brians-001",
      recipeId: "ci-recipe-brians-001",
      componentType: "inventory_item",
      componentId: "00000000-0000-0000-0000-000000000001",
      qty: 1,
      unitId,
      missingItemName: "ci-anchovy-paste",
      sortOrder: 0,
    });
    console.log("  ✅ Company A CI recipe component created");
  } else {
    console.log("  ⏭  Company A CI recipe component already exists");
  }

  // Company B recipe with a uniquely identifiable missingItemName
  const existingRecipeB = await db
    .select()
    .from(recipes)
    .where(eq(recipes.id, "ci-recipe-nook-001"));

  if (existingRecipeB.length === 0) {
    await db.insert(recipes).values({
      id: "ci-recipe-nook-001",
      companyId: COMPANY_B_ID,
      name: "CI Hollandaise Recipe",
      yieldQty: 1,
      yieldUnitId: unitId,
      computedCost: 0,
      isActive: 1,
    });
    console.log("  ✅ Company B CI recipe created");
  } else {
    console.log("  ⏭  Company B CI recipe already exists");
  }

  // Company B recipe component with unique missingItemName sentinel
  const existingCompB = await db
    .select()
    .from(recipeComponents)
    .where(eq(recipeComponents.id, "ci-comp-nook-001"));

  if (existingCompB.length === 0) {
    await db.insert(recipeComponents).values({
      id: "ci-comp-nook-001",
      recipeId: "ci-recipe-nook-001",
      componentType: "inventory_item",
      componentId: "00000000-0000-0000-0000-000000000002",
      qty: 1,
      unitId,
      missingItemName: "ci-hollandaise-base",
      sortOrder: 0,
    });
    console.log("  ✅ Company B CI recipe component created");
  } else {
    console.log("  ⏭  Company B CI recipe component already exists");
  }

  console.log("\n✅ CI seed complete.");
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ CI seed failed:", err);
  process.exit(1);
});
