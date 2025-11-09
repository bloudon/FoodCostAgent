import { storage } from "./storage";
import { hashPassword } from "./auth";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { companies, companyStores, storeStorageLocations, inventoryItems, storeInventoryItems, vendors, recipes, recipeComponents, categories, units } from "@shared/schema";

// Comprehensive kitchen units seed data
async function seedKitchenUnits() {
  console.log("📏 Seeding comprehensive kitchen units...");
  
  const existingUnits = await db.select().from(units);
  
  // Define all 40 comprehensive kitchen units
  const expectedUnitNames = new Set([
    // Weight (11)
    "gram", "kilogram", "metric ton", "ounce (weight)", "half-ounce", "quarter-ounce",
    "pound", "half-pound", "quarter-pound", "eighth-pound", "ton",
    // Volume (19)
    "milliliter", "centiliter", "deciliter", "liter", "hectoliter",
    "drop", "dash", "pinch", "teaspoon", "half-teaspoon",
    "tablespoon", "half-tablespoon", "fluid ounce", "cup", "half-cup",
    "quarter-cup", "pint", "quart", "gallon",
    // Count (10)
    "each", "half-dozen", "dozen", "roll", "case",
    "box", "bag", "bottle", "jar", "can",
  ]);
  
  const existingUnitNames = new Set(existingUnits.map(u => u.name));
  
  // Check which units are missing
  const missingUnits = [...expectedUnitNames].filter(name => !existingUnitNames.has(name));
  
  if (missingUnits.length === 0) {
    console.log("✅ All 40 comprehensive kitchen units already seeded");
    return;
  }
  
  console.log(`📝 Found ${existingUnits.length} units, adding ${missingUnits.length} missing units...`);
  
  // All units with precise conversion ratios
  // Weight base: gram (1g = 1), Volume base: milliliter (1ml = 1), Count base: each (1 each = 1)
  const kitchenUnits = [
    // === WEIGHT UNITS ===
    // Metric Weight
    { name: "gram", kind: "weight", toBaseRatio: 1, system: "metric" },
    { name: "kilogram", kind: "weight", toBaseRatio: 1000, system: "metric" },
    { name: "metric ton", kind: "weight", toBaseRatio: 1000000, system: "metric" }, // 1000 kg
    
    // Imperial Weight
    { name: "ounce (weight)", kind: "weight", toBaseRatio: 28.3495, system: "imperial" },
    { name: "half-ounce", kind: "weight", toBaseRatio: 14.1748, system: "imperial" },
    { name: "quarter-ounce", kind: "weight", toBaseRatio: 7.0874, system: "imperial" },
    { name: "pound", kind: "weight", toBaseRatio: 453.592, system: "imperial" },
    { name: "half-pound", kind: "weight", toBaseRatio: 226.796, system: "imperial" },
    { name: "quarter-pound", kind: "weight", toBaseRatio: 113.398, system: "imperial" },
    { name: "eighth-pound", kind: "weight", toBaseRatio: 56.699, system: "imperial" },
    { name: "ton", kind: "weight", toBaseRatio: 907185, system: "imperial" }, // 2000 lbs
    
    // === VOLUME UNITS ===
    // Metric Volume
    { name: "milliliter", kind: "volume", toBaseRatio: 1, system: "metric" },
    { name: "centiliter", kind: "volume", toBaseRatio: 10, system: "metric" },
    { name: "deciliter", kind: "volume", toBaseRatio: 100, system: "metric" },
    { name: "liter", kind: "volume", toBaseRatio: 1000, system: "metric" },
    { name: "hectoliter", kind: "volume", toBaseRatio: 100000, system: "metric" },
    
    // Imperial Volume - Smallest to Largest
    { name: "drop", kind: "volume", toBaseRatio: 0.05, system: "imperial" }, // ~1/20 of ml
    { name: "dash", kind: "volume", toBaseRatio: 0.616, system: "imperial" }, // ~1/8 tsp
    { name: "pinch", kind: "volume", toBaseRatio: 0.308, system: "imperial" }, // ~1/16 tsp
    { name: "teaspoon", kind: "volume", toBaseRatio: 4.92892, system: "imperial" },
    { name: "half-teaspoon", kind: "volume", toBaseRatio: 2.46446, system: "imperial" },
    { name: "tablespoon", kind: "volume", toBaseRatio: 14.7868, system: "imperial" },
    { name: "half-tablespoon", kind: "volume", toBaseRatio: 7.3934, system: "imperial" },
    { name: "fluid ounce", kind: "volume", toBaseRatio: 29.5735, system: "imperial" },
    { name: "cup", kind: "volume", toBaseRatio: 236.588, system: "imperial" },
    { name: "half-cup", kind: "volume", toBaseRatio: 118.294, system: "imperial" },
    { name: "quarter-cup", kind: "volume", toBaseRatio: 59.147, system: "imperial" },
    { name: "pint", kind: "volume", toBaseRatio: 473.176, system: "imperial" },
    { name: "quart", kind: "volume", toBaseRatio: 946.353, system: "imperial" },
    { name: "gallon", kind: "volume", toBaseRatio: 3785.41, system: "imperial" },
    
    // === COUNT UNITS ===
    { name: "each", kind: "count", toBaseRatio: 1, system: "both" },
    { name: "half-dozen", kind: "count", toBaseRatio: 6, system: "both" },
    { name: "dozen", kind: "count", toBaseRatio: 12, system: "both" },
    { name: "roll", kind: "count", toBaseRatio: 1, system: "both" },
    { name: "case", kind: "count", toBaseRatio: 1, system: "both" },
    { name: "box", kind: "count", toBaseRatio: 1, system: "both" },
    { name: "bag", kind: "count", toBaseRatio: 1, system: "both" },
    { name: "bottle", kind: "count", toBaseRatio: 1, system: "both" },
    { name: "jar", kind: "count", toBaseRatio: 1, system: "both" },
    { name: "can", kind: "count", toBaseRatio: 1, system: "both" },
  ];
  
  // Filter to only insert missing units (upsert strategy)
  const unitsToInsert = kitchenUnits.filter(unit => missingUnits.includes(unit.name));
  
  if (unitsToInsert.length > 0) {
    await db.insert(units).values(unitsToInsert);
    console.log(`✅ Added ${unitsToInsert.length} missing kitchen units`);
  }
  
  console.log(`✅ Complete: ${kitchenUnits.length} total kitchen units (imperial + metric)`);
}

