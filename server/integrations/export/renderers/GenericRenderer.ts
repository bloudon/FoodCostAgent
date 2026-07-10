import type { PoExportRenderer, ExportInput, ExportValidationResult, ExportResult } from '../PoExportRenderer';

export class GenericRenderer implements PoExportRenderer {
  connectorId = 'generic';
  displayName = 'Generic CSV';
  format = 'csv' as const;

  validate(input: ExportInput): ExportValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (input.lines.length === 0) {
      errors.push('Purchase order has no line items');
    }

    const zeroQty = input.lines.filter(l => (l.caseQuantity ?? l.orderedQty) <= 0);
    if (zeroQty.length > 0) {
      errors.push(`${zeroQty.length} item(s) have a quantity of zero`);
    }

    const missingSkus = input.lines.filter(l => !l.vendorSku);
    if (missingSkus.length > 0) {
      warnings.push(`${missingSkus.length} item(s) have no vendor SKU and will be identified by name only`);
    }

    if (!input.accountNumber) {
      warnings.push('No account number on file for this vendor — add it in Vendor Settings');
    }

    return { canExport: errors.length === 0, errors, warnings };
  }

  render(input: ExportInput): ExportResult {
    const rows: string[] = [];
    const allWarnings: string[] = [];

    rows.push(`# FNB Cost Pro Purchase Order Export`);
    rows.push(`# Vendor: ${input.vendorName}`);
    rows.push(`# Account: ${input.accountNumber || 'N/A'}`);
    rows.push(`# Expected Delivery: ${input.expectedDate || 'N/A'}`);
    rows.push(`# Exported: ${input.exportedAt.toISOString()}`);
    if (input.notes) rows.push(`# Notes: ${input.notes}`);
    rows.push('');
    rows.push('SKU,Item Name,Cases Ordered,Unit Price,Case Price,Line Total');

    let lineCount = 0;

    for (const line of input.lines) {
      const qty = line.caseQuantity ?? line.orderedQty;
      if (qty <= 0) continue;

      if (!line.vendorSku) {
        allWarnings.push(`"${line.itemName}" has no vendor SKU`);
      }

      const sku = line.vendorSku || '';
      const name = `"${line.itemName.replace(/"/g, '""')}"`;
      const casePrice = line.priceEach * line.caseSize;
      const lineTotal = qty * casePrice;

      rows.push(`${sku},${name},${qty},${line.priceEach.toFixed(4)},${casePrice.toFixed(2)},${lineTotal.toFixed(2)}`);
      lineCount++;
    }

    const buffer = Buffer.from(rows.join('\n'), 'utf-8');
    const safeName = input.vendorName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const filename = `po-${input.purchaseOrderId.slice(0, 8)}-${safeName}.csv`;

    return { buffer, filename, mimeType: 'text/csv', lineCount, warnings: allWarnings };
  }
}
