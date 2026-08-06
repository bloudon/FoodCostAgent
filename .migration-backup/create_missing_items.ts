import { db } from "./server/db";
import { menuItems, companies } from "./shared/schema";
import { eq, ilike } from "drizzle-orm";

interface NewMenuItem {
  name: string;
  pluSku: string;
  price: number;
  department: string;
  category: string;
}

const missingItems: NewMenuItem[] = [
  // Appetizers
  {
    name: "Cole Slaw Lg",
    pluSku: "COLESLAWLG",
    price: 2.50,
    department: "Appetizers",
    category: "Appetizers"
  },
  
  // Catering Pasta
  {
    name: "Pasta with Chicken Parmesan or Grilled Chicken",
    pluSku: "PASTACHICK",
    price: 70.00,
    department: "Catering",
    category: "Pasta (Serves 8-10)"
  },
  {
    name: "Pasta with Meatballs or Sausage",
    pluSku: "PASTAMEATB",
    price: 65.00,
    department: "Catering",
    category: "Pasta (Serves 8-10)"
  },
  {
    name: "Spaghetti or Penne with Sauce & Cheese",
    pluSku: "SPAGHETTIP",
    price: 50.00,
    department: "Catering",
    category: "Pasta (Serves 8-10)"
  },
  {
    name: "Tray Hot Meatballs in Sauce",
    pluSku: "TRAYMEATBA",
    price: 80.00,
    department: "Catering",
    category: "Pasta (Serves 8-10)"
  },
  
  // Catering Trays
  {
    name: "Roast Beef Hoagie Tray",
    pluSku: "ROASTBEEFT",
    price: 90.00,
    department: "Catering",
    category: "Hoagie Trays"
  },
  {
    name: "Tuna Hoagie Tray",
    pluSku: "TUNAHOAGIE",
    price: 90.00,
    department: "Catering",
    category: "Hoagie Trays"
  },
  {
    name: "Assorted Wrap Tray",
    pluSku: "ASSORTEDWR",
    price: 90.00,
    department: "Catering",
    category: "Wrap Trays"
  },
  
  // Wings & Chicken
  {
    name: "40 Wings",
    pluSku: "40WINGS",
    price: 57.00,
    department: "Chicken",
    category: "Wings"
  },
  {
    name: "20 Chicken Fingers",
    pluSku: "20CHICKENF",
    price: 38.00,
    department: "Chicken",
    category: "Chicken Fingers"
  }
];

async function createMissingItems() {
  console.log("Creating missing menu items...\n");
  
  // Get the company ID
  const companyList = await db
    .select()
    .from(companies)
    .where(ilike(companies.name, '%City View%'))
    .limit(1);
  
  if (companyList.length === 0) {
    console.error("Could not find City View Pizza company");
    process.exit(1);
  }
  
  const companyId = companyList[0].id;
  console.log(`Using company: ${companyList[0].name} (${companyId})\n`);
  
  let createdCount = 0;
  
  for (const item of missingItems) {
    try {
      // Check if item already exists
      const existing = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.name, item.name))
        .limit(1);
      
      if (existing.length > 0) {
        console.log(`⚠️  "${item.name}" already exists, skipping...`);
        continue;
      }
      
      // Create the menu item
      await db.insert(menuItems).values({
        companyId: companyId,
        name: item.name,
        pluSku: item.pluSku,
        price: item.price,
        department: item.department,
        category: item.category,
        active: 1,
        isRecipeItem: 0
      });
      
      console.log(`✓ Created "${item.name}" - $${item.price} [${item.category}]`);
      createdCount++;
    } catch (error) {
      console.error(`✗ Error creating "${item.name}":`, error);
    }
  }
  
  console.log(`\n========== Summary ==========`);
  console.log(`✓ Successfully created: ${createdCount} new menu items`);
  console.log(`Total items to create: ${missingItems.length}`);
}

createMissingItems()
  .then(() => {
    console.log("\nMenu item creation complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error during item creation:", error);
    process.exit(1);
  });
