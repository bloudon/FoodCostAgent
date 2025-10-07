import { storage } from "./storage";

export async function seedDatabase() {
  console.log("🌱 Seeding database with pizza restaurant data...");

  // ============ UNITS ============
  const units = {
    // Weight
    gram: await storage.createUnit({ name: "gram", kind: "weight", toBaseRatio: 1 }),
    kilogram: await storage.createUnit({ name: "kilogram", kind: "weight", toBaseRatio: 1000 }),
    ounceWeight: await storage.createUnit({ name: "ounce (weight)", kind: "weight", toBaseRatio: 28.35 }),
    pound: await storage.createUnit({ name: "pound", kind: "weight", toBaseRatio: 453.6 }),
    
    // Volume
    milliliter: await storage.createUnit({ name: "milliliter", kind: "volume", toBaseRatio: 1 }),
    liter: await storage.createUnit({ name: "liter", kind: "volume", toBaseRatio: 1000 }),
    teaspoon: await storage.createUnit({ name: "teaspoon", kind: "volume", toBaseRatio: 4.93 }),
    tablespoon: await storage.createUnit({ name: "tablespoon", kind: "volume", toBaseRatio: 14.79 }),
    cup: await storage.createUnit({ name: "cup", kind: "volume", toBaseRatio: 236.6 }),
    fluidOunce: await storage.createUnit({ name: "fluid ounce", kind: "volume", toBaseRatio: 29.57 }),
    
    // Count
    each: await storage.createUnit({ name: "each", kind: "count", toBaseRatio: 1 }),
    dozen: await storage.createUnit({ name: "dozen", kind: "count", toBaseRatio: 12 }),
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
    category: "Dry Goods",
    pluSku: "DRY001",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    barcode: "8901234567890",
    active: 1,
    lastCost: 0.001,
  });

  const yeast = await storage.createProduct({
    name: "Active Dry Yeast",
    category: "Dry Goods",
    pluSku: "DRY002",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.02,
  });

  const water = await storage.createProduct({
    name: "Water",
    category: "Beverages",
    pluSku: "BEV001",
    baseUnitId: units.milliliter.id,
    microUnitId: units.milliliter.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.0001,
  });

  const oliveOil = await storage.createProduct({
    name: "Extra Virgin Olive Oil",
    category: "Oils",
    pluSku: "OIL001",
    baseUnitId: units.milliliter.id,
    microUnitId: units.milliliter.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.015,
  });

  const salt = await storage.createProduct({
    name: "Kosher Salt",
    category: "Dry Goods",
    pluSku: "DRY003",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.002,
  });

  const sugar = await storage.createProduct({
    name: "Granulated Sugar",
    category: "Dry Goods",
    pluSku: "DRY004",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.0015,
  });

  // Sauce Ingredients
  const crushedTomatoes = await storage.createProduct({
    name: "Crushed Tomatoes (San Marzano)",
    category: "Canned Goods",
    pluSku: "CAN001",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.004,
  });

  const tomatoPaste = await storage.createProduct({
    name: "Tomato Paste",
    category: "Canned Goods",
    pluSku: "CAN002",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.006,
  });

  const garlic = await storage.createProduct({
    name: "Fresh Garlic",
    category: "Produce",
    pluSku: "PRO001",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.01,
  });

  const basil = await storage.createProduct({
    name: "Fresh Basil",
    category: "Produce",
    pluSku: "PRO002",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.03,
  });

  const oregano = await storage.createProduct({
    name: "Dried Oregano",
    category: "Spices",
    pluSku: "SPI001",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.05,
  });

  // Cheese & Toppings
  const mozzarella = await storage.createProduct({
    name: "Whole Milk Mozzarella",
    category: "Dairy",
    pluSku: "DAI001",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.011,
  });

  const parmesan = await storage.createProduct({
    name: "Grated Parmesan",
    category: "Dairy",
    pluSku: "DAI002",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.022,
  });

  const pepperoni = await storage.createProduct({
    name: "Pepperoni Slices",
    category: "Meat",
    pluSku: "MEA001",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.015,
  });

  const italianSausage = await storage.createProduct({
    name: "Italian Sausage (bulk)",
    category: "Meat",
    pluSku: "MEA002",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.013,
  });

  const chickenBreast = await storage.createProduct({
    name: "Chicken Breast",
    category: "Meat",
    pluSku: "MEA003",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.012,
  });

  const bellPeppers = await storage.createProduct({
    name: "Bell Peppers (mixed)",
    category: "Produce",
    pluSku: "PRO003",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.007,
  });

  const mushrooms = await storage.createProduct({
    name: "Button Mushrooms",
    category: "Produce",
    pluSku: "PRO004",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.009,
  });

  const onions = await storage.createProduct({
    name: "Yellow Onions",
    category: "Produce",
    pluSku: "PRO005",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.003,
  });

  const blackOlives = await storage.createProduct({
    name: "Sliced Black Olives",
    category: "Canned Goods",
    pluSku: "CAN003",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.008,
  });

  // Sauces & Specialty
  const bbqSauce = await storage.createProduct({
    name: "BBQ Sauce (Sweet Baby Ray's)",
    category: "Sauces",
    pluSku: "SAU001",
    baseUnitId: units.milliliter.id,
    microUnitId: units.milliliter.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.008,
  });

  const ranchDressing = await storage.createProduct({
    name: "Ranch Dressing",
    category: "Sauces",
    pluSku: "SAU002",
    baseUnitId: units.milliliter.id,
    microUnitId: units.milliliter.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.006,
  });

  // Wings & Appetizers
  const chickenWings = await storage.createProduct({
    name: "Chicken Wings (frozen)",
    category: "Meat",
    pluSku: "MEA004",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.01,
  });

  const breadstickDough = await storage.createProduct({
    name: "Breadstick Dough",
    category: "Frozen",
    pluSku: "FRO001",
    baseUnitId: units.gram.id,
    microUnitId: units.gram.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.005,
  });

  const mozzarellaSticks = await storage.createProduct({
    name: "Mozzarella Sticks (frozen)",
    category: "Frozen",
    pluSku: "FRO002",
    baseUnitId: units.each.id,
    microUnitId: units.each.id,
    microUnitsPerPurchaseUnit: 1,
    active: 1,
    lastCost: 0.35,
  });

  const marinara = await storage.createProduct({
    name: "Marinara Dipping Sauce",
    category: "Sauces",
    pluSku: "SAU003",
    baseUnitId: units.milliliter.id,
    microUnitId: units.milliliter.id,
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
    purchaseUnitId: units.liter.id,
    caseSize: 3.785,
    lastPrice: 45.00,
    active: 1,
  });

  // ============ RECIPES ============
  // Pizza Dough (nested recipe)
  const pizzaDough = await storage.createRecipe({
    name: "Pizza Dough",
    yieldQty: 1,
    yieldUnitId: units.gram.id,
    wastePercent: 2,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
    componentId: flour.id,
    qty: 500,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
    componentId: water.id,
    qty: 325,
    unitId: units.milliliter.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
    componentId: yeast.id,
    qty: 7,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
    componentId: salt.id,
    qty: 10,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
    componentId: sugar.id,
    qty: 5,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: pizzaDough.id,
    componentType: "product",
    componentId: oliveOil.id,
    qty: 15,
    unitId: units.milliliter.id,
  });

  // Marinara Sauce (nested recipe)
  const marinaraSauce = await storage.createRecipe({
    name: "Marinara Pizza Sauce",
    yieldQty: 500,
    yieldUnitId: units.gram.id,
    wastePercent: 1,
    computedCost: 0,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: crushedTomatoes.id,
    qty: 400,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: tomatoPaste.id,
    qty: 50,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: garlic.id,
    qty: 10,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: basil.id,
    qty: 5,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: oregano.id,
    qty: 2,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: oliveOil.id,
    qty: 20,
    unitId: units.milliliter.id,
  });

  await storage.createRecipeComponent({
    recipeId: marinaraSauce.id,
    componentType: "product",
    componentId: salt.id,
    qty: 3,
    unitId: units.gram.id,
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
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "recipe",
    componentId: marinaraSauce.id,
    qty: 80,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "product",
    componentId: mozzarella.id,
    qty: 120,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "product",
    componentId: basil.id,
    qty: 3,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: margheritaPizza.id,
    componentType: "product",
    componentId: parmesan.id,
    qty: 10,
    unitId: units.gram.id,
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
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: pepperoniPizza.id,
    componentType: "recipe",
    componentId: marinaraSauce.id,
    qty: 80,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: pepperoniPizza.id,
    componentType: "product",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: pepperoniPizza.id,
    componentType: "product",
    componentId: pepperoni.id,
    qty: 60,
    unitId: units.gram.id,
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
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "recipe",
    componentId: marinaraSauce.id,
    qty: 80,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: pepperoni.id,
    qty: 40,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: italianSausage.id,
    qty: 40,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: bellPeppers.id,
    qty: 30,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: mushrooms.id,
    qty: 30,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: onions.id,
    qty: 20,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: supremePizza.id,
    componentType: "product",
    componentId: blackOlives.id,
    qty: 20,
    unitId: units.gram.id,
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
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "product",
    componentId: bbqSauce.id,
    qty: 60,
    unitId: units.milliliter.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "product",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "product",
    componentId: chickenBreast.id,
    qty: 100,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: bbqChickenPizza.id,
    componentType: "product",
    componentId: onions.id,
    qty: 30,
    unitId: units.gram.id,
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
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "recipe",
    componentId: marinaraSauce.id,
    qty: 80,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
    componentId: mozzarella.id,
    qty: 140,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
    componentId: bellPeppers.id,
    qty: 40,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
    componentId: mushrooms.id,
    qty: 40,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
    componentId: onions.id,
    qty: 30,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
    componentId: blackOlives.id,
    qty: 30,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: veggiePizza.id,
    componentType: "product",
    componentId: basil.id,
    qty: 5,
    unitId: units.gram.id,
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
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: chickenWingsRecipe.id,
    componentType: "product",
    componentId: ranchDressing.id,
    qty: 60,
    unitId: units.milliliter.id,
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
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "product",
    componentId: garlic.id,
    qty: 10,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "product",
    componentId: oliveOil.id,
    qty: 20,
    unitId: units.milliliter.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "product",
    componentId: parmesan.id,
    qty: 15,
    unitId: units.gram.id,
  });

  await storage.createRecipeComponent({
    recipeId: breadsticksRecipe.id,
    componentType: "product",
    componentId: marinara.id,
    qty: 60,
    unitId: units.milliliter.id,
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
    unitId: units.milliliter.id,
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
}
