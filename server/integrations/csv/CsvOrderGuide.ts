import { parse } from 'csv-parse/sync';
import type { OrderGuide, VendorProduct, VendorKey } from '../types';

/**
 * CSV Order Guide Parser
 * 
 * Handles CSV-based order guide imports from vendors.
 * Each vendor has slightly different CSV formats, so we map them to a common structure.
 * Uses robust csv-parse library for reliable parsing.
 */

export interface CsvParseOptions {
  vendorKey: VendorKey;
  skipRows?: number;
  delimiter?: string;
  encoding?: string;
  columnMapping?: CsvColumnMapping; // Explicit mapping overrides auto-detection
}

export interface CsvColumnMapping {
  vendorSku: string;
  productName: string;
  description?: string;
  caseSize?: string;
  innerPack?: string;
  unit?: string;
  price?: string;
  brand?: string;
  category?: string;
  upc?: string;
  variableWeight?: string;
  caseWeight?: string;  // Column providing total case weight in LB (for EA+LB → per-each derivation)
}

/**
 * Vendor-specific column mappings
 */
const VENDOR_MAPPINGS: Record<VendorKey, CsvColumnMapping> = {
  generic: {
    vendorSku: '',
    productName: '',
  },
  sysco: {
    vendorSku: 'SUPC',
    productName: 'Product Description',
    description: 'Extended Description',
    caseSize: 'Pack Size',
    innerPack: 'Inner Pack',
    unit: 'Unit of Measure',
    price: 'Unit Price',
    brand: 'Brand',
    category: 'Category Code',
    upc: 'UPC',
    variableWeight: 'Variable Weight',
    caseWeight: 'Net Weight',  // Sysco includes net case weight in LB
  },
  gfs: {
    vendorSku: 'Item Number',
    productName: 'Description',
    description: 'Long Description',
    caseSize: 'Pack',
    innerPack: 'Inner Pack',
    unit: 'Unit',
    price: 'Price',
    brand: 'Brand Name',
    category: 'Category',
    upc: 'GTIN',
    variableWeight: 'Variable Weight',
    caseWeight: 'Case Weight',  // GFS includes case weight in LB
  },
  usfoods: {
    vendorSku: 'Item Code',
    productName: 'Item Description',
    description: 'Full Description',
    caseSize: 'Case Pack',
    innerPack: 'Inner Pack Size',
    unit: 'UOM',
    price: 'Case Price',
    brand: 'Brand',
    category: 'Category ID',
    upc: 'UPC Code',
    variableWeight: 'Catch Weight',
    caseWeight: 'Gross Weight',  // US Foods includes gross case weight in LB
  },
};

/**
 * Generic column name patterns for auto-detection
 * Each pattern is an array of possible column names (case-insensitive)
 */
const GENERIC_COLUMN_PATTERNS: Record<keyof CsvColumnMapping, string[]> = {
  vendorSku: ['item', 'item number', 'item code', 'item #', 'item#', 'sku', 'supc', 'product code', 'product number', 'product #', 'code', 'number'],
  productName: ['description', 'product description', 'item description', 'name', 'product name', 'product'],
  description: ['extended description', 'long description', 'full description', 'details'],
  caseSize: ['pack', 'pack size', 'case pack', 'case size', 'qty', 'quantity'],
  innerPack: ['inner pack', 'inner pack size', 'inner'],
  unit: ['size', 'unit', 'uom', 'unit of measure', 'measure'],
  price: ['price', 'unit price', 'case price', 'cost', 'each'],
  brand: ['brand', 'brand name', 'manufacturer', 'mfr'],
  category: ['category', 'category code', 'category id', 'cat', 'class'],
  upc: ['upc', 'upc code', 'gtin', 'barcode', 'ean'],
  variableWeight: ['variable weight', 'variable', 'catch weight', 'catch', 'vw', 'cw', 'weight type'],
  caseWeight: ['net weight', 'gross weight', 'case weight', 'total weight', 'case lbs', 'net wt', 'gross wt', 'wt'],
};

