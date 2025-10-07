import { storage } from "./storage";
import { hashPassword } from "./auth";

async function seedSeptemberCounts() {
  // Get necessary entities
  const units = await storage.getUnits();
  const locations = await storage.getStorageLocations();
  const products = await storage.getProducts();
  const adminUser = await storage.getUserByEmail("admin@pizza.com");
  
  const pound = units.find(u => u.name === "pound");
  const walkIn = locations.find(l => l.name === "Walk-In Cooler");
  const mozzarella = products.find(p => p.name === "Whole Milk Mozzarella");
  const pepperoni = products.find(p => p.name === "Pepperoni Slices");
  const chickenWings = products.find(p => p.name === "Chicken Wings (frozen)");
  const sausage = products.find(p => p.name === "Italian Sausage (bulk)");
  const bellPeppers = products.find(p => p.name === "Bell Peppers (mixed)");
  const onions = products.find(p => p.name === "Yellow Onions");
  
  if (!pound || !walkIn || !mozzarella || !pepperoni || !chickenWings || !sausage || !bellPeppers || !onions || !adminUser) {
    console.log("⚠️  Required data not found for September counts");
    return;
  }
  
  const septemberCounts = [
    { date: new Date("2025-09-07T18:00:00"), note: "Weekly count - Walk-In Cooler" },
    { date: new Date("2025-09-14T18:00:00"), note: "Weekly count - Walk-In Cooler" },
    { date: new Date("2025-09-21T18:00:00"), note: "Weekly count - Walk-In Cooler" },
    { date: new Date("2025-09-28T18:00:00"), note: "Weekly count - Walk-In Cooler" },
  ];

  for (let i = 0; i < septemberCounts.length; i++) {
    const countData = septemberCounts[i];
    const count = await storage.createInventoryCount({
      storageLocationId: walkIn.id,
      userId: adminUser.id,
      note: countData.note,
    });
    
    count.countedAt = countData.date;
    
    const weekMultiplier = 1 - (i * 0.15);
    
    // Convert from ounces to pounds: 140 oz = 8.75 lb
    await storage.createInventoryCountLine({
      inventoryCountId: count.id,
      productId: mozzarella.id,
      qty: parseFloat((8.75 * weekMultiplier).toFixed(2)),
      unitId: pound.id,
      derivedMicroUnits: parseFloat((8.75 * weekMultiplier).toFixed(2)),
    });

    // 85 oz = 5.31 lb
    await storage.createInventoryCountLine({
      inventoryCountId: count.id,
      productId: pepperoni.id,
      qty: parseFloat((5.31 * weekMultiplier).toFixed(2)),
      unitId: pound.id,
      derivedMicroUnits: parseFloat((5.31 * weekMultiplier).toFixed(2)),
    });

    // 120 oz = 7.5 lb
    await storage.createInventoryCountLine({
      inventoryCountId: count.id,
      productId: chickenWings.id,
      qty: parseFloat((7.5 * weekMultiplier).toFixed(2)),
      unitId: pound.id,
      derivedMicroUnits: parseFloat((7.5 * weekMultiplier).toFixed(2)),
    });

    // 65 oz = 4.06 lb
    await storage.createInventoryCountLine({
      inventoryCountId: count.id,
      productId: sausage.id,
      qty: parseFloat((4.06 * weekMultiplier).toFixed(2)),
      unitId: pound.id,
      derivedMicroUnits: parseFloat((4.06 * weekMultiplier).toFixed(2)),
    });

    // 32 oz = 2 lb
    await storage.createInventoryCountLine({
      inventoryCountId: count.id,
      productId: bellPeppers.id,
      qty: parseFloat((2 * weekMultiplier).toFixed(2)),
      unitId: pound.id,
      derivedMicroUnits: parseFloat((2 * weekMultiplier).toFixed(2)),
    });

    // 28 oz = 1.75 lb
    await storage.createInventoryCountLine({
      inventoryCountId: count.id,
      productId: onions.id,
      qty: parseFloat((1.75 * weekMultiplier).toFixed(2)),
      unitId: pound.id,
      derivedMicroUnits: parseFloat((1.75 * weekMultiplier).toFixed(2)),
    });
  }
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
  // Base unit for weight: pound
  // Base unit for volume: fluid ounce
  const units = {
    // Weight (base: pound)
    pound: await storage.createUnit({ name: "pound", kind: "weight", toBaseRatio: 1 }),
    ounce: await storage.createUnit({ name: "ounce", kind: "weight", toBaseRatio: 0.0625 }), // 1 oz = 0.0625 lb
    
    // Volume (base: fluid ounce)
    fluidOunce: await storage.createUnit({ name: "fluid ounce", kind: "volume", toBaseRatio: 1 }),
    cup: await storage.createUnit({ name: "cup", kind: "volume", toBaseRatio: 8 }),
    tablespoon: await storage.createUnit({ name: "tablespoon", kind: "volume", toBaseRatio: 0.5 }),
    teaspoon: await storage.createUnit({ name: "teaspoon", kind: "volume", toBaseRatio: 0.167 }),
    
    // Count (base: each)
    each: await storage.createUnit({ name: "each", kind: "count", toBaseRatio: 1 }),
    bag: await storage.createUnit({ name: "bag", kind: "count", toBaseRatio: 1 }),
    bottle: await storage.createUnit({ name: "bottle", kind: "count", toBaseRatio: 1 }),
  };

  // ============ STORAGE LOCATIONS ============
  const locations = {
    walkIn: await storage.createStorageLocation({ name: "Walk-In Cooler", sortOrder: 1 }),
    dryStorage: await storage.createStorageLocation({ name: "Dry Storage", sortOrder: 2 }),
    prepTable: await storage.createStorageLocation({ name: "Prep Table", sortOrder: 3 }),
  };

  // ============ VENDORS ============
  const vendors = {
    sysco: await storage.createVendor({ name: "Sysco", accountNumber: "SYS-12345" }),
    usFoods: await storage.createVendor({ name: "US Foods", accountNumber: "USF-67890" }),
  };

  // ============ PRODUCTS ============
  // Dough & Base Ingredients
  const flour = await storage.createProduct({
    name: "Bread Flour",
    category: "Dry/Pantry",
    pluSku: "DRY001",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    barcode: "8901234567890",
    active: 1,
    lastCost: 0.016, // $0.016 per pound (was $0.001 per ounce * 16)
    yieldAmount: 50, // 50 lb bag
    yieldUnitId: units.pound.id,
  });

  const yeast = await storage.createProduct({
    name: "Active Dry Yeast",
    category: "Dry/Pantry",
    pluSku: "DRY002",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.32, // $0.32 per pound (was $0.02 per ounce * 16)
    yieldAmount: 1, // 1 lb package
    yieldUnitId: units.pound.id,
  });

  const water = await storage.createProduct({
    name: "Water",
    category: "Beverages",
    pluSku: "BEV001",
    baseUnitId: units.fluidOunce.id,
    microUnitId: units.fluidOunce.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.0001,
  });

  const oliveOil = await storage.createProduct({
    name: "Extra Virgin Olive Oil",
    category: "Oils",
    pluSku: "OIL001",
    baseUnitId: units.fluidOunce.id,
    microUnitId: units.fluidOunce.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.015,
  });

  const salt = await storage.createProduct({
    name: "Kosher Salt",
    category: "Dry/Pantry",
    pluSku: "DRY003",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.032, // $0.032 per pound (was $0.002 per ounce * 16)
    yieldAmount: 3, // 3 lb box
    yieldUnitId: units.pound.id,
  });

  const sugar = await storage.createProduct({
    name: "Granulated Sugar",
    category: "Dry/Pantry",
    pluSku: "DRY004",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.024, // $0.024 per pound (was $0.0015 per ounce * 16)
    yieldAmount: 10, // 10 lb bag
    yieldUnitId: units.pound.id,
  });

  // Sauce Ingredients
  const crushedTomatoes = await storage.createProduct({
    name: "Crushed Tomatoes (San Marzano)",
    category: "Dry/Pantry",
    pluSku: "CAN001",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.064, // $0.064 per pound (was $0.004 per ounce * 16)
    yieldAmount: 6.5, // 6.5 lb can (~106 oz)
    yieldUnitId: units.pound.id,
  });

  const tomatoPaste = await storage.createProduct({
    name: "Tomato Paste",
    category: "Dry/Pantry",
    pluSku: "CAN002",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.096, // $0.096 per pound (was $0.006 per ounce * 16)
    yieldAmount: 0.375, // 6 oz can
    yieldUnitId: units.pound.id,
  });

  const garlic = await storage.createProduct({
    name: "Fresh Garlic",
    category: "Produce",
    pluSku: "PRO001",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.16, // $0.16 per pound (was $0.01 per ounce * 16)
    yieldAmount: 1, // 1 lb bag
    yieldUnitId: units.pound.id,
  });

  const basil = await storage.createProduct({
    name: "Fresh Basil",
    category: "Produce",
    pluSku: "PRO002",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.48, // $0.48 per pound (was $0.03 per ounce * 16)
    yieldAmount: 0.25, // 4 oz package
    yieldUnitId: units.pound.id,
  });

  const oregano = await storage.createProduct({
    name: "Dried Oregano",
    category: "Dry/Pantry",
    pluSku: "SPI001",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.80, // $0.80 per pound (was $0.05 per ounce * 16)
    yieldAmount: 0.125, // 2 oz bottle
    yieldUnitId: units.pound.id,
  });

  // Cheese & Toppings
  const mozzarella = await storage.createProduct({
    name: "Whole Milk Mozzarella",
    category: "Dairy",
    pluSku: "DAI001",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.176, // $0.176 per pound (was $0.011 per ounce * 16)
    yieldAmount: 5, // 5 lb bag
    yieldUnitId: units.pound.id,
  });

  const parmesan = await storage.createProduct({
    name: "Grated Parmesan",
    category: "Dairy",
    pluSku: "DAI002",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.352, // $0.352 per pound (was $0.022 per ounce * 16)
    yieldAmount: 2, // 2 lb container
    yieldUnitId: units.pound.id,
  });

  const pepperoni = await storage.createProduct({
    name: "Pepperoni Slices",
    category: "Protein",
    pluSku: "MEA001",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.24, // $0.24 per pound (was $0.015 per ounce * 16)
    yieldAmount: 5, // 5 lb bag
    yieldUnitId: units.pound.id,
  });

  const italianSausage = await storage.createProduct({
    name: "Italian Sausage (bulk)",
    category: "Protein",
    pluSku: "MEA002",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.208, // $0.208 per pound (was $0.013 per ounce * 16)
    yieldAmount: 5, // 5 lb package
    yieldUnitId: units.pound.id,
  });

  const chickenBreast = await storage.createProduct({
    name: "Chicken Breast",
    category: "Protein",
    pluSku: "MEA003",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.192, // $0.192 per pound (was $0.012 per ounce * 16)
    yieldAmount: 10, // 10 lb bag
    yieldUnitId: units.pound.id,
  });

  const bellPeppers = await storage.createProduct({
    name: "Bell Peppers (mixed)",
    category: "Produce",
    pluSku: "PRO003",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.112, // $0.112 per pound (was $0.007 per ounce * 16)
    yieldAmount: 1, // sold by pound
    yieldUnitId: units.pound.id,
  });

  const mushrooms = await storage.createProduct({
    name: "Button Mushrooms",
    category: "Produce",
    pluSku: "PRO004",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.144, // $0.144 per pound (was $0.009 per ounce * 16)
    yieldAmount: 1, // 1 lb package
    yieldUnitId: units.pound.id,
  });

  const onions = await storage.createProduct({
    name: "Yellow Onions",
    category: "Produce",
    pluSku: "PRO005",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.048, // $0.048 per pound (was $0.003 per ounce * 16)
    yieldAmount: 1, // sold by pound
    yieldUnitId: units.pound.id,
  });

  const blackOlives = await storage.createProduct({
    name: "Sliced Black Olives",
    category: "Dry/Pantry",
    pluSku: "CAN003",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.128, // $0.128 per pound (was $0.008 per ounce * 16)
    yieldAmount: 0.375, // 6 oz can
    yieldUnitId: units.pound.id,
  });

  // Sauces & Specialty
  const bbqSauce = await storage.createProduct({
    name: "BBQ Sauce (Sweet Baby Ray's)",
    category: "Sauces",
    pluSku: "SAU001",
    baseUnitId: units.fluidOunce.id,
    microUnitId: units.fluidOunce.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.008,
  });

  const ranchDressing = await storage.createProduct({
    name: "Ranch Dressing",
    category: "Sauces",
    pluSku: "SAU002",
    baseUnitId: units.fluidOunce.id,
    microUnitId: units.fluidOunce.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.006,
  });

  // Wings & Appetizers
  const chickenWings = await storage.createProduct({
    name: "Chicken Wings (frozen)",
    category: "Protein",
    pluSku: "MEA004",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.16, // $0.16 per pound (was $0.01 per ounce * 16)
    yieldAmount: 10, // 10 lb bag
    yieldUnitId: units.pound.id,
  });

  const breadstickDough = await storage.createProduct({
    name: "Breadstick Dough",
    category: "Dry/Pantry",
    pluSku: "FRO001",
    baseUnitId: units.pound.id,
    microUnitId: units.pound.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.08, // $0.08 per pound (was $0.005 per ounce * 16)
    yieldAmount: 1, // 1 lb package
    yieldUnitId: units.pound.id,
  });

  const mozzarellaSticks = await storage.createProduct({
    name: "Mozzarella Sticks (frozen)",
    category: "Dry/Pantry",
    pluSku: "FRO002",
    baseUnitId: units.each.id,
    microUnitId: units.each.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.35,
    yieldAmount: 24, // 24 pieces per bag
    yieldUnitId: units.each.id,
  });

  const marinara = await storage.createProduct({
    name: "Marinara Dipping Sauce",
    category: "Sauces",
    pluSku: "SAU003",
    baseUnitId: units.fluidOunce.id,
    microUnitId: units.fluidOunce.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.004,
  });

  // ============ VENDOR PRODUCTS ============
  // Sysco products
  await storage.createVendorProduct({
    vendorId: vendors.sysco.id,
    productId: flour.id,
    vendorSku: "SYS-FL-50LB",
    purchaseUnitId: units.pound.id,
    caseSize: 50,
    lastPrice: 32.50,
    active: 1,
  });

  await storage.createVendorProduct({
    vendorId: vendors.sysco.id,
    productId: mozzarella.id,
    vendorSku: "SYS-MZ-5LB",
    purchaseUnitId: units.pound.id,
    caseSize: 5,
    lastPrice: 28.75,
    active: 1,
  });

  await storage.createVendorProduct({
    vendorId: vendors.sysco.id,
    productId: pepperoni.id,
    vendorSku: "SYS-PEP-10LB",
    purchaseUnitId: units.pound.id,
    caseSize: 10,
    lastPrice: 68.00,
    active: 1,
  });

  // US Foods products
  await storage.createVendorProduct({
    vendorId: vendors.usFoods.id,
    productId: crushedTomatoes.id,
    vendorSku: "USF-TOM-6CAN",
    purchaseUnitId: units.pound.id,
    caseSize: 6,
    innerPackSize: 28,
    lastPrice: 24.00,
    active: 1,
  });

  await storage.createVendorProduct({
    vendorId: vendors.usFoods.id,
    productId: chickenWings.id,
    vendorSku: "USF-WING-10LB",
    purchaseUnitId: units.pound.id,
    caseSize: 10,
    lastPrice: 42.50,
    active: 1,
  });

  await storage.createVendorProduct({
    vendorId: vendors.usFoods.id,
    productId: oliveOil.id,
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
    componentType: "product",
    componentId: flour.id,
    qty: 18,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
    componentId: water.id,
    qty: 11,
    unitId: units.fluidOunce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
    componentId: yeast.id,
    qty: 0.25,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
    componentId: salt.id,
    qty: 0.35,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
    componentId: sugar.id,
    qty: 0.18,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
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
    componentType: "product",
    componentId: crushedTomatoes.id,
    qty: 14,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: tomatoPaste.id,
    qty: 2,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: garlic.id,
    qty: 0.35,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: basil.id,
    qty: 0.18,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: oregano.id,
    qty: 0.07,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: oliveOil.id,
    qty: 0.68,
    unitId: units.fluidOunce.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
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
    componentType: "product",
    componentId: mozzarella.id,
    qty: 120,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "product",
    componentId: basil.id,
    qty: 3,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "product",
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
    componentType: "product",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: pepperoniPizza.id,
    componentType: "product",
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
    componentType: "product",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: pepperoni.id,
    qty: 40,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: italianSausage.id,
    qty: 40,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: bellPeppers.id,
    qty: 30,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: mushrooms.id,
    qty: 30,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: onions.id,
    qty: 20,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
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
    componentType: "product",
    componentId: bbqSauce.id,
    qty: 60,
    unitId: units.fluidOunce.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "product",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "product",
    componentId: chickenBreast.id,
    qty: 100,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "product",
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
    componentType: "product",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
    componentId: bellPeppers.id,
    qty: 40,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
    componentId: mushrooms.id,
    qty: 40,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
    componentId: onions.id,
    qty: 30,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
    componentId: blackOlives.id,
    qty: 30,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
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
    componentType: "product",
    componentId: chickenWings.id,
    qty: 400,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: chickenWingsRecipe.id,
    componentType: "product",
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
    componentType: "product",
    componentId: breadstickDough.id,
    qty: 200,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "product",
    componentId: garlic.id,
    qty: 10,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "product",
    componentId: oliveOil.id,
    qty: 20,
    unitId: units.fluidOunce.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "product",
    componentId: parmesan.id,
    qty: 15,
    unitId: units.ounce.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "product",
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
    componentType: "product",
    componentId: mozzarellaSticks.id,
    qty: 6,
    unitId: units.each.id,
  });

  await storage.createRecipeComponent({
    recipeId: mozzSticksRecipe.id,
    componentType: "product",
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

  // ============ SEPTEMBER 2025 INVENTORY COUNTS ============
  await seedSeptemberCounts();

  console.log("✅ Database seeded successfully!");
  console.log("📊 Created:");
  console.log("   - 13 units");
  console.log("   - 3 storage locations");
  console.log("   - 2 vendors");
  console.log("   - 25+ products");
  console.log("   - 6 vendor products");
  console.log("   - 10 recipes (2 nested)");
  console.log("   - 8 menu items");
  console.log("   - 7 days of POS sales");
  console.log("   - 4 September 2025 inventory counts");
}
