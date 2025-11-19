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
  },
};

/**
 * CSV Order Guide Parser
 */
export class CsvOrderGuide {
  /**
   * Parse CSV file to OrderGuide
   */
  static async parse(
    csvContent: string,
    options: CsvParseOptions
  ): Promise<OrderGuide> {
    const { vendorKey, skipRows = 0, delimiter = ',' } = options;
    const mapping = VENDOR_MAPPINGS[vendorKey];

    // Parse CSV with robust csv-parse library
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true, // Handle UTF-8 BOM
      delimiter,
      from: skipRows + 1, // Skip header rows if needed
    }) as Record<string, string>[];

    const products: VendorProduct[] = [];

    for (const row of records) {
      const product: VendorProduct = {
        vendorSku: this.getValue(row, mapping.vendorSku),
        vendorProductName: this.getValue(row, mapping.productName),
        description: this.getValue(row, mapping.description),
        caseSize: this.parseNumber(this.getValue(row, mapping.caseSize)),
        innerPack: this.parseNumber(this.getValue(row, mapping.innerPack)),
        unit: this.getValue(row, mapping.unit),
        price: this.parsePrice(this.getValue(row, mapping.price)),
        brandName: this.getValue(row, mapping.brand),
        categoryCode: this.getValue(row, mapping.category),
        upc: this.getValue(row, mapping.upc),
        lastUpdated: new Date().toISOString(),
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
