/**
 * M2 — Capability Router
 *
 * Central resolution point: given a company + vendor + capability, returns
 * which connector and transport should be used.
 *
 * Resolution order:
 *   1. CustomerSupplierConnection.transportOverrides[capability]  (per-company override)
 *   2. Default transport from the connector's capability registry
 *   3. Name-based connector detection (M1 fallback — used when no DB connection exists)
 *
 * Callers that only need the connectorId (e.g. PO export) can use resolveConnectorId.
 */

import type { ConnectorCapability, ConnectorTransport } from './types';
import { getConnectorCapability } from './connectorRegistry';
import { detectConnectorFromVendorName } from './export/index';
import { storage } from '../storage';

export interface ResolvedCapability {
  connectorId: string;
  transport: ConnectorTransport;
  /** true when resolved via a CustomerSupplierConnection row; false when using M1 name fallback */
  fromConnection: boolean;
}

/**
 * Resolve the transport (and connector) to use for a specific capability on a
 * company-vendor pair.
 *
 * Returns null only when neither the connector nor the generic fallback supports
 * the requested capability.
 */
export async function resolveTransport(
  companyId: string,
  vendorId: string,
  capability: ConnectorCapability,
): Promise<ResolvedCapability | null> {
  const connection = await storage.getCustomerSupplierConnection(companyId, vendorId);

  if (connection && connection.isActive) {
    const overrides = connection.transportOverrides as Record<string, string> | null;
    const override = overrides?.[capability];
    if (override) {
      return { connectorId: connection.connectorId, transport: override as ConnectorTransport, fromConnection: true };
    }
    const transport = getConnectorCapability(connection.connectorId, capability);
    if (transport) return { connectorId: connection.connectorId, transport, fromConnection: true };
    return null;
  }

  // M1 fallback — name detection
  const vendor = await storage.getVendor(vendorId, companyId);
  const connectorId = vendor ? detectConnectorFromVendorName(vendor.name) : 'generic';
  const transport = getConnectorCapability(connectorId, capability);
  return transport ? { connectorId, transport, fromConnection: false } : null;
}

/**
 * Resolve just the connectorId for a company-vendor pair.
 * Use this when the caller only needs the connector key (e.g. PO export renderer lookup).
 */
export async function resolveConnectorId(
  companyId: string,
  vendorId: string,
): Promise<string> {
  const connection = await storage.getCustomerSupplierConnection(companyId, vendorId);
  if (connection && connection.isActive) return connection.connectorId;
  const vendor = await storage.getVendor(vendorId, companyId);
  return vendor ? detectConnectorFromVendorName(vendor.name) : 'generic';
}