// Helper function to create default categories for a company
async function createDefaultCategories(companyId: string) {
  const existingCategories = await db.select().from(categories).where(eq(categories.companyId, companyId));
  if (existingCategories.length === 0) {
    await db.insert(categories).values([
      {
        companyId,
        name: "Frozen",
        sortOrder: 1,
        showAsIngredient: 1,
      },
      {
        companyId,
        name: "Walk-In",
        sortOrder: 2,
        showAsIngredient: 1,
      },
      {
        companyId,
        name: "Dry/Pantry",
        sortOrder: 3,
        showAsIngredient: 1,
      },
    ]);
    return true;
  }
  return false;
}

// Seed Brian's Pizza company, stores, ingredients, and recipes
async function seedBriansPizza() {
  console.log("🏢 Creating Brian's Pizza company and stores...");
  
  // Get units first
  const allUnits = await storage.getUnits();
  const units = {
    pound: allUnits.find((u: any) => u.name === "pound"),
    ounce: allUnits.find((u: any) => u.name === "ounce (weight)"),
  };
  
  if (!units.pound || !units.ounce) {
    console.log("⚠️  Units not created yet, skipping Brian's Pizza seed");
    return;
  }
  
  // Check if Brian's Pizza already exists
  const existingCompanies = await db.select().from(companies).where(eq(companies.name, "Brian's Pizza"));
  let briansPizza;
  if (existingCompanies.length > 0) {
    briansPizza = existingCompanies[0];
  } else {
    const result = await db.insert(companies).values({
      name: "Brian's Pizza",
      legalName: "Brian's Pizza LLC",
      contactEmail: "brian@brianspizza.com",
      status: "active",
    }).returning();
    briansPizza = result[0];
    console.log("✅ Created Brian's Pizza company");
  }

  // Create default categories for Brian's Pizza
  const categoriesCreated = await createDefaultCategories(briansPizza.id);
  if (categoriesCreated) {
    console.log("✅ Created default categories for Brian's Pizza");
  }

  // Create stores for Brian's Pizza
  const existingStores = await db.select().from(companyStores).where(eq(companyStores.companyId, briansPizza.id));
  let store1, store2;
  
  if (existingStores.length === 0) {
    const stores = await db.insert(companyStores).values([
      {
        companyId: briansPizza.id,
        code: "S001",
        name: "Downtown Location",
        status: "active",
      },
      {
        companyId: briansPizza.id,
        code: "S002",
        name: "Airport Location",
        status: "active",
      }
    ]).returning();
    store1 = stores[0];
    store2 = stores[1];
    console.log("✅ Created 2 stores for Brian's Pizza");
    
    // Create storage locations for each store
    await db.insert(storeStorageLocations).values([
      { storeId: store1.id, name: "Walk-In Cooler", type: "cooler", isDefault: 1, sortOrder: 1 },
      { storeId: store1.id, name: "Dry Storage", type: "dry_storage", isDefault: 0, sortOrder: 2 },
      { storeId: store1.id, name: "Freezer", type: "freezer", isDefault: 0, sortOrder: 3 },
      { storeId: store2.id, name: "Walk-In Cooler", type: "cooler", isDefault: 1, sortOrder: 1 },
      { storeId: store2.id, name: "Dry Storage", type: "dry_storage", isDefault: 0, sortOrder: 2 },
      { storeId: store2.id, name: "Freezer", type: "freezer", isDefault: 0, sortOrder: 3 },
    ]);
    console.log("✅ Created storage locations for both stores");
  } else {
    store1 = existingStores[0];
    store2 = existingStores.length > 1 ? existingStores[1] : store1;
  }

  // Check if ingredients already exist
  const existingItems = await db.select().from(inventoryItems)
    .where(eq(inventoryItems.companyId, briansPizza.id));
  
  let pizzaFlour, pizzaYeast, pizzaSalt, pizzaWater, pizzaOliveOil, pizzaSugar;
  
  if (existingItems.length === 0 || !existingItems.find((i: any) => i.name === "Bread Flour")) {
    console.log("🍕 Creating pizza dough ingredients for Brian's Pizza...");
    
    // Create vendors for Brian's Pizza
    try {
      await db.insert(vendors).values({
        companyId: briansPizza.id,
        name: "Misc Grocery",
        orderGuideType: "manual",
      });
    } catch (e) {
      // Vendor might already exist
    }
    
    // Create pizza dough ingredients with $2/lb cost and 95% yield
    const doughIngredients = await db.insert(inventoryItems).values([
      {
        companyId: briansPizza.id,
        name: "Bread Flour",
        unitId: units.pound.id,
        pricePerUnit: 2,
        yieldPercent: 95,
        caseSize: 50,
        active: 1,
      },
      {
        companyId: briansPizza.id,
        name: "Active Dry Yeast",
        unitId: units.pound.id,
        pricePerUnit: 2,
        yieldPercent: 95,
        caseSize: 1,
        active: 1,
      },
      {
        companyId: briansPizza.id,
        name: "Kosher Salt",
        unitId: units.pound.id,
        pricePerUnit: 2,
        yieldPercent: 95,
        caseSize: 3,
        active: 1,
      },
      {
        companyId: briansPizza.id,
        name: "Water",
        unitId: units.pound.id,
        pricePerUnit: 2,
        yieldPercent: 95,
        caseSize: 8,
        active: 1,
      },
      {
        companyId: briansPizza.id,
        name: "Extra Virgin Olive Oil",
        unitId: units.pound.id,
        pricePerUnit: 2,
        yieldPercent: 95,
        caseSize: 2,
        active: 1,
      },
      {
        companyId: briansPizza.id,
        name: "Granulated Sugar",
        unitId: units.pound.id,
        pricePerUnit: 2,
        yieldPercent: 95,
        caseSize: 10,
        active: 1,
      },
    ]).returning();
    
    pizzaFlour = doughIngredients[0];
    pizzaYeast = doughIngredients[1];
    pizzaSalt = doughIngredients[2];
    pizzaWater = doughIngredients[3];
    pizzaOliveOil = doughIngredients[4];
    pizzaSugar = doughIngredients[5];
    
    // Link ingredients to stores
    await db.insert(storeInventoryItems).values([
      // Store 1
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaFlour.id, onHandQty: 500, active: 1 },
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaYeast.id, onHandQty: 10, active: 1 },
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaSalt.id, onHandQty: 20, active: 1 },
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaWater.id, onHandQty: 0, active: 1 },
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaOliveOil.id, onHandQty: 15, active: 1 },
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaSugar.id, onHandQty: 25, active: 1 },
      // Store 2
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaFlour.id, onHandQty: 300, active: 1 },
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaYeast.id, onHandQty: 8, active: 1 },
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaSalt.id, onHandQty: 15, active: 1 },
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaWater.id, onHandQty: 0, active: 1 },
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaOliveOil.id, onHandQty: 10, active: 1 },
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaSugar.id, onHandQty: 20, active: 1 },
    ]);
    
    console.log("✅ Created 6 pizza dough ingredients");
  } else {
    pizzaFlour = existingItems.find((i: any) => i.name === "Bread Flour");
    pizzaYeast = existingItems.find((i: any) => i.name === "Active Dry Yeast");
    pizzaSalt = existingItems.find((i: any) => i.name === "Kosher Salt");
    pizzaWater = existingItems.find((i: any) => i.name === "Water");
    pizzaOliveOil = existingItems.find((i: any) => i.name === "Extra Virgin Olive Oil");
    pizzaSugar = existingItems.find((i: any) => i.name === "Granulated Sugar");
  }

  // ============ PIZZA DOUGH RECIPE ============
  const existingRecipes = await db.select().from(recipes)
    .where(eq(recipes.companyId, briansPizza.id));
  
  if (existingRecipes.length === 0 && pizzaFlour && pizzaYeast && pizzaSalt && pizzaWater && pizzaOliveOil && pizzaSugar) {
    console.log("📝 Creating Pizza Dough recipe...");
    
    const pizzaDoughRecipe = await db.insert(recipes).values({
      companyId: briansPizza.id,
      name: "Pizza Dough (100 lb Batch)",
      yieldQty: 166.5,
      yieldUnitId: units.pound.id,
      computedCost: 0,
      canBeIngredient: 1,
    }).returning();
    
    const recipe = pizzaDoughRecipe[0];
    
    // Add recipe components in ounces (micro units)
    await db.insert(recipeComponents).values([
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaFlour.id,
        qty: 1600, // 100 lbs = 1600 oz
        unitId: units.ounce.id,
        sortOrder: 0,
      },
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaWater.id,
        qty: 960, // 60 lbs = 960 oz
        unitId: units.ounce.id,
        sortOrder: 1,
      },
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaSalt.id,
        qty: 32, // 2 lbs = 32 oz
        unitId: units.ounce.id,
        sortOrder: 2,
      },
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaYeast.id,
        qty: 24, // 1.5 lbs = 24 oz
        unitId: units.ounce.id,
        sortOrder: 3,
      },
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaOliveOil.id,
        qty: 32, // 2 lbs = 32 oz
        unitId: units.ounce.id,
        sortOrder: 4,
      },
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaSugar.id,
        qty: 16, // 1 lb = 16 oz
        unitId: units.ounce.id,
        sortOrder: 5,
      },
    ]);
    
    console.log("✅ Created Pizza Dough recipe with 6 ingredients (measured in ounces)");
  }
}

