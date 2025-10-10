import type { VendorAdapter } from './VendorAdapter';
import type { VendorKey, VendorCredentials } from './types';
import { SyscoAdapter } from './adapters/sysco.adapter';
import { GfsAdapter } from './adapters/gfs.adapter';
import { UsFoodsAdapter } from './adapters/usfoods.adapter';

/**
 * Vendor Adapter Registry
 * 
 * Central registry for all vendor integrations.
 * Initializes adapters with credentials from environment/database.
 */

// Mock credentials - in production, these would come from database or secrets
const getCredentials = (vendorKey: VendorKey): VendorCredentials => {
  // TODO: Load from database or environment
  return {
    vendorKey,
    apiKey: process.env[`${vendorKey.toUpperCase()}_API_KEY`],
    apiSecret: process.env[`${vendorKey.toUpperCase()}_API_SECRET`],
    username: process.env[`${vendorKey.toUpperCase()}_USERNAME`],
    password: process.env[`${vendorKey.toUpperCase()}_PASSWORD`],
    accountNumber: process.env[`${vendorKey.toUpperCase()}_ACCOUNT`],
  };
};

// Initialize adapters
const registry: Record<VendorKey, VendorAdapter> = {
  sysco: new SyscoAdapter(getCredentials('sysco')),
  gfs: new GfsAdapter(getCredentials('gfs')),
  usfoods: new UsFoodsAdapter(getCredentials('usfoods')),
};

/**
 * Get vendor adapter by key
 */
export const getVendor = (key: VendorKey): VendorAdapter => {
  const adapter = registry[key];
  if (!adapter) {
    throw new Error(`Unknown vendor: ${key}`);
  }
  return adapter;
};

/**
 * Get all registered vendors
 */
export const getAllVendors = (): VendorAdapter[] => {
  return Object.values(registry);
};

/**
 * Check if vendor supports a specific integration method
 */
export const vendorSupports = (
  key: VendorKey,
  method: 'edi' | 'punchout' | 'csv' | 'api'
): boolean => {
  return registry[key]?.supports[method] ?? false;
};
