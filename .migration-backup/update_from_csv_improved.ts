import { db } from "./server/db";
import { menuItems } from "./shared/schema";
import { eq, ilike, or, sql } from "drizzle-orm";
import fs from "fs";
import { parse } from "csv-parse/sync";

interface CSVRow {
  Category: string;
  Item: string;
  "Size/Variant": string;
  Price: string;
}

// Function to normalize item names for fuzzy matching
function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '') // Remove parenthetical descriptions
    .replace(/\s*w\/\s*/g, ' with ') // Normalize w/ to with
    .replace(/grilled chicken quesadilla/i, 'chicken quesadilla') // Variations
    .trim();
}

async function findMenuItem(itemName: string): Promise<any | null> {
  // Try exact match first
  let items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.name, itemName))
    .limit(1);
  
  if (items.length > 0) return items[0];
  
  // Try case-insensitive exact match
  items = await db
    .select()
    .from(menuItems)
    .where(ilike(menuItems.name, itemName))
    .limit(1);
  
  if (items.length > 0) return items[0];
  
  // Try normalized fuzzy match
  const normalized = normalizeItemName(itemName);
  const allItems = await db.select().from(menuItems);
  
  for (const item of allItems) {
    const normalizedDB = normalizeItemName(item.name);
    if (normalizedDB === normalized) {
      return item;
    }
  }
  
  // Try partial match
  for (const item of allItems) {
    const normalizedDB = normalizeItemName(item.name);
    if (normalizedDB.includes(normalized) || normalized.includes(normalizedDB)) {
      return item;
    }
  }
  
  return null;
}

async function updateFromCSVImproved() {
  console.log("Reading CSV file with improved fuzzy matching...\n");
  
  const csvContent = fs.readFileSync("attached_assets/Menu_Price_List__Parsed_from_Menu_PDF__1761430084713.csv", "utf-8");
  const records: CSVRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true
  });
  
  console.log(`Loaded ${records.length} items from CSV\n`);
  
  let updatedCount = 0;
  let notFoundCount = 0;
  let alreadyCorrect = 0;
  const notFound: Array<{ category: string; item: string; variant: string; price: number }> = [];
  
  for (const record of records) {
    const price = parseFloat(record.Price);
    const variant = record["Size/Variant"];
    
    // Construct the full item name based on variant
    let itemName = record.Item;
    
    // Special handling for specific items with variants
    if (variant && variant !== "") {
      if (record.Item === "Cole Slaw") {
        itemName = variant === "Small" ? "Cole Slaw Sm" : "Cole Slaw Lg";
      } else if (record.Item === "Chicken Fingers") {
        if (variant === "10") itemName = "10 Fingers";
        else if (variant === "20") itemName = "20 Chicken Fingers";
        else if (variant === "5") itemName = "5 Chicken Fingers";
      } else if (record.Item === "Finger Platter (w/ fries, slaw, roll & butter)") {
        itemName = variant === "3" ? "3 Finger Platter" : "5 Finger Platter";
      } else if (record.Item === "Buffalo Chicken Fingers") {
        itemName = "Buffalo Chicken Fingers (5)";
      } else if (record.Item === "Boneless Wings") {
        itemName = `${variant} Boneless Wings`;
      } else if (record.Item === "Wings") {
        itemName = `${variant} Wings`;
      }
    }
    
    try {
      const item = await findMenuItem(itemName);
      
      if (item) {
        const oldPrice = item.price;
        
        // Check if price is already correct
        if (oldPrice === price) {
          console.log(`✓ "${item.name}": Already correct at $${price}`);
          alreadyCorrect++;
        } else {
          await db
            .update(menuItems)
            .set({ price })
            .where(eq(menuItems.id, item.id));
          
          console.log(`✓ Updated "${item.name}": $${oldPrice || 'null'} → $${price}`);
          updatedCount++;
        }
      } else {
        notFound.push({
          category: record.Category,
          item: itemName,
          variant: variant,
          price: price
        });
        notFoundCount++;
        console.log(`✗ Not found: "${itemName}"`);
      }
    } catch (error) {
      console.error(`Error processing ${itemName}:`, error);
    }
  }
  
  console.log(`\n========== Summary ==========`);
  console.log(`✓ Successfully updated: ${updatedCount} items`);
  console.log(`✓ Already correct: ${alreadyCorrect} items`);
  console.log(`✗ Not found in database: ${notFoundCount} items`);
  
  if (notFound.length > 0) {
    console.log(`\n✗ Items not found (${notFoundCount}) - genuinely need to be created:`);
    notFound.forEach(({ category, item, variant, price }) => {
      const displayName = variant ? `${item} (${variant})` : item;
      console.log(`  - [${category}] ${displayName} - $${price}`);
    });
  }
}

updateFromCSVImproved()
  .then(() => {
    console.log("\nImproved CSV price update complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error during CSV update:", error);
    process.exit(1);
  });
