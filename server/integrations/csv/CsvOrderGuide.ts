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
}

/**
 * Vendor-specific column mappings
 */
const VENDOR_MAPPINGS: Record<VendorKey, CsvColumnMapping> = {
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
};

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
    
    // Decide whether to use vendor-specific or auto-detected mapping
    let mapping: CsvColumnMapping;
    if (this.vendorMappingMatches(headers, vendorMapping)) {
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
      
      // Try to parse combined size+unit values like "1 LB", "6 LB", "48 OZ"
      // This handles cases where the Size column contains both pack weight and unit
      const parsedSizeUnit = this.parseSizeWithUnit(unitRaw);
      
      // Determine innerPack: use explicit innerPack column first, then parsed from unit column
      let innerPack = this.parseNumber(innerPackRaw);
      let unit = unitRaw;
      
      if (parsedSizeUnit && !innerPack) {
        // If unit column contains combined value like "1 LB" and no explicit innerPack,
        // extract the numeric part as innerPack and the unit abbreviation
        innerPack = parsedSizeUnit.size;
        unit = parsedSizeUnit.unit;
        console.log(`[CsvOrderGuide] Parsed size+unit: "${unitRaw}" → innerPack: ${innerPack}, unit: ${unit}`);
      }
      
      // Detect variable weight from column or description text
      const variableWeightValue = this.getValue(row, mapping.variableWeight);
      const productName = this.getValue(row, mapping.productName);
      const descriptionValue = this.getValue(row, mapping.description);
      const isVariableWeight = this.detectVariableWeight(variableWeightValue, productName, descriptionValue);
      
      const product: VendorProduct = {
        vendorSku: this.getValue(row, mapping.vendorSku),
        vendorProductName: productName,
        description: descriptionValue,
        caseSize: this.parseNumber(caseSizeRaw),
        caseSizeRaw: caseSizeRaw || undefined,      // Preserve raw pack string (e.g., "6/5 LB")
        innerPack: innerPack,
        innerPackRaw: innerPackRaw || unitRaw || undefined,    // Preserve raw inner pack string
        unit: unit,
        price: this.parsePrice(this.getValue(row, mapping.price)),
        brandName: this.getValue(row, mapping.brand),
        categoryCode: this.getValue(row, mapping.category),
        upc: this.getValue(row, mapping.upc),
        lastUpdated: new Date().toISOString(),
        isVariableWeight,
      };

      if (product.vendorSku) {
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
