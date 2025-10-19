import { storage } from "./storage";
import { hashPassword } from "./auth";
import { db } from "./db";
import { companies, companyStores, storeStorageLocations, inventoryItems, storeInventoryItems, vendors, recipes, recipeComponents } from "@shared/schema";

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
      wastePercent: 0,
      computedCost: 0,
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
  const units = {
    // Weight - Imperial (base: pound)
    pound: await storage.createUnit({ name: "pound", kind: "weight", toBaseRatio: 1, system: "imperial" }),
    ounce: await storage.createUnit({ name: "ounce", kind: "weight", toBaseRatio: 0.0625, system: "imperial" }), // 1 oz = 0.0625 lb
    
    // Weight - Metric (base: pound for conversion)
    gram: await storage.createUnit({ name: "gram", kind: "weight", toBaseRatio: 0.00220462, system: "metric" }), // 1 g = 0.00220462 lb
    kilogram: await storage.createUnit({ name: "kilogram", kind: "weight", toBaseRatio: 2.20462, system: "metric" }), // 1 kg = 2.20462 lb
    
    // Volume - Imperial (base: fluid ounce)
    fluidOunce: await storage.createUnit({ name: "fluid ounce", kind: "volume", toBaseRatio: 1, system: "imperial" }),
    cup: await storage.createUnit({ name: "cup", kind: "volume", toBaseRatio: 8, system: "imperial" }),
    tablespoon: await storage.createUnit({ name: "tablespoon", kind: "volume", toBaseRatio: 0.5, system: "imperial" }),
    teaspoon: await storage.createUnit({ name: "teaspoon", kind: "volume", toBaseRatio: 0.167, system: "imperial" }),
    
    // Volume - Metric (base: fluid ounce for conversion)
    milliliter: await storage.createUnit({ name: "milliliter", kind: "volume", toBaseRatio: 0.033814, system: "metric" }), // 1 ml = 0.033814 fl oz
    liter: await storage.createUnit({ name: "liter", kind: "volume", toBaseRatio: 33.814, system: "metric" }), // 1 L = 33.814 fl oz
    
    // Count (works for both systems)
    each: await storage.createUnit({ name: "each", kind: "count", toBaseRatio: 1, system: "both" }),
    bag: await storage.createUnit({ name: "bag", kind: "count", toBaseRatio: 1, system: "both" }),
    bottle: await storage.createUnit({ name: "bottle", kind: "count", toBaseRatio: 1, system: "both" }),
  };

  // ============ UNIT CONVERSIONS ============
  console.log("🔄 Creating unit conversions...");
  
  // 1 pound = 16 ounces
  await storage.createUnitConversion({
    fromUnitId: units.pound.id,
    toUnitId: units.ounce.id,
    conversionFactor: 16,
  });

  // 1 fluid ounce = 2 tablespoons
  await storage.createUnitConversion({
    fromUnitId: units.fluidOunce.id,
    toUnitId: units.tablespoon.id,
    conversionFactor: 2,
  });

  // 1 cup = 8 fluid ounces
  await storage.createUnitConversion({
    fromUnitId: units.cup.id,
    toUnitId: units.fluidOunce.id,
    conversionFactor: 8,
  });

  // 1 pint = 2 cups (or 16 fluid ounces)
  const pint = await storage.createUnit({ name: "pint", kind: "volume", toBaseRatio: 16, system: "imperial" });
  await storage.createUnitConversion({
    fromUnitId: pint.id,
    toUnitId: units.cup.id,
    conversionFactor: 2,
  });
  await storage.createUnitConversion({
    fromUnitId: pint.id,
    toUnitId: units.fluidOunce.id,
    conversionFactor: 16,
  });

  // 1 quart = 2 pints (or 32 fluid ounces)
  const quart = await storage.createUnit({ name: "quart", kind: "volume", toBaseRatio: 32, system: "imperial" });
  await storage.createUnitConversion({
    fromUnitId: quart.id,
    toUnitId: pint.id,
    conversionFactor: 2,
  });
  await storage.createUnitConversion({
    fromUnitId: quart.id,
    toUnitId: units.fluidOunce.id,
    conversionFactor: 32,
  });

  // 1 gallon = 4 quarts (or 128 fluid ounces)
  const gallon = await storage.createUnit({ name: "gallon", kind: "volume", toBaseRatio: 128, system: "imperial" });
  await storage.createUnitConversion({
    fromUnitId: gallon.id,
    toUnitId: quart.id,
    conversionFactor: 4,
  });
  await storage.createUnitConversion({
    fromUnitId: gallon.id,
    toUnitId: units.fluidOunce.id,
    conversionFactor: 128,
  });

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
      wastePercent: 0,
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

  // TODO: Convert remaining products to inventory items
  // Temporarily commented out pending conversion
  /* 
  const tomatoPaste = await storage.createProduct({
    name: "Tomato Paste",
    category: "Dry/Pantry",
    pluSku: "CAN002",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.006, // $0.006 per ounce
    yieldAmount: 0.375, // 6 oz can
    yieldUnitId: units.pound.id,
  });

  const garlic = await storage.createProduct({
    name: "Fresh Garlic",
    category: "Produce",
    pluSku: "PRO001",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.01, // $0.01 per ounce
    yieldAmount: 1, // 1 lb bag
    yieldUnitId: units.pound.id,
  });

  const basil = await storage.createProduct({
    name: "Fresh Basil",
    category: "Produce",
    pluSku: "PRO002",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.03, // $0.03 per ounce
    yieldAmount: 0.25, // 4 oz package
    yieldUnitId: units.pound.id,
  });

  const oregano = await storage.createProduct({
    name: "Dried Oregano",
    category: "Dry/Pantry",
    pluSku: "SPI001",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.05, // $0.05 per ounce
    yieldAmount: 0.125, // 2 oz bottle
    yieldUnitId: units.pound.id,
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

  const parmesan = await storage.createProduct({
    name: "Grated Parmesan",
    category: "Dairy",
    pluSku: "DAI002",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.022, // $0.022 per ounce
    yieldAmount: 2, // 2 lb container
    yieldUnitId: units.pound.id,
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

  const italianSausage = await storage.createProduct({
    name: "Italian Sausage (bulk)",
    category: "Protein",
    pluSku: "MEA002",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.013, // $0.013 per ounce
    yieldAmount: 5, // 5 lb package
    yieldUnitId: units.pound.id,
  });

  const chickenBreast = await storage.createProduct({
    name: "Chicken Breast",
    category: "Protein",
    pluSku: "MEA003",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.012, // $0.012 per ounce
    yieldAmount: 10, // 10 lb bag
    yieldUnitId: units.pound.id,
  });

  const bellPeppers = await storage.createProduct({
    name: "Bell Peppers (mixed)",
    category: "Produce",
    pluSku: "PRO003",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.007, // $0.007 per ounce
    yieldAmount: 1, // sold by pound
    yieldUnitId: units.pound.id,
  });

  const mushrooms = await storage.createProduct({
    name: "Button Mushrooms",
    category: "Produce",
    pluSku: "PRO004",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.009, // $0.009 per ounce
    yieldAmount: 1, // 1 lb package
    yieldUnitId: units.pound.id,
  });

  const onions = await storage.createProduct({
    name: "Yellow Onions",
    category: "Produce",
    pluSku: "PRO005",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.003, // $0.003 per ounce
    yieldAmount: 1, // sold by pound
    yieldUnitId: units.pound.id,
  });

  const blackOlives = await storage.createProduct({
    name: "Sliced Black Olives",
    category: "Dry/Pantry",
    pluSku: "CAN003",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.008, // $0.008 per ounce
    yieldAmount: 0.375, // 6 oz can
    yieldUnitId: units.pound.id,
  });

  // Sauces & Specialty
  const bbqSauce = await storage.createProduct({
    name: "BBQ Sauce (Sweet Baby Ray's)",
    category: "Sauces",
    pluSku: "SAU001",
    unitId: units.fluidOunce.id,
    active: 1,
    lastCost: 0.008,
  });

  const ranchDressing = await storage.createProduct({
    name: "Ranch Dressing",
    category: "Sauces",
    pluSku: "SAU002",
    unitId: units.fluidOunce.id,
    active: 1,
    lastCost: 0.006,
  });

  // Wings & Appetizers
  const chickenWings = await storage.createProduct({
    name: "Chicken Wings (frozen)",
    category: "Protein",
    pluSku: "MEA004",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.01, // $0.01 per ounce
    yieldAmount: 10, // 10 lb bag
    yieldUnitId: units.pound.id,
  });

  const breadstickDough = await storage.createProduct({
    name: "Breadstick Dough",
    category: "Dry/Pantry",
    pluSku: "FRO001",
    unitId: units.pound.id,
    active: 1,
    lastCost: 0.005, // $0.005 per ounce
    yieldAmount: 1, // 1 lb package
    yieldUnitId: units.pound.id,
  });

  const mozzarellaSticks = await storage.createProduct({
    name: "Mozzarella Sticks (frozen)",
    category: "Dry/Pantry",
    pluSku: "FRO002",
    unitId: units.each.id,
    active: 1,
    lastCost: 0.35,
    yieldAmount: 24, // 24 pieces per bag
    yieldUnitId: units.each.id,
  });

  const marinara = await storage.createProduct({
    name: "Marinara Dipping Sauce",
    category: "Sauces",
    pluSku: "SAU003",
    unitId: units.fluidOunce.id,
    active: 1,
    lastCost: 0.004,
  });

  */

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
    inventoryItemId: chickenWings.id,
    vendorSku: "USF-WING-10LB",
    purchaseUnitId: units.pound.id,
    caseSize: 10,
    lastPrice: 42.50,
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
    wastePercent: 2,
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

  // Marinara Sauce (nested recipe)
  const marinaraSauce = await storage.createRecipe({
    name: "Marinara Pizza Sauce",
    yieldQty: 1,
    yieldUnitId: units.cup.id,
    wastePercent: 1,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "inventory_item",
    componentId: crushedTomatoes.id,
    qty: 14,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "inventory_item",
    componentId: tomatoPaste.id,
    qty: 2,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "inventory_item",
    componentId: garlic.id,
    qty: 0.35,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "inventory_item",
    componentId: basil.id,
    qty: 0.18,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "inventory_item",
    componentId: oregano.id,
    qty: 0.07,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "inventory_item",
    componentId: oliveOil.id,
    qty: 0.68,
    unitId: units.fluidOunce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "inventory_item",
    componentId: salt.id,
    qty: 3,
    unitId: units.ounce.id,
  });

  // Margherita Pizza
  const margheritaPizza = await storage.createRecipe({
    name: "Margherita Pizza",
    yieldQty: 1,
    yieldUnitId: units.each.id,
    wastePercent: 3,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "recipe",
    componentId: pizzaDough.id,
    qty: 280,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "recipe",
    componentId: marinaraSauce.id,
    qty: 80,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "inventory_item",
    componentId: mozzarella.id,
    qty: 120,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "inventory_item",
    componentId: basil.id,
    qty: 3,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "inventory_item",
    componentId: parmesan.id,
    qty: 10,
    unitId: units.ounce.id,
  });

  // Pepperoni Pizza
  const pepperoniPizza = await storage.createRecipe({
    name: "Pepperoni Pizza",
    yieldQty: 1,
    yieldUnitId: units.each.id,
    wastePercent: 3,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: pepperoniPizza.id,
    componentType: "recipe",
    componentId: pizzaDough.id,
    qty: 280,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pepperoniPizza.id,
    componentType: "recipe",
    componentId: marinaraSauce.id,
    qty: 80,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pepperoniPizza.id,
    componentType: "inventory_item",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pepperoniPizza.id,
    componentType: "inventory_item",
    componentId: pepperoni.id,
    qty: 60,
    unitId: units.ounce.id,
  });

  // Supreme Pizza
  const supremePizza = await storage.createRecipe({
    name: "Supreme Pizza",
    yieldQty: 1,
    yieldUnitId: units.each.id,
    wastePercent: 3,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "recipe",
    componentId: pizzaDough.id,
    qty: 280,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "recipe",
    componentId: marinaraSauce.id,
    qty: 80,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "inventory_item",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "inventory_item",
    componentId: pepperoni.id,
    qty: 40,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "inventory_item",
    componentId: italianSausage.id,
    qty: 40,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "inventory_item",
    componentId: bellPeppers.id,
    qty: 30,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "inventory_item",
    componentId: mushrooms.id,
    qty: 30,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "inventory_item",
    componentId: onions.id,
    qty: 20,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "inventory_item",
    componentId: blackOlives.id,
    qty: 20,
    unitId: units.ounce.id,
  });

  // BBQ Chicken Pizza
  const bbqChickenPizza = await storage.createRecipe({
    name: "BBQ Chicken Pizza",
    yieldQty: 1,
    yieldUnitId: units.each.id,
    wastePercent: 3,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "recipe",
    componentId: pizzaDough.id,
    qty: 280,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "inventory_item",
    componentId: bbqSauce.id,
    qty: 60,
    unitId: units.fluidOunce.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "inventory_item",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "inventory_item",
    componentId: chickenBreast.id,
    qty: 100,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "inventory_item",
    componentId: onions.id,
    qty: 30,
    unitId: units.ounce.id,
  });

  // Veggie Pizza
  const veggiePizza = await storage.createRecipe({
    name: "Veggie Pizza",
    yieldQty: 1,
    yieldUnitId: units.each.id,
    wastePercent: 3,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "recipe",
    componentId: pizzaDough.id,
    qty: 280,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "recipe",
    componentId: marinaraSauce.id,
    qty: 80,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "inventory_item",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "inventory_item",
    componentId: bellPeppers.id,
    qty: 40,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "inventory_item",
    componentId: mushrooms.id,
    qty: 40,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "inventory_item",
    componentId: onions.id,
    qty: 30,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "inventory_item",
    componentId: blackOlives.id,
    qty: 30,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "inventory_item",
    componentId: basil.id,
    qty: 5,
    unitId: units.ounce.id,
  });

  // Chicken Wings
  const chickenWingsRecipe = await storage.createRecipe({
    name: "Chicken Wings (8pc)",
    yieldQty: 1,
    yieldUnitId: units.each.id,
    wastePercent: 5,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: chickenWingsRecipe.id,
    componentType: "inventory_item",
    componentId: chickenWings.id,
    qty: 400,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: chickenWingsRecipe.id,
    componentType: "inventory_item",
    componentId: ranchDressing.id,
    qty: 60,
    unitId: units.fluidOunce.id,
  });

  // Breadsticks
  const breadsticksRecipe = await storage.createRecipe({
    name: "Garlic Breadsticks (6pc)",
    yieldQty: 1,
    yieldUnitId: units.each.id,
    wastePercent: 2,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "inventory_item",
    componentId: breadstickDough.id,
    qty: 200,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "inventory_item",
    componentId: garlic.id,
    qty: 10,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "inventory_item",
    componentId: oliveOil.id,
    qty: 20,
    unitId: units.fluidOunce.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "inventory_item",
    componentId: parmesan.id,
    qty: 15,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "inventory_item",
    componentId: marinara.id,
    qty: 60,
    unitId: units.fluidOunce.id,
  });

  // Mozzarella Sticks
  const mozzSticksRecipe = await storage.createRecipe({
    name: "Mozzarella Sticks (6pc)",
    yieldQty: 1,
    yieldUnitId: units.each.id,
    wastePercent: 1,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: mozzSticksRecipe.id,
    componentType: "inventory_item",
    componentId: mozzarellaSticks.id,
    qty: 6,
    unitId: units.each.id,
  });

  await storage.createRecipeComponent({
    recipeId: mozzSticksRecipe.id,
    componentType: "inventory_item",
    componentId: marinara.id,
    qty: 60,
    unitId: units.fluidOunce.id,
  });

  // ============ MENU ITEMS ============
  await storage.createMenuItem({
    name: "Margherita Pizza",
    pluSku: "PIZZA-MARG",
    recipeId: margheritaPizza.id,
    servingSizeQty: 1,
    servingUnitId: units.each.id,
  });

  await storage.createMenuItem({
    name: "Pepperoni Pizza",
    pluSku: "PIZZA-PEP",
    recipeId: pepperoniPizza.id,
    servingSizeQty: 1,
    servingUnitId: units.each.id,
  });

  await storage.createMenuItem({
    name: "Supreme Pizza",
    pluSku: "PIZZA-SUP",
    recipeId: supremePizza.id,
    servingSizeQty: 1,
    servingUnitId: units.each.id,
  });

  await storage.createMenuItem({
    name: "BBQ Chicken Pizza",
    pluSku: "PIZZA-BBQ",
    recipeId: bbqChickenPizza.id,
    servingSizeQty: 1,
    servingUnitId: units.each.id,
  });

  await storage.createMenuItem({
    name: "Veggie Pizza",
    pluSku: "PIZZA-VEG",
    recipeId: veggiePizza.id,
    servingSizeQty: 1,
    servingUnitId: units.each.id,
  });

  await storage.createMenuItem({
    name: "Chicken Wings",
    pluSku: "APP-WINGS",
    recipeId: chickenWingsRecipe.id,
    servingSizeQty: 1,
    servingUnitId: units.each.id,
  });

  await storage.createMenuItem({
    name: "Garlic Breadsticks",
    pluSku: "APP-BREAD",
    recipeId: breadsticksRecipe.id,
    servingSizeQty: 1,
    servingUnitId: units.each.id,
  });

  await storage.createMenuItem({
    name: "Mozzarella Sticks",
    pluSku: "APP-MOZZ",
    recipeId: mozzSticksRecipe.id,
    servingSizeQty: 1,
    servingUnitId: units.each.id,
  });

  // ============ INITIAL INVENTORY ============
  await storage.updateInventoryLevel(flour.id, locations.dryStorage.id, 10000);
  await storage.updateInventoryLevel(mozzarella.id, locations.walkIn.id, 5000);
  await storage.updateInventoryLevel(pepperoni.id, locations.walkIn.id, 2000);
  await storage.updateInventoryLevel(crushedTomatoes.id, locations.dryStorage.id, 3000);
  await storage.updateInventoryLevel(chickenWings.id, locations.walkIn.id, 4000);
  await storage.updateInventoryLevel(oliveOil.id, locations.dryStorage.id, 2000);

  // ============ 7-DAY POS SIMULATION ============
  const menuItemPLUs = [
    { plu: "PIZZA-MARG", avgDaily: 15 },
    { plu: "PIZZA-PEP", avgDaily: 25 },
    { plu: "PIZZA-SUP", avgDaily: 20 },
    { plu: "PIZZA-BBQ", avgDaily: 12 },
    { plu: "PIZZA-VEG", avgDaily: 10 },
    { plu: "APP-WINGS", avgDaily: 18 },
    { plu: "APP-BREAD", avgDaily: 22 },
    { plu: "APP-MOZZ", avgDaily: 14 },
  ];

  const now = new Date();
  for (let day = 0; day < 7; day++) {
    const saleDate = new Date(now);
    saleDate.setDate(saleDate.getDate() - (7 - day));

    const sale = await storage.createPOSSale({ storeId: "main" });
    sale.occurredAt = saleDate;

    for (const item of menuItemPLUs) {
      const variance = Math.floor(Math.random() * 7) - 3;
      const qty = Math.max(1, item.avgDaily + variance);

      await storage.createPOSSalesLine({
        posSalesId: sale.id,
        pluSku: item.plu,
        qtySold: qty,
      });
    }
  }

  // ============ STORE 2 INVENTORY COUNTS ============
  await seedStore2Counts(adminUser.id, locations.store2.id);

  console.log("✅ Database seeded successfully!");
  console.log("📊 Created:");
  console.log("   - 13 units");
  console.log("   - 4 storage locations (Store 1, Store 2, Walk-In Cooler, Pantry)");
  console.log("   - 2 vendors");
  console.log("   - 25+ products");
  console.log("   - 6 vendor products");
  console.log("   - 10 recipes (2 nested)");
  console.log("   - 8 menu items");
  console.log("   - 7 days of POS sales");
  console.log("   - 2 Store 2 inventory count sessions");
}