// Create sample inventory count sessions for Store 2 to demonstrate multi-location inventory
async function seedStore2Counts(adminUserId: string, store2Id: string) {
  // Check if Store 2 counts already exist
  const existingStore2Counts = await storage.getInventoryCounts(store2Id);
  if (existingStore2Counts.length > 0) {
    console.log("📊 Store 2 inventory count sessions already exist");
    return;
  }

  // Create a sample count session for Store 2 from October 1, 2025
  const oct1Date = new Date("2025-10-01T09:00:00");
  await storage.createInventoryCount({
    userId: adminUserId,
    storageLocationId: store2Id,
    countDate: oct1Date,
    note: "Monthly count - Store 2"
  });

  // Create another count session for Store 2 from October 8, 2025
  const oct8Date = new Date("2025-10-08T09:00:00");
  await storage.createInventoryCount({
    userId: adminUserId,
    storageLocationId: store2Id,
    countDate: oct8Date,
    note: "Weekly count - Store 2"
  });

  console.log("📊 Created 2 inventory count sessions for Store 2");
}

export async function seedDatabase() {
  console.log("🌱 Seeding database with pizza restaurant data...");

  // Seed comprehensive kitchen units first (imperial + metric)
  await seedKitchenUnits();

  // Ensure global admin user exists
  let adminUser = await storage.getUserByEmail("admin@pizza.com");
  if (!adminUser) {
    console.log("👤 Creating global admin user...");
    const passwordHash = await hashPassword("admin123");
    adminUser = await storage.createUser({
      email: "admin@pizza.com",
      passwordHash,
      role: "global_admin",
      companyId: null,
    });
    console.log("✅ Global admin user created (email: admin@pizza.com, password: admin123)");
  }

  // Check if database is already seeded
  const existingUnits = await storage.getUnits();
  const alreadySeeded = existingUnits.length > 0;
  
  if (alreadySeeded) {
    console.log("✅ Database already seeded");
    // ============ BRIAN'S PIZZA SETUP (Always runs) ============
    await seedBriansPizza();
    return;
  }

  // ============ UNITS ============
  // Base unit for weight: pound (imperial) / kilogram (metric)
  // Base unit for volume: fluid ounce (imperial) / milliliter (metric)
  // ============ UNIT CONVERSIONS ============
  console.log("🔄 Creating unit conversions...");
  
  // Query comprehensive units created earlier for use in conversions
  const allUnits = await storage.getUnits();
  const findUnit = (name: string) => allUnits.find(u => u.name === name);
  
  const pound = findUnit("pound");
  const ounce = findUnit("ounce (weight)"); // Note: comprehensive seed uses "ounce (weight)"
  const tablespoon = findUnit("tablespoon");
  const halfTablespoon = findUnit("half-tablespoon");
  const teaspoon = findUnit("teaspoon");
  const halfTeaspoon = findUnit("half-teaspoon");
  const cup = findUnit("cup");
  const halfCup = findUnit("half-cup");
  const quarterCup = findUnit("quarter-cup");
  const pint = findUnit("pint");
  const quart = findUnit("quart");
  const gallon = findUnit("gallon");
  
  // Only create conversions if units exist
  if (pound && ounce) {
    // 1 pound = 16 ounces
    await storage.createUnitConversion({
      fromUnitId: pound.id,
      toUnitId: ounce.id,
      conversionFactor: 16,
    });
  }

  if (tablespoon && teaspoon) {
    // 1 tablespoon = 3 teaspoons
    await storage.createUnitConversion({
      fromUnitId: tablespoon.id,
      toUnitId: teaspoon.id,
      conversionFactor: 3,
    });
  }

  if (cup && tablespoon) {
    // 1 cup = 16 tablespoons
    await storage.createUnitConversion({
      fromUnitId: cup.id,
      toUnitId: tablespoon.id,
      conversionFactor: 16,
    });
  }

  if (pint && cup) {
    // 1 pint = 2 cups
    await storage.createUnitConversion({
      fromUnitId: pint.id,
      toUnitId: cup.id,
      conversionFactor: 2,
    });
  }

  if (quart && pint) {
    // 1 quart = 2 pints
    await storage.createUnitConversion({
      fromUnitId: quart.id,
      toUnitId: pint.id,
      conversionFactor: 2,
    });
  }

  if (quart && cup) {
    // 1 quart = 4 cups
    await storage.createUnitConversion({
      fromUnitId: quart.id,
      toUnitId: cup.id,
      conversionFactor: 4,
    });
  }

  if (gallon && quart) {
    // 1 gallon = 4 quarts
    await storage.createUnitConversion({
      fromUnitId: gallon.id,
      toUnitId: quart.id,
      conversionFactor: 4,
    });
  }

  if (gallon && cup) {
    // 1 gallon = 16 cups
    await storage.createUnitConversion({
      fromUnitId: gallon.id,
      toUnitId: cup.id,
      conversionFactor: 16,
    });
  }

  console.log("✅ Unit conversions created!");

  // ============ COMPANY & STORES ============
  console.log("🏢 Creating Brian's Pizza company and stores...");
  
  // Check if Brian's Pizza already exists
  const existingCompanies = await db.select().from(companies).where(eq(companies.name, "Brian's Pizza"));
  let briansPizza;
  if (existingCompanies.length > 0) {
    briansPizza = existingCompanies[0];
    console.log("✅ Brian's Pizza company already exists");
  } else {
    const result = await db.insert(companies).values({
      name: "Brian's Pizza",
      legalName: "Brian's Pizza LLC",
      contactEmail: "brian@brianspizza.com",
      status: "active",
    }).returning();
    briansPizza = result[0];
    console.log("✅ Created Brian's Pizza company");
  }

  // Create default categories for Brian's Pizza
  const categoriesCreated = await createDefaultCategories(briansPizza.id);
  if (categoriesCreated) {
    console.log("✅ Created default categories for Brian's Pizza");
  }

  // Create stores for Brian's Pizza
  const existingStores = await db.select().from(companyStores).where(eq(companyStores.companyId, briansPizza.id));
  let store1, store2;
  
  if (existingStores.length === 0) {
    const stores = await db.insert(companyStores).values([
      {
        companyId: briansPizza.id,
        code: "S001",
        name: "Downtown Location",
        status: "active",
      },
      {
        companyId: briansPizza.id,
        code: "S002",
        name: "Airport Location",
        status: "active",
      }
    ]).returning();
    store1 = stores[0];
    store2 = stores[1];
    console.log("✅ Created 2 stores for Brian's Pizza");
    
    // Create storage locations for each store
    await db.insert(storeStorageLocations).values([
      { storeId: store1.id, name: "Walk-In Cooler", type: "cooler", isDefault: 1, sortOrder: 1 },
      { storeId: store1.id, name: "Dry Storage", type: "dry_storage", isDefault: 0, sortOrder: 2 },
      { storeId: store1.id, name: "Freezer", type: "freezer", isDefault: 0, sortOrder: 3 },
      { storeId: store2.id, name: "Walk-In Cooler", type: "cooler", isDefault: 1, sortOrder: 1 },
      { storeId: store2.id, name: "Dry Storage", type: "dry_storage", isDefault: 0, sortOrder: 2 },
      { storeId: store2.id, name: "Freezer", type: "freezer", isDefault: 0, sortOrder: 3 },
    ]);
    console.log("✅ Created storage locations for both stores");
  } else {
    store1 = existingStores[0];
    store2 = existingStores.length > 1 ? existingStores[1] : store1;
    console.log("✅ Brian's Pizza stores already exist");
  }

  // ============ PIZZA DOUGH INGREDIENTS ============
  console.log("🍕 Creating pizza dough ingredients for Brian's Pizza...");
  
  // Create vendors for Brian's Pizza
  const briansMiscVendor = await db.insert(vendors).values({
    companyId: briansPizza.id,
    name: "Misc Grocery",
    orderGuideType: "manual",
  }).returning().catch(() => []);
  
  // Check if ingredients already exist
  const existingItems = await db.select().from(inventoryItems)
    .where(eq(inventoryItems.companyId, briansPizza.id));
  
  let pizzaFlour, pizzaYeast, pizzaSalt, pizzaWater, pizzaOliveOil, pizzaSugar;
  
  if (existingItems.length === 0) {
    // Create pizza dough ingredients with $2/lb cost and 95% yield
    const doughIngredients = await db.insert(inventoryItems).values([
      {
        companyId: briansPizza.id,
        name: "Bread Flour",
        unitId: units.pound.id,
        pricePerUnit: 2, // $2/lb as requested
        yieldPercent: 95, // 95% yield as requested
        caseSize: 50, // 50 lb bag
        active: 1,
      },
      {
        companyId: briansPizza.id,
        name: "Active Dry Yeast",
        unitId: units.pound.id,
        pricePerUnit: 2, // $2/lb
        yieldPercent: 95, // 95% yield
        caseSize: 1,
        active: 1,
      },
      {
        companyId: briansPizza.id,
        name: "Kosher Salt",
        unitId: units.pound.id,
        pricePerUnit: 2, // $2/lb
        yieldPercent: 95, // 95% yield
        caseSize: 3,
        active: 1,
      },
      {
        companyId: briansPizza.id,
        name: "Water",
        unitId: units.pound.id, // Water measured in lbs for baking
        pricePerUnit: 2, // $2/lb
        yieldPercent: 95, // 95% yield
        caseSize: 8, // 8 lb gallon
        active: 1,
      },
      {
        companyId: briansPizza.id,
        name: "Extra Virgin Olive Oil",
        unitId: units.pound.id,
        pricePerUnit: 2, // $2/lb
        yieldPercent: 95, // 95% yield
        caseSize: 2,
        active: 1,
      },
      {
        companyId: briansPizza.id,
        name: "Granulated Sugar",
        unitId: units.pound.id,
        pricePerUnit: 2, // $2/lb
        yieldPercent: 95, // 95% yield
        caseSize: 10,
        active: 1,
      },
    ]).returning();
    
    pizzaFlour = doughIngredients[0];
    pizzaYeast = doughIngredients[1];
    pizzaSalt = doughIngredients[2];
    pizzaWater = doughIngredients[3];
    pizzaOliveOil = doughIngredients[4];
    pizzaSugar = doughIngredients[5];
    
    // Link ingredients to stores
    await db.insert(storeInventoryItems).values([
      // Store 1
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaFlour.id, onHandQty: 500, active: 1 },
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaYeast.id, onHandQty: 10, active: 1 },
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaSalt.id, onHandQty: 20, active: 1 },
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaWater.id, onHandQty: 0, active: 1 },
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaOliveOil.id, onHandQty: 15, active: 1 },
      { companyId: briansPizza.id, storeId: store1.id, inventoryItemId: pizzaSugar.id, onHandQty: 25, active: 1 },
      // Store 2
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaFlour.id, onHandQty: 300, active: 1 },
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaYeast.id, onHandQty: 8, active: 1 },
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaSalt.id, onHandQty: 15, active: 1 },
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaWater.id, onHandQty: 0, active: 1 },
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaOliveOil.id, onHandQty: 10, active: 1 },
      { companyId: briansPizza.id, storeId: store2.id, inventoryItemId: pizzaSugar.id, onHandQty: 20, active: 1 },
    ]);
    
    console.log("✅ Created 6 pizza dough ingredients");
  } else {
    console.log("✅ Pizza dough ingredients already exist");
    pizzaFlour = existingItems.find((i: any) => i.name === "Bread Flour");
    pizzaYeast = existingItems.find((i: any) => i.name === "Active Dry Yeast");
    pizzaSalt = existingItems.find((i: any) => i.name === "Kosher Salt");
    pizzaWater = existingItems.find((i: any) => i.name === "Water");
    pizzaOliveOil = existingItems.find((i: any) => i.name === "Extra Virgin Olive Oil");
    pizzaSugar = existingItems.find((i: any) => i.name === "Granulated Sugar");
  }

  // ============ PIZZA DOUGH RECIPE ============
  console.log("📝 Creating Pizza Dough recipe...");
  
  // Check if recipe already exists
  const existingRecipes = await db.select().from(recipes)
    .where(eq(recipes.companyId, briansPizza.id));
  
  if (existingRecipes.length === 0 && pizzaFlour && pizzaYeast && pizzaSalt && pizzaWater && pizzaOliveOil && pizzaSugar) {
    // Standard baker's percentages for pizza dough based on 100 lbs flour:
    // Flour: 100 lbs, Water: 60 lbs, Salt: 2 lbs, Yeast: 1.5 lbs, Olive Oil: 2 lbs, Sugar: 1 lb
    // Total yield: ~166.5 lbs of dough
    
    const pizzaDoughRecipe = await db.insert(recipes).values({
      companyId: briansPizza.id,
      name: "Pizza Dough (100 lb Batch)",
      yieldQty: 166.5, // Total weight of dough produced
      yieldUnitId: units.pound.id,
      computedCost: 0, // Will be calculated
    }).returning();
    
    const recipe = pizzaDoughRecipe[0];
    
    // Add recipe components in ounces (micro units as requested)
    await db.insert(recipeComponents).values([
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaFlour.id,
        qty: 1600, // 100 lbs = 1600 oz
        unitId: units.ounce.id,
        sortOrder: 0,
      },
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaWater.id,
        qty: 960, // 60 lbs = 960 oz
        unitId: units.ounce.id,
        sortOrder: 1,
      },
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaSalt.id,
        qty: 32, // 2 lbs = 32 oz
        unitId: units.ounce.id,
        sortOrder: 2,
      },
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaYeast.id,
        qty: 24, // 1.5 lbs = 24 oz
        unitId: units.ounce.id,
        sortOrder: 3,
      },
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaOliveOil.id,
        qty: 32, // 2 lbs = 32 oz
        unitId: units.ounce.id,
        sortOrder: 4,
      },
      {
        recipeId: recipe.id,
        componentType: "inventory_item",
        componentId: pizzaSugar.id,
        qty: 16, // 1 lb = 16 oz
        unitId: units.ounce.id,
        sortOrder: 5,
      },
    ]);
    
    console.log("✅ Created Pizza Dough recipe with 6 ingredients (measured in ounces)");
  } else {
    console.log("✅ Pizza Dough recipe already exists");
  }

  // ============ STORAGE LOCATIONS ============
  // Use default company for seeding
  const defaultCompanyId = "default-company";
  
  // Create Store 1 and Store 2 as separate locations for multi-location inventory
  const locations = {
    store1: await storage.createStorageLocation({ companyId: defaultCompanyId, name: "Store 1", sortOrder: 1 }),
    store2: await storage.createStorageLocation({ companyId: defaultCompanyId, name: "Store 2", sortOrder: 2 }),
    // Keep legacy locations for backward compatibility
    walkIn: await storage.createStorageLocation({ companyId: defaultCompanyId, name: "Walk-In Cooler", sortOrder: 3 }),
    dryStorage: await storage.createStorageLocation({ companyId: defaultCompanyId, name: "Pantry", sortOrder: 4 }),
    prepTable: await storage.createStorageLocation({ companyId: defaultCompanyId, name: "Prep Table", sortOrder: 5 }),
  };

  // ============ VENDORS ============
  const vendors = {
    miscGrocery: await storage.createVendor({ 
      name: "Misc Grocery", 
      orderGuideType: "manual" 
    }),
    sysco: await storage.createVendor({ name: "Sysco", accountNumber: "SYS-12345" }),
    usFoods: await storage.createVendor({ name: "US Foods", accountNumber: "USF-67890" }),
  };

  // ============ INVENTORY ITEMS ============
  // Dough & Base Ingredients
  const flour = await storage.createInventoryItem({
    name: "Bread Flour",
    category: "Dry/Pantry",
    pluSku: "DRY001",
    unitId: units.pound.id,
    storageLocationId: locations.dryStorage.id,
    barcode: "8901234567890",
    active: 1,
    pricePerUnit: 1, // $1 per lb (case cost: $50 for 50 lb bag)
    caseSize: 50, // 50 lb bag
    onHandQty: 0,
  });

  const yeast = await storage.createInventoryItem({
    name: "Active Dry Yeast",
    category: "Dry/Pantry",
    pluSku: "DRY002",
    unitId: units.pound.id,
    storageLocationId: locations.dryStorage.id,
    active: 1,
    pricePerUnit: 20, // $20 per lb (case cost: $20 for 1 lb package)
    caseSize: 1,
    onHandQty: 0,
  });

  const water = await storage.createInventoryItem({
    name: "Water",
    category: "Beverages",
    pluSku: "BEV001",
    unitId: units.fluidOunce.id,
    storageLocationId: locations.dryStorage.id,
    active: 1,
    pricePerUnit: 0.01, // $0.01 per fl oz (case cost: $1.28 for 128 oz gallon)
    caseSize: 128,
    onHandQty: 0,
  });

  const oliveOil = await storage.createInventoryItem({
    name: "Extra Virgin Olive Oil",
    category: "Oils",
    pluSku: "OIL001",
    unitId: units.fluidOunce.id,
    storageLocationId: locations.dryStorage.id,
    active: 1,
    pricePerUnit: 0.44, // $0.44 per fl oz (case cost: $15 for 33.8 oz liter)
    caseSize: 33.8,
    onHandQty: 0,
  });

  const salt = await storage.createInventoryItem({
    name: "Kosher Salt",
    category: "Dry/Pantry",
    pluSku: "DRY003",
    unitId: units.pound.id,
    storageLocationId: locations.dryStorage.id,
    active: 1,
    pricePerUnit: 2, // $2 per lb (case cost: $6 for 3 lb box)
    caseSize: 3,
    onHandQty: 0,
  });

  const sugar = await storage.createInventoryItem({
    name: "Granulated Sugar",
    category: "Dry/Pantry",
    pluSku: "DRY004",
    unitId: units.pound.id,
    storageLocationId: locations.dryStorage.id,
    active: 1,
    pricePerUnit: 1.5, // $1.50 per lb (case cost: $15 for 10 lb bag)
    caseSize: 10,
    onHandQty: 0,
  });

  // Sauce Ingredients
  const crushedTomatoes = await storage.createInventoryItem({
    name: "Crushed Tomatoes (San Marzano)",
    category: "Dry/Pantry",
    pluSku: "CAN001",
    unitId: units.pound.id,
    storageLocationId: locations.dryStorage.id,
    active: 1,
    pricePerUnit: 4, // $4 per lb (case cost: $26 for 6.5 lb can)
    caseSize: 6.5,
    onHandQty: 0,
  });

  // Cheese & Toppings
  const mozzarella = await storage.createInventoryItem({
    name: "Whole Milk Mozzarella",
    category: "Dairy",
    pluSku: "DAI001",
    unitId: units.pound.id,
    storageLocationId: locations.walkIn.id,
    active: 1,
    pricePerUnit: 11, // $11 per lb (case cost: $55 for 5 lb bag)
    caseSize: 5,
    onHandQty: 0,
  });

  const pepperoni = await storage.createInventoryItem({
    name: "Pepperoni Slices",
    category: "Protein",
    pluSku: "MEA001",
    unitId: units.pound.id,
    storageLocationId: locations.walkIn.id,
    active: 1,
    pricePerUnit: 15, // $15 per lb (case cost: $75 for 5 lb bag)
    caseSize: 5,
    onHandQty: 0,
  });

  // ============ VENDOR ITEMS ============
  // Sysco items
  await storage.createVendorItem({
    vendorId: vendors.sysco.id,
    inventoryItemId: flour.id,
    vendorSku: "SYS-FL-50LB",
    purchaseUnitId: units.pound.id,
    caseSize: 50,
    lastPrice: 32.50,
    active: 1,
  });

  await storage.createVendorItem({
    vendorId: vendors.sysco.id,
    inventoryItemId: mozzarella.id,
    vendorSku: "SYS-MZ-5LB",
    purchaseUnitId: units.pound.id,
    caseSize: 5,
    lastPrice: 28.75,
    active: 1,
  });

  await storage.createVendorItem({
    vendorId: vendors.sysco.id,
    inventoryItemId: pepperoni.id,
    vendorSku: "SYS-PEP-10LB",
    purchaseUnitId: units.pound.id,
    caseSize: 10,
    lastPrice: 68.00,
    active: 1,
  });

  // US Foods items
  await storage.createVendorItem({
    vendorId: vendors.usFoods.id,
    inventoryItemId: crushedTomatoes.id,
    vendorSku: "USF-TOM-6CAN",
    purchaseUnitId: units.pound.id,
    caseSize: 6,
    innerPackSize: 28,
    lastPrice: 24.00,
    active: 1,
  });

  await storage.createVendorItem({
    vendorId: vendors.usFoods.id,
    inventoryItemId: oliveOil.id,
    vendorSku: "USF-OIL-1GAL",
    purchaseUnitId: units.fluidOunce.id,
    caseSize: 128, // 1 gallon = 128 fluid ounces
    lastPrice: 45.00,
    active: 1,
  });

  // ============ RECIPES ============
  // Pizza Dough (nested recipe)
  const pizzaDough = await storage.createRecipe({
    name: "Pizza Dough",
    yieldQty: 1,
    yieldUnitId: units.pound.id,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "inventory_item",
    componentId: flour.id,
    qty: 18,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "inventory_item",
    componentId: water.id,
    qty: 11,
    unitId: units.fluidOunce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "inventory_item",
    componentId: yeast.id,
    qty: 0.25,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "inventory_item",
    componentId: salt.id,
    qty: 0.35,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "inventory_item",
    componentId: sugar.id,
    qty: 0.18,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "inventory_item",
    componentId: oliveOil.id,
    qty: 0.5,
    unitId: units.fluidOunce.id,
  });


  console.log('   - 8 inventory items');
  console.log('   - 1 recipe (Pizza Dough)');
}
