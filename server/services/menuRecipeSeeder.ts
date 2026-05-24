import { db } from '../db';
import { recipes, recipeComponents, menuItems, units as unitsTable, inventoryItems } from '../../shared/schema';
import { eq, and, isNull, isNotNull, ne, inArray } from 'drizzle-orm';
import { storage } from '../storage';

/**
 * Tokenizes a menu item description into individual ingredient names.
 *
 * Splits on commas AND sentence-ending periods, strips preparation prefixes
 * (topped with, served with, etc.), further splits on " and " within
 * prep-phrase clauses, handles mid-token " with " constructs, removes price
 * callouts, and drops tokens that are too short or are pure measurements.
 */
export function tokenizeDescription(description: string): string[] {
  if (!description || !description.trim()) return [];

  // Remove price callouts like "$1", "+$2"
  const cleaned = description
    .replace(/[+\-]?\$\d+(?:\.\d+)?/g, '')
    .trim();

  const LEADING_PREP = /^(?:topped\s+with|drizzled\s+with|served\s+with|finished\s+with|garnished\s+with|comes\s+with|choice\s+of|with|and|or|sub|add|no|a|an|our|house|fresh|crispy|grilled|smoked|fried|baked|steamed|house-made)\s+/i;

  const results: string[] = [];

  // Primary split: commas and sentence-ending periods
  const segments = cleaned.split(/[,\.]+/);

  for (const seg of segments) {
    const t = seg.trim();
    if (!t) continue;

    // Strip leading prep phrases (two passes for compound phrases like "with fresh")
    const once = t.replace(LEADING_PREP, '').trim();
    const twice = once.replace(LEADING_PREP, '').trim();
    const didStrip = twice !== t;

    if (didStrip) {
      // A prep phrase was stripped — split remainder on " and " to capture each
      // listed item (e.g. "served with coleslaw and french fries" → two tokens)
      for (const sub of twice.split(/\s+and\s+/i)) {
        results.push(sub.trim());
      }
    } else {
      // No leading prep phrase. If the segment contains " with " in the middle
      // (e.g. "Breaded chicken breast with marinara and alfredo sauce"), split
      // it into the main item and its accompaniments.
      const withMatch = t.match(/^(.+?)\s+with\s+(.+)$/i);
      if (withMatch) {
        results.push(withMatch[1].trim());
        // The part after "with" may contain " and " — split those out too
        for (const sub of withMatch[2].split(/\s+and\s+/i)) {
          results.push(sub.trim());
        }
      } else {
        results.push(t);
      }
    }
  }

  return results
    .filter(t => t.length >= 3)
    .filter(t => !/^\d+(\.\d+)?\s*(oz|lb|g|ml|cup|tbsp|tsp|pcs|pc|oz\.)?\s*$/i.test(t));
}

/**
 * Attempts to find an inventory item by normalized name matching.
 * First tries exact case-insensitive name match, then substring containment.
 */
function fuzzyMatchInventoryItem(
  token: string,
  invItems: { id: string; name: string }[],
): string | null {
  const norm = token.toLowerCase().trim();
  // Exact match
  const exact = invItems.find(i => i.name.toLowerCase() === norm);
  if (exact) return exact.id;
  // Token contains inventory item name (e.g. "grilled chicken breast" matches "chicken breast")
  const contained = invItems.find(i => {
    const n = i.name.toLowerCase();
    return n.length >= 4 && norm.includes(n);
  });
  if (contained) return contained.id;
  // Inventory item name contains token (e.g. token "chicken" matches "chicken breast")
  if (norm.length >= 5) {
    const broader = invItems.find(i => i.name.toLowerCase().includes(norm));
    if (broader) return broader.id;
  }
  return null;
}

export interface SeededRecipeSummary {
  menuItemId: string;
  menuItemName: string;
  recipeId: string;
  componentCount: number;
  matchedCount: number;
}

