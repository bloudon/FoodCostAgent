import { parse } from 'csv-parse/sync';

export interface CSVRow {
  date: string;
  store_code: string;
  plu_sku: string;
  qty_sold: number;
  net_sales: number;
  daypart?: string;
}

export interface ParsedCSV {
  rows: CSVRow[];
  errors: string[];
  stats: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
  };
}

export function parseCSV(fileContent: string): ParsedCSV {
  const errors: string[] = [];
  const validRows: CSVRow[] = [];
  let totalRows = 0;

  try {
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];

    totalRows = records.length;

    for (let i = 0; i < records.length; i++) {
      const record = records[i] as Record<string, string>;
      const rowNum = i + 2; // +2 because row 1 is header and we're 0-indexed

      // Validate required fields
      if (!record.date) {
        errors.push(`Row ${rowNum}: Missing 'date' field`);
        continue;
      }
      if (!record.store_code) {
        errors.push(`Row ${rowNum}: Missing 'store_code' field`);
        continue;
      }
      if (!record.plu_sku) {
        errors.push(`Row ${rowNum}: Missing 'plu_sku' field`);
        continue;
      }
      if (!record.qty_sold) {
        errors.push(`Row ${rowNum}: Missing 'qty_sold' field`);
        continue;
      }
      if (!record.net_sales) {
        errors.push(`Row ${rowNum}: Missing 'net_sales' field`);
        continue;
      }

      // Parse and validate date (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(record.date)) {
        errors.push(`Row ${rowNum}: Invalid date format '${record.date}'. Use YYYY-MM-DD`);
        continue;
      }

      // Validate date is parseable
      const parsedDate = new Date(record.date);
      if (isNaN(parsedDate.getTime())) {
        errors.push(`Row ${rowNum}: Invalid date '${record.date}'`);
        continue;
      }

      // Parse numeric fields
      const qtySold = parseFloat(record.qty_sold);
      const netSales = parseFloat(record.net_sales);

      if (isNaN(qtySold) || qtySold < 0) {
        errors.push(`Row ${rowNum}: Invalid qty_sold '${record.qty_sold}'. Must be a positive number`);
        continue;
      }

      if (isNaN(netSales) || netSales < 0) {
        errors.push(`Row ${rowNum}: Invalid net_sales '${record.net_sales}'. Must be a positive number`);
        continue;
      }

      // Build valid row
      const validRow: CSVRow = {
        date: record.date,
        store_code: record.store_code,
        plu_sku: record.plu_sku,
        qty_sold: qtySold,
        net_sales: netSales,
      };

      // Optional daypart field
      if (record.daypart) {
        validRow.daypart = record.daypart;
      }

      validRows.push(validRow);
    }

  } catch (error: any) {
    errors.push(`CSV parsing error: ${error.message}`);
  }

  return {
    rows: validRows,
    errors,
    stats: {
      totalRows,
      validRows: validRows.length,
      invalidRows: errors.length,
    },
  };
}
