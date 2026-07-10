import { GenericRenderer } from './GenericRenderer';
import type { ExportInput, ExportResult } from '../PoExportRenderer';

/**
 * SOFO Foods Order Upload Renderer
 *
 * STATUS: FORMAT UNCONFIRMED
 * SOFO Foods (Toledo, OH) order upload format has not yet been confirmed against
 * the official portal template.
 *
 * TO CONFIRM: Contact your SOFO Foods sales rep or log into the SOFO ordering
 * portal and download the order upload template, then update the render() body
 * with the confirmed column mapping.
 *
 * Expected SOFO upload fields: Item Number, Quantity (and possibly UOM/notes)
 */
export class SofoRenderer extends GenericRenderer {
  connectorId = 'sofo';
  displayName = 'SOFO Foods';

  render(input: ExportInput): ExportResult {
    const result = super.render(input);

    const formatWarning =
      'FORMAT UNCONFIRMED: This file uses a generic layout. Verify column order against the ' +
      'SOFO Foods upload template before submitting. Contact your SOFO sales rep to obtain ' +
      'the official order import template.';

    const safeName = input.vendorName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const filename = `po-${input.purchaseOrderId.slice(0, 8)}-${safeName}-UNCONFIRMED.csv`;

    return {
      ...result,
      filename,
      warnings: [formatWarning, ...result.warnings],
    };
  }
}
