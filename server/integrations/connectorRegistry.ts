/**
 * M2 — Static Connector Capability Registry
 *
 * Single source of truth for what each connector can do and which transport
 * it uses by default. Consumed by:
 *   - capabilityRouter.ts  (resolving per-company transport for a capability)
 *   - VendorAdapter stubs  (getAllVendors capability lists)
 *   - REST endpoints       (GET /api/connector-definitions)
 *
 * Adding a new connector: append an entry to CONNECTOR_DEFINITIONS and export
 * its connectorId in VendorKey (types.ts). No other file needs editing.
 */

import type { ConnectorCapability, ConnectorTransport, CapabilitySpec } from './types';

export interface ConnectorDefinition {
  connectorId: string;
  displayName: string;
  /** Ordered list of capability-transport bindings. First entry per capability is the preferred default. */
  capabilities: CapabilitySpec[];
}

const CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    connectorId: 'sysco',
    displayName: 'Sysco',
    capabilities: [
      { capability: 'order_guide_import',    transport: 'csv'  },
      { capability: 'purchase_order_export', transport: 'edi'  },
      { capability: 'invoice_fetch',         transport: 'api'  },
      { capability: 'price_sync',            transport: 'api'  },
    ],
  },
  {
    connectorId: 'gfs',
    displayName: 'Gordon Food Service',
    capabilities: [
      { capability: 'order_guide_import',    transport: 'csv' },
      { capability: 'purchase_order_export', transport: 'edi' },
      { capability: 'invoice_fetch',         transport: 'api' },
    ],
  },
  {
    connectorId: 'usfoods',
    displayName: 'US Foods',
    capabilities: [
      { capability: 'order_guide_import',    transport: 'csv'      },
      { capability: 'purchase_order_export', transport: 'edi'      },
      { capability: 'purchase_order_export', transport: 'punchout' },
      { capability: 'invoice_fetch',         transport: 'api'      },
      { capability: 'punchout_shop',         transport: 'punchout' },
    ],
  },
  {
    connectorId: 'pfs',
    displayName: 'Performance Food Service',
    capabilities: [
      { capability: 'order_guide_import',    transport: 'csv' },
      { capability: 'purchase_order_export', transport: 'csv' },
    ],
  },
  {
    connectorId: 'sofo',
    displayName: 'Southern Foods',
    capabilities: [
      { capability: 'order_guide_import',    transport: 'csv' },
      { capability: 'purchase_order_export', transport: 'csv' },
    ],
  },
  {
    connectorId: 'generic',
    displayName: 'Generic Vendor',
    capabilities: [
      { capability: 'order_guide_import',    transport: 'csv' },
      { capability: 'purchase_order_export', transport: 'csv' },
    ],
  },
];

/**
 * Look up the full definition for a connector.
 */
export function getConnectorDefinition(connectorId: string): ConnectorDefinition | null {
  return CONNECTOR_DEFINITIONS.find(d => d.connectorId === connectorId) ?? null;
}

/**
 * Get the default transport for a capability on a given connector.
 * When a connector lists the same capability with multiple transports (e.g. US Foods
 * EDI + PunchOut for purchase_order_export), the first entry is the preferred default.
 * Returns null when the connector does not support that capability at all.
 */
export function getConnectorCapability(
  connectorId: string,
  capability: ConnectorCapability,
): ConnectorTransport | null {
  const def = getConnectorDefinition(connectorId);
  if (!def) return null;
  return def.capabilities.find(c => c.capability === capability)?.transport ?? null;
}

/**
 * Returns true when the connector has at least one transport for the given capability.
 */
export function connectorSupports(connectorId: string, capability: ConnectorCapability): boolean {
  return getConnectorCapability(connectorId, capability) !== null;
}

/**
 * All defined connectors — used by the connector-definitions REST endpoint.
 */
export function listConnectorDefinitions(): ConnectorDefinition[] {
  return CONNECTOR_DEFINITIONS;
}