/**
 * Seeds recipe stubs for a set of menu items that have descriptions.
 * Each call should pass the items that need seeding (description non-empty, no existing recipeId).
 * Returns summaries for all recipes created.
 *
 * The `recipes` table has no dedicated selling-price or menu-department column.
 * Both are preserved on the linked `menu_items` row (accessible via menuItems.recipeId)
 * and are also captured in the auto-generated `instructions` note written below.
 * The instructions field is the designated place to carry menu-derived metadata until
 * an operator completes the recipe proper.
 *
 * @param itemsToSeed  Array of { id, name, description, price } from menuItems
 * @param companyId    Company scoping
 */
export async function seedRecipesFromDescriptions(
  itemsToSeed: Array<{ id: string; name: string; description: string; price: number | null }>,
  companyId: string,
): Promise<SeededRecipeSummary[]> {
  if (itemsToSeed.length === 0) return [];

  // Fetch units once
  const allUnits = await storage.getUnits();
  const eachUnit = allUnits.find(
    u => u.name.toLowerCase() === 'each' || u.abbreviation?.toLowerCase() === 'ea',
  );
  const defaultUnitId: string = eachUnit?.id ?? allUnits[0]?.id;
  if (!defaultUnitId) throw new Error('No units found in database — cannot seed recipes');

  // Fetch all active inventory items for this company (id + name only)
  const invItems = await db
    .select({ id: inventoryItems.id, name: inventoryItems.name })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.companyId, companyId), eq(inventoryItems.active, 1)));

  const results: SeededRecipeSummary[] = [];

  for (const item of itemsToSeed) {
    const tokens = tokenizeDescription(item.description);

    // Encode selling price in the auto-generated instructions so operators can see it
    // when building out the recipe. The recipes table has no dedicated price column —
    // selling price is owned by the linked menu_items row (menuItems.recipeId = recipe.id).
    const priceNote = item.price !== null && item.price > 0
      ? `Selling price: $${item.price.toFixed(2)}\n`
      : '';
    const autoInstructions = `${priceNote}Auto-generated from menu description: "${item.description}"\n\nAdd quantities, yields, and costs to complete this recipe.`;

    try {
      const created = await db.transaction(async (tx) => {
        // Create recipe stub — name filled in from menu item; selling price and menu
        // department are on the linked menu_items row (see menuItems.recipeId).
        // The instructions field carries the selling price note for operator visibility.
        const [newRecipe] = await tx.insert(recipes).values({
          companyId,
          name: item.name,
          yieldQty: 1,
          yieldUnitId: defaultUnitId,
          computedCost: 0,
          canBeIngredient: 0,
          isPlaceholder: 1,
          isActive: 1,
          instructions: autoInstructions,
        }).returning();

        // Link menu item → recipe
        await tx
          .update(menuItems)
          .set({ recipeId: newRecipe.id })
          .where(and(eq(menuItems.id, item.id), eq(menuItems.companyId, companyId)));

        // Create recipe components from tokenized description
        let sortOrder = 0;
        let matchedCount = 0;
        for (const token of tokens) {
          const matchedId = fuzzyMatchInventoryItem(token, invItems);
          if (matchedId) {
            await tx.insert(recipeComponents).values({
              recipeId: newRecipe.id,
              componentType: 'inventory_item',
              componentId: matchedId,
              qty: 1,
              unitId: defaultUnitId,
              sortOrder: sortOrder++,
            });
            matchedCount++;
          } else {
            // Placeholder component — UUID won't exist in inventory
            await tx.insert(recipeComponents).values({
              recipeId: newRecipe.id,
              componentType: 'inventory_item',
              componentId: crypto.randomUUID(),
              qty: 1,
              unitId: defaultUnitId,
              sortOrder: sortOrder++,
              missingItemName: token,
            });
          }
        }

        return { recipeId: newRecipe.id, componentCount: tokens.length, matchedCount };
      });

      results.push({
        menuItemId: item.id,
        menuItemName: item.name,
        recipeId: created.recipeId,
        componentCount: created.componentCount,
        matchedCount: created.matchedCount,
      });
    } catch (err) {
      console.error(`[MenuRecipeSeeder] Failed to seed recipe for menu item "${item.name}":`, err);
    }
  }

  return results;
}
