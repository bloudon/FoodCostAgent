/**
 * M2 — Static Connector Capability Registry
 *
 * Single source of truth for what each connector can do and which transport
 * it uses by default. Consumed by:
 *   - capabilityRouter.ts  (resolving per-company transport for a capability)
 *   - registry.ts          (VendorAdapter stubs for getAllVendors)
 *   - REST endpoints       (GET /api/connector-definitions)
 *
 * Adding a new connector: append an entry to CONNECTOR_DEFINITIONS and export
 * its connectorId in VendorKey (types.ts). No other file needs editing.
 *
 * Capability vocabulary (M2 canonical names):
 *   retrieveCatalog    — sync/import the vendor's order guide / product catalog
 *   retrievePrices     — fetch current pricing without a full catalog sync
 *   retrieveInvoices   — pull invoice records for reconciliation
 *   exportOrderTemplate— generate a file the buyer uploads to the vendor portal
 *   populateCart       — launch a PunchOut session to fill a shopping cart
 *   submitOrder        — transmit a confirmed purchase order to the vendor
 */

import type { ConnectorCapability, ConnectorTransport } from './types';

export interface ConnectorDefinition {
  connectorId: string;
  displayName: string;
  /**
   * Map from capability to transport(s). When multiple transports are listed for
   * a capability (array form), the first element is the preferred/default transport.
   */
  capabilities: Partial<Record<ConnectorCapability, ConnectorTransport | ConnectorTransport[]>>;
}

const CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    connectorId: 'sysco',
    displayName: 'Sysco',
    capabilities: {
      retrieveCatalog:     'csv',
      submitOrder:         'edi',
      exportOrderTemplate: 'csv',
      retrieveInvoices:    'api',
      retrievePrices:      'api',
    },
  },
  {
    connectorId: 'gfs',
    displayName: 'Gordon Food Service',
    capabilities: {
      retrieveCatalog:     'csv',
      submitOrder:         'edi',
      exportOrderTemplate: 'csv',
      retrieveInvoices:    'api',
    },
  },
  {
    connectorId: 'usfoods',
    displayName: 'US Foods',
    capabilities: {
      retrieveCatalog:     'csv',
      submitOrder:         ['edi', 'punchout'],
      exportOrderTemplate: 'csv',
      retrieveInvoices:    'api',
      populateCart:        'punchout',
    },
  },
  {
    connectorId: 'pfs',
    displayName: 'Performance Food Service',
    capabilities: {
      retrieveCatalog:     'csv',
      exportOrderTemplate: 'csv',
    },
  },
  {
    connectorId: 'pfg',
    displayName: 'Performance Food Group (Performance Net)',
    capabilities: {
      retrieveCatalog:     'csv',
      exportOrderTemplate: 'csv',
    },
  },
  {
    connectorId: 'bek',
    displayName: 'Ben E. Keith',
    capabilities: {
      retrieveCatalog:     'csv',
      exportOrderTemplate: 'csv',
    },
  },
  {
    connectorId: 'sofo',
    displayName: 'Southern Foods',
    capabilities: {
      retrieveCatalog:     'csv',
      exportOrderTemplate: 'csv',
    },
  },
  {
    connectorId: 'generic',
    displayName: 'Generic Vendor',
    capabilities: {
      retrieveCatalog:     'csv',
      exportOrderTemplate: 'csv',
    },
  },
];

/**
 * Look up the full definition for a connector.
 */
export function getConnectorDefinition(connectorId: string): ConnectorDefinition | null {
  return CONNECTOR_DEFINITIONS.find(d => d.connectorId === connectorId) ?? null;
}

/**
 * Get the preferred (first) transport for a capability on a given connector.
 * When a connector lists the same capability with multiple transports (e.g. US Foods
 * ['edi', 'punchout'] for submitOrder), the first entry is the preferred default.
 * Returns null when the connector does not support that capability at all.
 */
export function getConnectorCapability(
  connectorId: string,
  capability: ConnectorCapability,
): ConnectorTransport | null {
  const def = getConnectorDefinition(connectorId);
  if (!def) return null;
  const value = def.capabilities[capability];
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Alias for getConnectorCapability — returns the preferred transport for a
 * capability. Named getPreferredTransport to make intent explicit at call sites.
 */
export function getPreferredTransport(
  connectorId: string,
  capability: ConnectorCapability,
): ConnectorTransport | null {
  return getConnectorCapability(connectorId, capability);
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
