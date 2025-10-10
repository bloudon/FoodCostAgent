import type { OrderGuide, VendorProduct, VendorKey } from '../types';

/**
 * CSV Order Guide Parser
 * 
 * Handles CSV-based order guide imports from vendors.
 * Each vendor has slightly different CSV formats, so we map them to a common structure.
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

    const lines = csvContent.split('\n').slice(skipRows);
    const headers = lines[0].split(delimiter).map(h => h.trim());
    
    const products: VendorProduct[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const values = this.parseCsvLine(line, delimiter);
      const row = this.createRowObject(headers, values);

      const product: VendorProduct = {
        vendorSku: this.getValue(row, mapping.vendorSku),
        vendorProductName: this.getValue(row, mapping.productName),
        description: this.getValue(row, mapping.description),
        caseSize: this.parseNumber(this.getValue(row, mapping.caseSize)),
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
   * Parse CSV line handling quoted fields
   */
  private static parseCsvLine(line: string, delimiter: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    values.push(current.trim());
    return values;
  }

  /**
   * Create row object from headers and values
   */
  private static createRowObject(
    headers: string[],
    values: string[]
  ): Record<string, string> {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = values[i] || '';
    });
    return obj;
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
