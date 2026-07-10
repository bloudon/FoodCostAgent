import { GenericRenderer } from './renderers/GenericRenderer';
import { SyscoRenderer } from './renderers/SyscoRenderer';
import { GfsRenderer } from './renderers/GfsRenderer';
import { UsFoodsRenderer } from './renderers/UsFoodsRenderer';
import { PfsRenderer } from './renderers/PfsRenderer';
import { SofoRenderer } from './renderers/SofoRenderer';
import type { PoExportRenderer } from './PoExportRenderer';

export type { PoExportRenderer, ExportInput, ExportResult, ExportValidationResult, ExportLineInput } from './PoExportRenderer';

const renderers: Record<string, PoExportRenderer> = {
  generic: new GenericRenderer(),
  sysco: new SyscoRenderer(),
  gfs: new GfsRenderer(),
  usfoods: new UsFoodsRenderer(),
  pfs: new PfsRenderer(),
  sofo: new SofoRenderer(),
};

export function getExportRenderer(connectorId: string): PoExportRenderer {
  return renderers[connectorId] ?? renderers.generic;
}

/**
 * Infer a connector ID from a vendor name.
 * Used in M1 before CustomerSupplierConnection (M2) is built.
 * M2 will replace this with a proper connection lookup.
 */
export function detectConnectorFromVendorName(vendorName: string): string {
  const lower = vendorName.toLowerCase();
  if (lower.includes('sysco')) return 'sysco';
  if (lower.includes('gordon') || lower.includes(' gfs')) return 'gfs';
  if (lower.includes('us foods') || lower.includes('usfoods')) return 'usfoods';
  if (lower.includes('performance food') || lower.includes(' pfs') || lower === 'pfs') return 'pfs';
  if (lower.includes('sofo')) return 'sofo';
  return 'generic';
}

export function listExportRenderers(): Array<{ connectorId: string; displayName: string; format: string }> {
  return Object.values(renderers).map(r => ({
    connectorId: r.connectorId,
    displayName: r.displayName,
    format: r.format,
  }));
}