/**
 * Exported standalone version of parseCompoundPackSize for use in backfill utilities.
 * Parses vendor pack size strings into their components.
 * Handles formats like:
 *   "6/5 LB"  → { caseSize: 6, innerPack: 5, unit: "LB" }
 *   "24/1 CS" → { caseSize: 24, innerPack: 1, unit: "CS" }
 *   "24 EA"   → { caseSize: 24, unit: "EA" }
 *   "24"      → { caseSize: 24 }
 * Returns null for unparseable strings.
 */
export function parseCompoundPackSize(value: string): { caseSize: number; innerPack?: number; unit?: string } | null {
  if (!value) return null;
  const trimmed = value.trim();

  const slashMatch = trimmed.match(/^([\d.]+)\s*\/\s*([\d.]+)\s*([A-Za-z]+)?$/);
  if (slashMatch) {
    const cs = parseFloat(slashMatch[1]);
    const ip = parseFloat(slashMatch[2]);
    const u = slashMatch[3] ? slashMatch[3].toUpperCase() : undefined;
    if (!isNaN(cs) && !isNaN(ip)) return { caseSize: cs, innerPack: ip, unit: u };
  }

  const singleUnitMatch = trimmed.match(/^([\d.]+)\s+([A-Za-z]+)$/);
  if (singleUnitMatch) {
    const cs = parseFloat(singleUnitMatch[1]);
    const u = singleUnitMatch[2].toUpperCase();
    if (!isNaN(cs)) return { caseSize: cs, unit: u };
  }

  const plainMatch = trimmed.match(/^([\d.]+)$/);
  if (plainMatch) {
    const cs = parseFloat(plainMatch[1]);
    if (!isNaN(cs)) return { caseSize: cs };
  }

  return null;
}

/**
 * CSV Order Guide Parser
 */
export class CsvOrderGuide {
  /**
   * Auto-detect column mapping from CSV headers
   */
  private static detectColumnMapping(headers: string[]): CsvColumnMapping {
    const mapping: CsvColumnMapping = {
      vendorSku: '',
      productName: '',
    };
    
    const headerLower = headers.map(h => h.toLowerCase().trim());
    
    // For each field type, find the best matching column
    for (const [field, patterns] of Object.entries(GENERIC_COLUMN_PATTERNS)) {
      for (const pattern of patterns) {
        const index = headerLower.findIndex(h => h === pattern);
        if (index !== -1) {
          (mapping as any)[field] = headers[index];
          break;
        }
      }
    }
    
    console.log('[CsvOrderGuide] Auto-detected column mapping:', mapping);
    return mapping;
  }

  /**
   * Check if vendor-specific mapping matches the CSV headers
   */
  private static vendorMappingMatches(headers: string[], mapping: CsvColumnMapping): boolean {
    const headerSet = new Set(headers.map(h => h.toLowerCase().trim()));
    // Check if at least the vendorSku column matches
    return headerSet.has(mapping.vendorSku.toLowerCase());
  }

