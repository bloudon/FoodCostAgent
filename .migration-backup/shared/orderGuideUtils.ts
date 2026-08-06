/**
 * Shared order-guide utilities used by both the server (orderGuideProcessor)
 * and the client (order-guide-review page).
 *
 * Keeping detection logic here prevents server/client drift.
 */

/**
 * Normalise a pack UOM string before classification:
 *   - lowercase
 *   - strip punctuation periods  ("fl. oz." → "fl oz")
 *   - collapse runs of whitespace ("fl  oz"  → "fl oz")
 *   - trim leading/trailing whitespace
 */
function normalizeUom(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FLUID_OZ_UOMS = new Set([
  'oz', 'ounce', 'ounces',
  'fl oz', 'floz',
  'fluid ounce', 'fluid ounces',
]);

/**
 * Returns true when the product name clearly describes individual bottles or
 * cans AND the pack UOM is a fluid/volume unit (oz, fl oz, …).
 *
 * In that scenario a pack string like "24 × 12 OZ" means 24 containers of
 * 12 oz each, so the correct inventory unit is "each" (price per bottle/can),
 * not "oz" (which would produce a per-ounce price that is ~24× too low).
 *
 * UOM matching is normalised: periods are stripped and whitespace is collapsed
 * so "fl. oz.", "fl. oz", and "floz" all match alongside plain "oz".
 */
export function isBottleOrCanWithFluidOz(
  productName: string | null | undefined,
  packUom: string | null | undefined,
): boolean {
  const name = (productName ?? '').toLowerCase();
  const hasBottleOrCan = /\b(bottle|bottles|can|cans)\b/.test(name);
  const hasFluidOzUom  = FLUID_OZ_UOMS.has(normalizeUom(packUom));
  return hasBottleOrCan && hasFluidOzUom;
}
