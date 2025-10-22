import { parse } from 'csv-parse/sync';

export interface ParsedMenuItem {
  name: string;
  department: string;
  category: string;
  size: string;
  pluSku: string; // Unique identifier: "{Item}|{Size}"
  isRecipeItem: boolean; // False for non-recipe items like napkins
}

export interface CsvParseResult {
  items: ParsedMenuItem[];
  totalRows: number;
  uniqueItems: number;
  posLocationId: string | null; // POS location identifier from CSV
}

interface PosCsvRecord {
  Location?: string;
  Department?: string;
  Category?: string;
  Item?: string;
  Size?: string;
  Quantity?: string;
  'Gross Revenue'?: string;
  'Item Total Offers'?: string;
  'Net Revenue'?: string;
}

/**
 * Parse POS sales CSV and extract unique menu items
 * Supports various POS systems (Toast, HungerRush, Thrive, Clover)
 */
export function parsePosMenuCsv(csvContent: string): CsvParseResult {
  // Parse CSV with headers
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true, // Handle UTF-8 BOM
  }) as PosCsvRecord[];

  const itemsMap = new Map<string, ParsedMenuItem>();
  let posLocationId: string | null = null;

  // Non-recipe item keywords (case-insensitive)
  const nonRecipeKeywords = [
    'napkin', 'plate', 'fork', 'knife', 'spoon', 'cup', 'lid',
    'container', 'box', 'bag', 'straw', 'menu', 'ketchup', 'mustard',
    'mayo', 'sauce', 'dressing', 'utensil', 'time', 'note'
  ];

  for (const record of records) {
    // Extract POS location from first row (consistent across all rows)
    if (!posLocationId && record.Location) {
      posLocationId = record.Location.trim();
    }

    const department = record.Department?.trim() || '';
    const category = record.Category?.trim() || '';
    const item = record.Item?.trim() || '';
    const size = record.Size?.trim() || '';

    // Skip empty items or deferred notes/times
    if (!item || department.toLowerCase().includes('deferred')) {
      continue;
    }

    // Create unique PLU/SKU identifier
    const pluSku = size ? `${item}|${size}` : `${item}|`;

    // Check if this is a non-recipe item
    const itemLower = item.toLowerCase();
    const isRecipeItem = !nonRecipeKeywords.some(keyword => 
      itemLower.includes(keyword)
    );

    // Add to map (deduplicates automatically)
    if (!itemsMap.has(pluSku)) {
      itemsMap.set(pluSku, {
        name: item,
        department,
        category,
        size,
        pluSku,
        isRecipeItem,
      });
    }
  }

  const items = Array.from(itemsMap.values());

  return {
    items,
    totalRows: records.length,
    uniqueItems: items.length,
    posLocationId,
  };
}
