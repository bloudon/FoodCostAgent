import { db } from '../db';
import { recipes, recipeComponents, menuItems, units as unitsTable, inventoryItems } from '../../shared/schema';
import { eq, and, isNull, isNotNull, ne, inArray } from 'drizzle-orm';
import { storage } from '../storage';

/**
 * Tokenizes a menu item description into individual ingredient names.
 * Splits on commas, strips leading/trailing whitespace, removes price callouts,
 * strips common preparation prefixes (topped with, served with, etc.), and
 * drops tokens that are too short to be meaningful ingredient names.
 */
export function tokenizeDescription(description: string): string[] {
  if (!description || !description.trim()) return [];

  // Remove price callouts like "$1", "+$2"
  const cleaned = description
    .replace(/[+\-]?\$\d+(?:\.\d+)?/g, '')
    .trim();

  const LEADING_PREP = /^(?:topped\s+with|drizzled\s+with|served\s+with|finished\s+with|garnished\s+with|with|and|or|sub|add|no|a|an|our|house|fresh|crispy|grilled|smoked|fried|baked|steamed|house-made)\s+/i;

  return cleaned
    .split(',')
    .map(t => t.trim())
    .map(t => t.replace(LEADING_PREP, '').replace(LEADING_PREP, '').trim())
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

    try {
      const created = await db.transaction(async (tx) => {
        // Create recipe stub
        const [newRecipe] = await tx.insert(recipes).values({
          companyId,
          name: item.name,
          yieldQty: 1,
          yieldUnitId: defaultUnitId,
          computedCost: 0,
          canBeIngredient: 0,
          isPlaceholder: 1,
          isActive: 1,
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
