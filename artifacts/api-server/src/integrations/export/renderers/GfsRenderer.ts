import { GenericRenderer } from './GenericRenderer';
import type { ExportInput, ExportResult } from '../PoExportRenderer';

/**
 * Gordon Food Service (GFS) Order Upload Renderer
 *
 * STATUS: FORMAT SPEC PENDING
 * The GFS Marketplace portal accepts CSV order uploads, but the exact column
 * layout for the upload format has not yet been confirmed. This renderer currently
 * produces a generic CSV with a clear warning header.
 *
 * TO IMPLEMENT: Download the GFS order upload template from:
 *   GFS Marketplace → Orders → Create Order → Import from File → Download Template
 * Then replace the render() method body with the confirmed column mapping.
 *
 * Known GFS upload fields (to confirm): Customer Account, GFS Item Number,
 * Order Quantity, Requested Delivery Date
 */
export class GfsRenderer extends GenericRenderer {
  connectorId = 'gfs';
  displayName = 'Gordon Food Service';

  render(input: ExportInput): ExportResult {
    const result = super.render(input);

    const formatWarning =
      'FORMAT UNCONFIRMED: This file uses a generic layout. Verify column order against the ' +
      'GFS Marketplace upload template before submitting. Download the official template from ' +
      'GFS Marketplace → Orders → Create Order → Import from File.';

    const safeName = input.vendorName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const filename = `po-${input.purchaseOrderId.slice(0, 8)}-${safeName}-UNCONFIRMED.csv`;

    return {
      ...result,
      filename,
      warnings: [formatWarning, ...result.warnings],
    };
  }
}
