import { storage } from "./storage";
import { hashPassword } from "./auth";

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

  // Ensure admin user exists
  let adminUser = await storage.getUserByEmail("admin@pizza.com");
  if (!adminUser) {
    console.log("👤 Creating admin user...");
    const passwordHash = await hashPassword("admin123");
    adminUser = await storage.createUser({
      email: "admin@pizza.com",
      passwordHash,
      role: "admin",
    });
    console.log("✅ Admin user created (email: admin@pizza.com, password: admin123)");
  }

  // Check if database is already seeded
  const existingUnits = await storage.getUnits();
  const alreadySeeded = existingUnits.length > 0;
  
  if (alreadySeeded) {
    console.log("✅ Database already seeded, checking for September counts...");
    
    // Check if September counts exist
    const existingCounts = await storage.getInventoryCounts();
    if (existingCounts.length === 0) {
      console.log("📊 Adding September 2025 inventory counts...");
      await seedSeptemberCounts();
      console.log("✅ September inventory counts added!");
    }
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

  // ============ STORAGE LOCATIONS ============
  // Create Store 1 and Store 2 as separate locations for multi-location inventory
  const locations = {
    store1: await storage.createStorageLocation({ name: "Store 1", sortOrder: 1 }),
    store2: await storage.createStorageLocation({ name: "Store 2", sortOrder: 2 }),
    // Keep legacy locations for backward compatibility
    walkIn: await storage.createStorageLocation({ name: "Walk-In Cooler", sortOrder: 3 }),
    dryStorage: await storage.createStorageLocation({ name: "Dry Storage", sortOrder: 4 }),
    prepTable: await storage.createStorageLocation({ name: "Prep Table", sortOrder: 5 }),
  };

  // ============ VENDORS ============
  const vendors = {
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
  console.log("   - 4 storage locations (Store 1, Store 2, Walk-In Cooler, Dry Storage)");
  console.log("   - 2 vendors");
  console.log("   - 25+ products");
  console.log("   - 6 vendor products");
  console.log("   - 10 recipes (2 nested)");
  console.log("   - 8 menu items");
  console.log("   - 7 days of POS sales");
  console.log("   - 2 Store 2 inventory count sessions");
}
