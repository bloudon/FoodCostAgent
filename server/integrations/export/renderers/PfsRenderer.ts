import { GenericRenderer } from './GenericRenderer';
import type { ExportInput, ExportResult } from '../PoExportRenderer';

/**
 * Performance Foodservice (PFS) Order Upload Renderer
 *
 * STATUS: FORMAT UNCONFIRMED
 * The PFS eBiz portal accepts CSV order uploads, but the exact column layout
 * for the upload format has not yet been confirmed against the official template.
 *
 * TO CONFIRM: Download the upload template from:
 *   PFS eBiz portal → My Orders → Import Order → Download Template
 * Then update the render() body with the confirmed column mapping.
 *
 * Expected PFS upload fields: Item Number (Product Number), Quantity, UOM
 */
export class PfsRenderer extends GenericRenderer {
  connectorId = 'pfs';
  displayName = 'Performance Foodservice (PFS)';

  render(input: ExportInput): ExportResult {
    const result = super.render(input);

    const formatWarning =
      'FORMAT UNCONFIRMED: This file uses a generic layout. Verify column order against the ' +
      'PFS eBiz upload template before submitting. Download the official template from ' +
      'PFS eBiz → My Orders → Import Order → Download Template.';

    const safeName = input.vendorName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const filename = `po-${input.purchaseOrderId.slice(0, 8)}-${safeName}-UNCONFIRMED.csv`;

    return {
      ...result,
      filename,
      warnings: [formatWarning, ...result.warnings],
    };
  }
}
