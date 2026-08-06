import { GenericRenderer } from './GenericRenderer';
import type { ExportInput, ExportResult } from '../PoExportRenderer';

/**
 * Sysco Order Upload Renderer
 *
 * STATUS: FORMAT SPEC PENDING
 * The Sysco Market Connect portal accepts CSV order uploads, but the exact column
 * layout for the upload format has not yet been confirmed. This renderer currently
 * produces a generic CSV with a clear warning header.
 *
 * TO IMPLEMENT: Download the Sysco order upload template from:
 *   Sysco Market Connect → My Orders → Upload Order → Download Template
 * Then replace the render() method body with the confirmed column mapping.
 *
 * Known Sysco upload fields (to confirm): Customer Number, Item Number (Sysco SKU),
 * Quantity, Unit of Measure, Requested Delivery Date
 */
export class SyscoRenderer extends GenericRenderer {
  connectorId = 'sysco';
  displayName = 'Sysco';

  render(input: ExportInput): ExportResult {
    const result = super.render(input);

    const formatWarning =
      'FORMAT UNCONFIRMED: This file uses a generic layout. Verify column order against the ' +
      'Sysco Market Connect upload template before submitting. Download the official template from ' +
      'Sysco Market Connect → My Orders → Upload Order.';

    const safeName = input.vendorName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const filename = `po-${input.purchaseOrderId.slice(0, 8)}-${safeName}-UNCONFIRMED.csv`;

    return {
      ...result,
      filename,
      warnings: [formatWarning, ...result.warnings],
    };
  }
}