  /**
   * Parse CSV file to OrderGuide
   */
  static async parse(
    csvContent: string,
    options: CsvParseOptions
  ): Promise<OrderGuide> {
    const { vendorKey, skipRows = 0, delimiter = ',' } = options;
    const vendorMapping = VENDOR_MAPPINGS[vendorKey];

    // Parse CSV with robust csv-parse library
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true, // Handle UTF-8 BOM
      delimiter,
      from: skipRows + 1, // Skip header rows if needed
    }) as Record<string, string>[];

    if (records.length === 0) {
      return {
        vendorKey,
        products: [],
        effectiveDate: new Date().toISOString(),
      };
    }

    // Get headers from first record
    const headers = Object.keys(records[0]);
    console.log('[CsvOrderGuide] CSV headers:', headers);
    
    // Decide which column mapping to use (priority: explicit > vendor-specific > auto-detected)
    let mapping: CsvColumnMapping;
    if (options.columnMapping && options.columnMapping.productName) {
      console.log('[CsvOrderGuide] Using explicit column mapping provided by caller');
      mapping = options.columnMapping;
    } else if (this.vendorMappingMatches(headers, vendorMapping)) {
      console.log('[CsvOrderGuide] Using vendor-specific mapping for:', vendorKey);
      mapping = vendorMapping;
    } else {
      console.log('[CsvOrderGuide] Vendor mapping not found, using auto-detection');
      mapping = this.detectColumnMapping(headers);
    }

    const products: VendorProduct[] = [];

    for (const row of records) {
      const caseSizeRaw = this.getValue(row, mapping.caseSize);
      const innerPackRaw = this.getValue(row, mapping.innerPack);
      const unitRaw = this.getValue(row, mapping.unit);
      
      // Parse compound pack size string like "6/5 LB" → {caseSize:6, innerPack:5, unit:"LB"}
      // Fixes the parseNumber bug where "6/5 LB" strips to "65" instead of giving 6.
      const parsedCasePack = this.parseCompoundPackSize(caseSizeRaw);
      if (parsedCasePack?.innerPack) {
        console.log(`[CsvOrderGuide] Parsed compound pack: "${caseSizeRaw}" → caseSize:${parsedCasePack.caseSize}, innerPack:${parsedCasePack.innerPack}, unit:${parsedCasePack.unit ?? 'none'}`);
      }

      // Try to parse combined size+unit values like "1 LB", "6 LB", "48 OZ"
      // This handles cases where the Size column contains both pack weight and unit
      const parsedSizeUnit = this.parseSizeWithUnit(unitRaw);
      
      // Determine innerPack: explicit column first, then unit column "18 LB" style,
      // then compound pack string "6/5 LB" style
      let innerPack = this.parseNumber(innerPackRaw);
      let unit = unitRaw;
      
      if (parsedSizeUnit && !innerPack) {
        innerPack = parsedSizeUnit.size;
        unit = parsedSizeUnit.unit;
        console.log(`[CsvOrderGuide] Parsed size+unit: "${unitRaw}" → innerPack: ${innerPack}, unit: ${unit}`);
      }

      if (parsedCasePack) {
        if (!innerPack && parsedCasePack.innerPack) {
          innerPack = parsedCasePack.innerPack;
        }
        if ((!unit || unit === unitRaw) && parsedCasePack.unit && !unitRaw) {
          unit = parsedCasePack.unit;
        }
      }
      
      // Detect variable weight from column or description text
      const variableWeightValue = this.getValue(row, mapping.variableWeight);
      const productName = this.getValue(row, mapping.productName);
      const descriptionValue = this.getValue(row, mapping.description);
      const isVariableWeight = this.detectVariableWeight(variableWeightValue, productName, descriptionValue);
      
      // Use correctly parsed case count (first number from compound string like "6/5 LB" → 6)
      const caseSize = parsedCasePack ? parsedCasePack.caseSize : this.parseNumber(caseSizeRaw);

      // ── EA + LB per-each derivation ────────────────────────────────────────
      // When a vendor provides both a count column (e.g. "24 EA") and a separate
      // case-weight column (e.g. "18 LB"), we can derive the per-each weight:
      //   eaWeight = totalLbs ÷ eaCount   →   0.75 LB per each for 24 EA / 18 LB
      // We then switch the product's tracking unit to LB and set innerPack to the
      // per-each weight so autoSeedRecipeUnitsForItem creates an "each" Recipe Unit.
      const caseWeightRaw = this.getValue(row, mapping.caseWeight);
      let eaPerCase: number | undefined;
      let finalUnit = unit;
      let finalInnerPack = innerPack;
      let finalInnerPackRaw = innerPackRaw || unitRaw || undefined;

      if (
        caseWeightRaw &&
        caseSize != null && caseSize > 0 &&
        this.isCountUnit(unit) &&
        // Skip if the compound pack string already provided an inner-pack breakdown
        // (e.g. "6/5 LB" already gives caseSize=6, innerPack=5, unit=LB — no need to
        // derive from a separate weight column, and doing so would be wrong).
        !parsedCasePack?.innerPack
      ) {
        const totalLbs = this.parseCaseWeightLbs(caseWeightRaw);
        if (totalLbs != null && totalLbs > 0) {
          eaPerCase = totalLbs / caseSize;
          // Switch inventory tracking unit to LB (weight), not EA (count)
          finalUnit = 'LB';
          // Store per-each weight as innerPack so the compound-pack logic in
          // createNewInventoryAndVendorItem computes containerSize correctly
          finalInnerPack = eaPerCase;
          // Use "each" as innerPackRaw — the processor reads this as the
          // containerLabel when it is a non-numeric text string
          finalInnerPackRaw = 'each';
          console.log(
            `[CsvOrderGuide] EA+LB derivation: ${caseSize} EA, ${totalLbs} LB total` +
            ` → ${eaPerCase.toFixed(4)} LB/each; switching unit to LB`
          );
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      const product: VendorProduct = {
        vendorSku: this.getValue(row, mapping.vendorSku),
        vendorProductName: productName,
        description: descriptionValue,
        caseSize,
        caseSizeRaw: caseSizeRaw || undefined,      // Preserve raw pack string (e.g., "6/5 LB")
        innerPack: finalInnerPack,
        innerPackRaw: finalInnerPackRaw,
        unit: finalUnit,
        price: this.parsePrice(this.getValue(row, mapping.price)),
        brandName: this.getValue(row, mapping.brand),
        categoryCode: this.getValue(row, mapping.category),
        upc: this.getValue(row, mapping.upc),
        lastUpdated: new Date().toISOString(),
        isVariableWeight,
        eaPerCase,
      };

      // For generic/unknown vendor imports, a product name alone is sufficient
      // For known vendor parsers, vendorSku is still required for deduplication
      const hasIdentifier = product.vendorSku || product.vendorProductName;
      if (hasIdentifier) {
        // Generate a synthetic SKU for generic imports that have no SKU column
        if (!product.vendorSku && vendorKey === 'generic') {
          product.vendorSku = `GENERIC-${products.length + 1}`;
        }
        products.push(product);
      }
    }

    return {
      vendorKey,
      products,
      effectiveDate: new Date().toISOString(),
    };
  }

  /**
   * Get value from row with fallback
   */
  private static getValue(row: Record<string, string>, key?: string): string {
    if (!key) return '';
    return row[key] || '';
  }

  /**
   * Parse number from string
   */
  private static parseNumber(value: string): number | undefined {
    if (!value) return undefined;
    const num = parseFloat(value.replace(/[^0-9.]/g, ''));
    return isNaN(num) ? undefined : num;
  }

  /**
   * Parse price from string
   */
  private static parsePrice(value: string): number | undefined {
    if (!value) return undefined;
    const price = parseFloat(value.replace(/[$,]/g, ''));
    return isNaN(price) ? undefined : price;
  }

  /**
   * Parse compound vendor pack size strings into their components.
   * Handles formats like:
   *   "6/5 LB"  → { caseSize: 6, innerPack: 5, unit: "LB" }  (6 inner packs × 5 LB each)
   *   "24/1 CS" → { caseSize: 24, innerPack: 1, unit: "CS" }
   *   "24 EA"   → { caseSize: 24, unit: "EA" }
   *   "24"      → { caseSize: 24 }
   * Returns null for unparseable strings.
   */
  private static parseCompoundPackSize(value: string): { caseSize: number; innerPack?: number; unit?: string } | null {
    if (!value) return null;
    const trimmed = value.trim();

    // "6/5 LB" or "6/5" — slash-separated with optional trailing unit
    const slashMatch = trimmed.match(/^([\d.]+)\s*\/\s*([\d.]+)\s*([A-Za-z]+)?$/);
    if (slashMatch) {
      const cs = parseFloat(slashMatch[1]);
      const ip = parseFloat(slashMatch[2]);
      const u = slashMatch[3] ? slashMatch[3].toUpperCase() : undefined;
      if (!isNaN(cs) && !isNaN(ip)) return { caseSize: cs, innerPack: ip, unit: u };
    }

    // "24 EA" or "18 LB" — number then unit (space-separated)
    const singleUnitMatch = trimmed.match(/^([\d.]+)\s+([A-Za-z]+)$/);
    if (singleUnitMatch) {
      const cs = parseFloat(singleUnitMatch[1]);
      const u = singleUnitMatch[2].toUpperCase();
      if (!isNaN(cs)) return { caseSize: cs, unit: u };
    }

    // Plain number
    const plainMatch = trimmed.match(/^([\d.]+)$/);
    if (plainMatch) {
      const cs = parseFloat(plainMatch[1]);
      if (!isNaN(cs)) return { caseSize: cs };
    }

    return null;
  }

  /**
   * Parse combined size+unit string like "1 LB", "6 LB", "48 OZ"
   * Returns {size: number, unit: string} or null if not parseable
   */
  private static parseSizeWithUnit(value: string): { size: number; unit: string } | null {
    if (!value) return null;
    
    // Match patterns like "1 LB", "6 LB", "48 OZ", "5 LB", "1.5 LB", etc.
    const match = value.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
    if (match) {
      const size = parseFloat(match[1]);
      const unit = match[2].toUpperCase();
      if (!isNaN(size) && unit) {
        return { size, unit };
      }
    }
    return null;
  }

  /**
   * Parse a case-weight string and return the value in LB.
   * Handles: "18 LB", "18.5 LB", "18 LBS", "18" (assumes LB).
   * Returns null when the value cannot be parsed or is not in pounds.
   * Intentionally ignores OZ/KG/G to avoid silent unit-conversion errors.
   */
  private static parseCaseWeightLbs(value: string): number | null {
    if (!value) return null;
    const trimmed = value.trim();
    // Match a positive number optionally followed by LB/LBS/POUND/POUNDS (case-insensitive)
    // Also accept bare numbers (assume LB for weight-designated columns)
    const match = trimmed.match(/^([\d.]+)\s*(LBS?|POUNDS?)?$/i);
    if (match) {
      const num = parseFloat(match[1]);
      if (!isNaN(num) && num > 0) return num;
    }
    return null;
  }

  /**
   * Return true when the UOM string represents a per-item count unit (EA, each, ct, pc…)
   * rather than a case, weight, or volume measure.
   *
   * "CS" (case) is intentionally excluded: a row with UOM=CS and a net-weight column
   * means the net weight IS the case weight in the base unit, not a per-each weight
   * that needs derivation.  Including it would incorrectly label every case-UOM row
   * as an "each" product.
   */
  private static isCountUnit(unit: string): boolean {
    if (!unit) return false;
    const u = unit.trim().toLowerCase();
    // Only true EA-like units — deliberately excludes "cs" (case) to prevent false positives
    return ['ea', 'each', 'unit', 'units', 'piece', 'pieces', 'pc', 'pcs', 'ct', 'count'].includes(u);
  }

  /**
   * Detect if an item is variable/catch weight from column value or text indicators
   */
  private static detectVariableWeight(columnValue: string, productName: string, description: string): boolean {
    // Check explicit column value first
    if (columnValue) {
      const val = columnValue.toLowerCase().trim();
      // Positive indicators
      if (val === 'y' || val === 'yes' || val === '1' || val === 'true' || val === 'variable' || val === 'vw' || val === 'cw') {
        return true;
      }
    }
    
    // Check for variable weight indicators in product name or description
    const textToSearch = `${productName} ${description}`.toLowerCase();
    const variableWeightPatterns = [
      'variable weight',
      'catch weight',
      'random weight',
      'sold by weight',
      'priced by weight',
      'weight varies',
      'approx weight',
      'approximate weight',
    ];
    
    for (const pattern of variableWeightPatterns) {
      if (textToSearch.includes(pattern)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Export OrderGuide to CSV
   */
  static async export(orderGuide: OrderGuide): Promise<string> {
    const headers = [
      'Vendor SKU',
      'Product Name',
      'Description',
      'Case Size',
      'Unit',
      'Price',
      'Brand',
      'Category',
      'UPC',
    ];

    const rows = orderGuide.products.map(p => [
      p.vendorSku,
      p.vendorProductName,
      p.description || '',
      p.caseSize?.toString() || '',
      p.unit || '',
      p.price?.toFixed(2) || '',
      p.brandName || '',
      p.categoryCode || '',
      p.upc || '',
    ]);

    const csvLines = [
      headers.join(','),
      ...rows.map(row => row.map(val => `"${val}"`).join(',')),
    ];

    return csvLines.join('\n');
  }
}
