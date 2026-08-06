import { db } from "./db";
import { menuItems } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Generate an abbreviated SKU from a menu item name
 * Max 10 characters, removes special chars, takes first letters of words
 */
function generateAbbreviation(name: string, maxLength: number = 10): string {
  // Remove special characters except spaces
  let clean = name.replace(/[^A-Za-z0-9 ]/g, '');
  
  // Split into words
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  
  if (words.length === 0) {
    return 'ITEM';
  }
  
  // Strategy 1: Try first letters of each word
  let abbrev = words.map(w => w[0]).join('').toUpperCase();
  if (abbrev.length <= maxLength) {
    return abbrev;
  }
  
  // Strategy 2: Take first word fully, then first letters
  if (words[0].length <= maxLength) {
    abbrev = words[0].toUpperCase();
    for (let i = 1; i < words.length && abbrev.length < maxLength; i++) {
      abbrev += words[i][0].toUpperCase();
    }
    return abbrev.substring(0, maxLength);
  }
  
  // Strategy 3: Just truncate first word
  return words[0].substring(0, maxLength).toUpperCase();
}

/**
 * Clean up all menu item SKUs
 */
export async function cleanupMenuItemSKUs() {
  console.log('Starting SKU cleanup...');
  
  // Get all menu items
  const items = await db.select().from(menuItems).orderBy(menuItems.name);
  
  const updates: { id: string; newSku: string }[] = [];
  const skuMap = new Map<string, number>(); // Track SKU usage per company
  
  for (const item of items) {
    let needsUpdate = false;
    let newSku = item.pluSku;
    
    // Check if needs cleanup (has pipe, equals name, or too long)
    if (item.pluSku.includes('|') || item.pluSku === item.name || item.pluSku.length > 10) {
      needsUpdate = true;
      
      // Generate base abbreviation
      let baseSku = generateAbbreviation(item.name);
      const companyKey = `${item.companyId}-${baseSku}`;
      
      // Handle duplicates by adding numbers
      if (skuMap.has(companyKey)) {
        const count = skuMap.get(companyKey)! + 1;
        skuMap.set(companyKey, count);
        // Append number, ensuring we stay within 10 chars
        const numStr = count.toString();
        baseSku = baseSku.substring(0, 10 - numStr.length) + numStr;
      } else {
        skuMap.set(companyKey, 1);
      }
      
      newSku = baseSku;
    }
    
    if (needsUpdate && newSku !== item.pluSku) {
      updates.push({ id: item.id, newSku });
    }
  }
  
  console.log(`Found ${updates.length} items to update`);
  
  // Update each item
  let updated = 0;
  for (const { id, newSku } of updates) {
    try {
      await db.update(menuItems)
        .set({ pluSku: newSku })
        .where(eq(menuItems.id, id));
      updated++;
      if (updated % 50 === 0) {
        console.log(`Updated ${updated}/${updates.length}...`);
      }
    } catch (error) {
      console.error(`Failed to update item ${id} to ${newSku}:`, error);
    }
  }
  
  console.log(`Successfully updated ${updated} SKUs`);
  return { total: items.length, updated };
}
