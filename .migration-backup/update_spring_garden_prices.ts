import { db } from "./server/db";
import { menuItems } from "./shared/schema";
import { eq, and, ilike, or } from "drizzle-orm";

// Price mappings from Spring Garden menu PDF
const priceUpdates: { [key: string]: number | { pattern: string; price: number }[] } = {
  // Wings
  "10 Wings": 14.25,
  "20 Wings": 28.50,
  "30 Wings": 42.50,
  "40 Wings": 57.00,
  "50 Wings": 70.00,
  "100 Wings": 140.00,
  
  // Boneless Wings
  "8 Boneless Wings": 9.75,
  "16 Boneless Wings": 19.50,
  "24 Boneless Wings": 29.25,
  
  // Chicken Fingers
  "5 Chicken Fingers": 9.50,
  "10 Fingers": 19.00,
  "20 Chicken Fingers": 38.00,
  "3 Finger Platter": 9.95,
  "5 Finger Platter": 13.25,
  "Buffalo Chicken Fingers (5)": 10.95,
  "Buffalo Chicken Fingers(5)": 10.95,
  
  // Appetizers
  "French Fries": 5.75,
  "Cheese Fries": 7.50,
  "Old Bay Fries": 6.25,
  "Curly Fries": 6.25,
  "Cheese Curly Fries": 8.00,
  "Bacon Cheese Fries": 8.50,
  "Mega Fries": 9.50,
  "Pizza Fries": 7.75,
  "Pepperoni Pizza Fries": 8.00,
  "Onion Rings": 5.75,
  "Mozzarella Sticks (6)": 8.50,
  "Cheese Steak Nachos": 11.50,
  "Chicken Steak Nachos": 11.50,
  "Grilled Chicken Quesadilla": 11.50,
  "Chicken Quesadilla": 11.50,
  "Steak Quesadilla": 11.50,
  "Veggie Quesadilla": 11.50,
  "Wing Dings (10)": 13.25,
  "Wing Dings Platter": 15.75,
  "Buffalo Shrimp": 11.95,
  "Cole Slaw Sm": 1.25,
  "Garlic Long Roll": 3.00,
  
  // Burgers
  "Hamburger": 7.75,
  "Cheeseburger": 8.25,
  "Cheeseburger Deluxe": 11.50,
  "Pizza Burger": 8.50,
  "Turkey Burger": 7.75,
  "Turkey Cheeseburger": 8.25,
  "Turkey Cheeseburger Deluxe": 11.50,
  "Double Cheeseburger": 9.75,
  "Double Turkey Cheeseburger": 9.75,
  "Veggie Burger": 8.25,
  "Veggie Burger Deluxe": 11.50,
  
  // Wraps - all wraps are 11.25
  "BLT Wrap": 11.25,
  "Chicken Salad Wrap": 11.25,
  "Chicken Caesar Wrap": 11.25,
  "Turkey Cheese & Bacon Wrap": 11.25,
  "Roast Beef & Cheese Wrap": 11.25,
  "Greek Wrap": 11.25,
  "Cheeseburger Wrap": 11.25,
  "Turkey Cheeseburger Wrap": 11.25,
  "Grilled Chicken Wrap": 11.25,
  "Cheesesteak Wrap": 11.25,
  "Chicken Cheesesteak Wrap": 11.25,
  "Buffalo Chicken Wrap": 11.25,
  "Tuna Cheese Wrap": 11.25,
  "Chicken Finger Wrap": 11.25,
  "Ham & Cheese Wrap": 11.25,
  "Veggie Wrap": 11.25,
  
  // Catering - Hoagie Trays
  "Italian Hoagie Tray": 90.00,
  "Turkey Hoagie Tray": 90.00,
  "Tuna Hoagie Tray": 90.00,
  "Chicken Salad Hoagie Tray": 90.00,
  "Roast Beef Hoagie Tray": 90.00,
  "Assorted Hoagie Tray": 90.00,
  "Assorted Wrap": 90.00,
  "Cheesesteak Tray": 95.00,
  
  // Salads - Party Size
  "Caesar Salad": 65.00,
  "Grilled Chicken Caesar Salad": 85.00,
  "Garden Salad": 85.00,
  "Chicken Salad": 85.00,
  "Chef Salad": 85.00,
  "Greek Salad": 85.00,
  
  // Pasta - Catering
  "Alfredo": 65.00,
  "Alfr /w Chkn & Broc": 80.00,
  "Chicken Parm Pasta": 70.00,
};

async function updatePrices() {
  console.log("Starting price updates for Spring Garden menu items...\n");
  
  let updatedCount = 0;
  let notFoundCount = 0;
  const notFound: string[] = [];
  
  for (const [itemName, price] of Object.entries(priceUpdates)) {
    try {
      // Try exact match first
      let items = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.name, itemName))
        .limit(1);
      
      // If no exact match, try case-insensitive partial match
      if (items.length === 0) {
        items = await db
          .select()
          .from(menuItems)
          .where(ilike(menuItems.name, `%${itemName}%`))
          .limit(1);
      }
      
      if (items.length > 0) {
        const item = items[0];
        const oldPrice = item.price;
        
        await db
          .update(menuItems)
          .set({ price })
          .where(eq(menuItems.id, item.id));
        
        console.log(`✓ Updated "${item.name}": $${oldPrice || 'null'} → $${price}`);
        updatedCount++;
      } else {
        notFound.push(itemName);
        notFoundCount++;
      }
    } catch (error) {
      console.error(`Error updating ${itemName}:`, error);
    }
  }
  
  console.log(`\n========== Summary ==========`);
  console.log(`✓ Successfully updated: ${updatedCount} items`);
  console.log(`✗ Not found in database: ${notFoundCount} items`);
  
  if (notFound.length > 0) {
    console.log(`\nItems not found (may need to be created manually):`);
    notFound.forEach(name => console.log(`  - ${name}`));
  }
}

updatePrices()
  .then(() => {
    console.log("\nPrice update complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error during price update:", error);
    process.exit(1);
  });
