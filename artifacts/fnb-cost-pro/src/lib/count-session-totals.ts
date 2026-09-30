export type CountSessionLineIdentity = {
  inventoryItemId: string;
};

export function getCountSessionTotals(
  lines: CountSessionLineIdentity[] | undefined,
): { distinctItems: number; itemLocationLines: number } {
  if (!lines) return { distinctItems: 0, itemLocationLines: 0 };
  return {
    distinctItems: new Set(lines.map((line) => line.inventoryItemId)).size,
    itemLocationLines: lines.length,
  };
}