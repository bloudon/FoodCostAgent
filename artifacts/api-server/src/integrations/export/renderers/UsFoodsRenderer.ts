import { GenericRenderer } from './GenericRenderer';
import type { ExportInput, ExportResult } from '../PoExportRenderer';

/**
 * US Foods Order Upload Renderer
 *
 * STATUS: FORMAT SPEC PENDING
 * The US Foods Chef'Store / MOXē portal accepts CSV order uploads, but the exact
 * column layout for the upload format has not yet been confirmed. This renderer
 * currently produces a generic CSV with a clear warning header.
 *
 * TO IMPLEMENT: Download the US Foods order upload template from:
 *   US Foods MOXē → Orders → New Order → Import Items → Download Template
 * Then replace the render() method body with the confirmed column mapping.
 *
 * Known US Foods upload fields (to confirm): Account Number, Item Number (US Foods SKU),
 * Quantity, Unit of Measure, Requested Ship Date
 */
export class UsFoodsRenderer extends GenericRenderer {
  connectorId = 'usfoods';
  displayName = 'US Foods';

  render(input: ExportInput): ExportResult {
    const result = super.render(input);

    const formatWarning =
      'FORMAT UNCONFIRMED: This file uses a generic layout. Verify column order against the ' +
      'US Foods MOXē upload template before submitting. Download the official template from ' +
      'US Foods MOXē → Orders → New Order → Import Items.';

    const safeName = input.vendorName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const filename = `po-${input.purchaseOrderId.slice(0, 8)}-${safeName}-UNCONFIRMED.csv`;

    return {
      ...result,
      filename,
      warnings: [formatWarning, ...result.warnings],
    };
  }
}
