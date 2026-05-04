/**
 * Known base ratios for units — mirrors server/seed.ts values.
 * Weight base unit: gram (1 g = 1)
 * Volume base unit: milliliter (1 ml = 1)
 * Count base unit: each (1 ea = 1)
 */
const UNIT_BASE_RATIOS: Record<string, { ratio: number; kind: string }> = {
  // Weight — metric
  "gram": { ratio: 1, kind: "weight" },
  "kilogram": { ratio: 1000, kind: "weight" },
  "metric ton": { ratio: 1000000, kind: "weight" },
  // Weight — imperial
  "ounce (weight)": { ratio: 28.3495, kind: "weight" },
  "half-ounce": { ratio: 14.1748, kind: "weight" },
  "quarter-ounce": { ratio: 7.0874, kind: "weight" },
  "pound": { ratio: 453.592, kind: "weight" },
  "half-pound": { ratio: 226.796, kind: "weight" },
  "quarter-pound": { ratio: 113.398, kind: "weight" },
  "eighth-pound": { ratio: 56.699, kind: "weight" },
  "ton": { ratio: 907185, kind: "weight" },
  // Volume — metric
  "milliliter": { ratio: 1, kind: "volume" },
  "centiliter": { ratio: 10, kind: "volume" },
  "deciliter": { ratio: 100, kind: "volume" },
  "liter": { ratio: 1000, kind: "volume" },
  "hectoliter": { ratio: 100000, kind: "volume" },
  // Volume — imperial
  "drop": { ratio: 0.05, kind: "volume" },
  "pinch": { ratio: 0.308, kind: "volume" },
  "dash": { ratio: 0.616, kind: "volume" },
  "teaspoon": { ratio: 4.92892, kind: "volume" },
  "half-teaspoon": { ratio: 2.46446, kind: "volume" },
  "tablespoon": { ratio: 14.7868, kind: "volume" },
  "half-tablespoon": { ratio: 7.3934, kind: "volume" },
  "fluid ounce": { ratio: 29.5735, kind: "volume" },
  "cup": { ratio: 236.588, kind: "volume" },
  "half-cup": { ratio: 118.294, kind: "volume" },
  "quarter-cup": { ratio: 59.147, kind: "volume" },
  "pint": { ratio: 473.176, kind: "volume" },
  "quart": { ratio: 946.353, kind: "volume" },
  "gallon": { ratio: 3785.41, kind: "volume" },
  // Count — ratio=1 items: no meaningful suggestion between each other (always 1:1),
  // but including them so cross-kind null-return works correctly.
  "each": { ratio: 1, kind: "count" },
  "roll": { ratio: 1, kind: "count" },
  "case": { ratio: 1, kind: "count" },
  "box": { ratio: 1, kind: "count" },
  "bag": { ratio: 1, kind: "count" },
  "bottle": { ratio: 1, kind: "count" },
  "jar": { ratio: 1, kind: "count" },
  "can": { ratio: 1, kind: "count" },
  "#10 can": { ratio: 1, kind: "count" },
  "half-dozen": { ratio: 6, kind: "count" },
  "dozen": { ratio: 12, kind: "count" },
};

/**
 * Returns a suggested conversion factor representing how many `recipeUnitName`
 * units equal 1 `inventoryUnitName` unit, or `null` when no standard factor
 * exists.
 *
 * Only same-kind pairs (volume↔volume, weight↔weight, count↔count) have a
 * fixed standard factor and will return a value.  Cross-kind pairs such as
 * cup→lb depend on ingredient density and always return `null` so the user
 * must enter their own figure.
 */
export function getSuggestedConversionFactor(
  recipeUnitName: string,
  inventoryUnitName: string,
): number | null {
  const key = (s: string) => s.trim().toLowerCase();
  const recipeEntry = UNIT_BASE_RATIOS[key(recipeUnitName)];
  const inventoryEntry = UNIT_BASE_RATIOS[key(inventoryUnitName)];

  if (!recipeEntry || !inventoryEntry) return null;
  if (recipeEntry.kind !== inventoryEntry.kind) return null;
  if (key(recipeUnitName) === key(inventoryUnitName)) return null;

  // factor = inventoryUnit.toBaseRatio / recipeUnit.toBaseRatio
  const raw = inventoryEntry.ratio / recipeEntry.ratio;

  // Round to up to 6 significant figures, then strip trailing zeros
  return parseFloat(raw.toPrecision(6));
}
