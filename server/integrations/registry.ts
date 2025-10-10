import type { VendorAdapter } from './VendorAdapter';
import type { VendorKey, VendorCredentials as IntegrationCredentials } from './types';
import { SyscoAdapter } from './adapters/sysco.adapter';
import { GfsAdapter } from './adapters/gfs.adapter';
import { UsFoodsAdapter } from './adapters/usfoods.adapter';
import { storage } from '../storage';

/**
 * Vendor Adapter Registry
 * 
 * Central registry for all vendor integrations.
 * Loads credentials from database and initializes adapters dynamically.
 */

// Cache for adapters to avoid recreating them on every request
const adapterCache: Partial<Record<VendorKey, VendorAdapter>> = {};

/**
 * Convert database credentials to integration credentials
 */
const convertCredentials = (dbCreds: any): IntegrationCredentials => {
  return {
    vendorKey: dbCreds.vendorKey as VendorKey,
    apiKey: dbCreds.apiKey,
    apiSecret: dbCreds.apiSecret,
    apiUrl: dbCreds.apiUrl,
    username: dbCreds.username,
    password: dbCreds.password,
    accountNumber: dbCreds.accountNumber,
    ediIsaId: dbCreds.ediIsaId,
    ediGsId: dbCreds.ediGsId,
    ediQualifier: dbCreds.ediQualifier,
    as2Url: dbCreds.as2Url,
    as2Identifier: dbCreds.as2Identifier,
    sftpHost: dbCreds.sftpHost,
    sftpPort: dbCreds.sftpPort,
    sftpUsername: dbCreds.sftpUsername,
    sftpPassword: dbCreds.sftpPassword,
    sftpPath: dbCreds.sftpPath,
    punchoutUrl: dbCreds.punchoutUrl,
    punchoutDomain: dbCreds.punchoutDomain,
    punchoutIdentity: dbCreds.punchoutIdentity,
    sharedSecret: dbCreds.sharedSecret,
  };
};

/**
 * Get credentials for a vendor from database or environment
 */
const getCredentials = async (vendorKey: VendorKey): Promise<IntegrationCredentials> => {
  // Try to load from database first
  const dbCreds = await storage.getVendorCredentialsByKey(vendorKey);
  
  if (dbCreds && dbCreds.isActive) {
    return convertCredentials(dbCreds);
  }
  
  // Fallback to environment variables
  return {
    vendorKey,
    apiKey: process.env[`${vendorKey.toUpperCase()}_API_KEY`],
    apiSecret: process.env[`${vendorKey.toUpperCase()}_API_SECRET`],
    username: process.env[`${vendorKey.toUpperCase()}_USERNAME`],
    password: process.env[`${vendorKey.toUpperCase()}_PASSWORD`],
    accountNumber: process.env[`${vendorKey.toUpperCase()}_ACCOUNT`],
  };
};

/**
 * Create adapter for a vendor with credentials
 */
const createAdapter = async (vendorKey: VendorKey): Promise<VendorAdapter> => {
  const credentials = await getCredentials(vendorKey);
  
  switch (vendorKey) {
    case 'sysco':
      return new SyscoAdapter(credentials);
    case 'gfs':
      return new GfsAdapter(credentials);
    case 'usfoods':
      return new UsFoodsAdapter(credentials);
    default:
      throw new Error(`Unknown vendor: ${vendorKey}`);
  }
};

/**
 * Get vendor adapter by key (loads credentials from database)
 * Only returns adapters for active credentials
 */
export const getVendor = async (key: VendorKey): Promise<VendorAdapter> => {
  // Check if credentials are active before using cache
  const dbCreds = await storage.getVendorCredentialsByKey(key);
  
  // If credentials are inactive or don't exist, clear cache and throw error
  if (!dbCreds || !dbCreds.isActive) {
    clearAdapterCache(key);
    throw new Error(`Vendor credentials for ${key} are not active or not configured`);
  }
  
  // Check cache - but revalidate if credentials were recently updated
  const cached = adapterCache[key];
  if (cached) {
    return cached;
  }
  
  // Create and cache adapter
  const adapter = await createAdapter(key);
  adapterCache[key] = adapter;
  
  return adapter;
};

/**
 * Clear adapter cache (call when credentials are updated)
 */
export const clearAdapterCache = (vendorKey?: VendorKey): void => {
  if (vendorKey) {
    delete adapterCache[vendorKey];
  } else {
    // Clear all
    Object.keys(adapterCache).forEach(key => {
      delete adapterCache[key as VendorKey];
    });
  }
};

/**
 * Get all available vendors (without credentials check)
 */
export const getAllVendors = (): VendorAdapter[] => {
  // Return stub adapters for listing purposes
  return [
    { key: 'sysco', name: 'Sysco', supports: { edi: true, punchout: false, csv: true, api: true } } as VendorAdapter,
    { key: 'gfs', name: 'Gordon Food Service', supports: { edi: true, punchout: false, csv: true, api: true } } as VendorAdapter,
    { key: 'usfoods', name: 'US Foods', supports: { edi: true, punchout: true, csv: true, api: true } } as VendorAdapter,
  ];
};

/**
 * Check if vendor supports a specific integration method
 */
export const vendorSupports = async (
  key: VendorKey,
  method: 'edi' | 'punchout' | 'csv' | 'api'
): Promise<boolean> => {
  const adapter = await getVendor(key);
  return adapter.supports[method] ?? false;
};
