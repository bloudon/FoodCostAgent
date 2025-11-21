import OAuthClient from "intuit-oauth";
import { storage } from "../storage";
import type { QuickBooksConnection } from "@shared/schema";

// Initialize OAuth Client with environment configuration
export function createOAuthClient(): OAuthClient {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID?.trim();
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET?.trim();
  const environment = (process.env.QUICKBOOKS_ENVIRONMENT || "sandbox").trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing QuickBooks credentials. Please set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET in Replit Secrets."
    );
  }

  // Auto-construct redirect URI based on Replit domain
  const replitDomain = process.env.REPLIT_DEV_DOMAIN || process.env.REPL_SLUG;
  const redirectUri = replitDomain 
    ? `https://${replitDomain}/api/quickbooks/callback`
    : process.env.QUICKBOOKS_REDIRECT_URI || "http://localhost:5000/api/quickbooks/callback";

  return new OAuthClient({
    clientId,
    clientSecret,
    environment: environment === "production" ? "production" : "sandbox",
    redirectUri,
  });
}

// Get active QuickBooks connection for company/store
// Company-level connection overrides store-level connection
export async function getActiveConnection(
  companyId: string,
  storeId?: string
): Promise<QuickBooksConnection | undefined> {
  return storage.getQuickBooksConnection(companyId, storeId);
}

// Refresh QuickBooks access token if needed (within 5 minutes of expiry)
export async function refreshTokenIfNeeded(
  companyId: string,
  storeId: string | null
): Promise<string> {
  const connection = await storage.getQuickBooksConnection(companyId, storeId || undefined);

  if (!connection) {
    throw new Error("No active QuickBooks connection found");
  }

  // Check if token needs refresh (within 5 minutes of expiry)
  const now = Date.now();
  const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();
  const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

  if (now >= expiresAt - REFRESH_BUFFER_MS) {
    const oauthClient = createOAuthClient();

    try {
      console.log(`🔄 Refreshing QuickBooks token for company ${companyId}${storeId ? ` (store ${storeId})` : ''}`);
      
      const authResponse = await oauthClient.refreshUsingToken(connection.refreshToken);
      const token = authResponse.getJson();

      const accessTokenExpiresAt = new Date(Date.now() + token.expires_in * 1000);
      const refreshTokenExpiresAt = new Date(Date.now() + token.x_refresh_token_expires_in * 1000);

      await storage.updateQuickBooksTokens(companyId, storeId, {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
      });

      console.log(`✅ QuickBooks token refreshed successfully. New expiry: ${accessTokenExpiresAt.toISOString()}`);

      // Log successful refresh
      await storage.logQuickBooksTokenEvent({
        companyId,
        storeId,
        eventType: "refresh_success",
        status: "success",
      });

      return token.access_token;
    } catch (error: any) {
      console.error("❌ QuickBooks token refresh failed:", error);
      
      // Log failed refresh
      await storage.logQuickBooksTokenEvent({
        companyId,
        storeId,
        eventType: "refresh_failed",
        status: "error",
        errorCode: error.code || null,
        errorMessage: error.message,
      });
      
      throw new Error(`Failed to refresh QuickBooks token: ${error.message}`);
    }
  }

  return connection.accessToken;
}

// Initialize OAuth client with stored tokens
export async function getAuthenticatedClient(
  companyId: string,
  storeId?: string
): Promise<{ client: OAuthClient; connection: QuickBooksConnection }> {
  const connection = await storage.getQuickBooksConnection(companyId, storeId);

  if (!connection) {
    throw new Error("No active QuickBooks connection found");
  }

  const accessToken = await refreshTokenIfNeeded(companyId, connection.storeId);

  const client = createOAuthClient();
  client.setToken({
    access_token: accessToken,
    refresh_token: connection.refreshToken,
    realmId: connection.realmId,
  } as any);

  return { client, connection };
}

// Refresh all active QuickBooks connections (for scheduled background job)
export async function refreshAllActiveConnections(): Promise<{
  success: number;
  failed: number;
  errors: Array<{ companyId: string; storeId: string | null; error: string }>;
}> {
  const results = {
    success: 0,
    failed: 0,
    errors: [] as Array<{ companyId: string; storeId: string | null; error: string }>,
  };

  try {
    // Get all active connections
    const connections = await storage.getAllQuickBooksConnections();
    
    console.log(`🔄 Starting scheduled QuickBooks token refresh for ${connections.length} connection(s)`);

    // Refresh each connection
    for (const connection of connections) {
      try {
        await refreshTokenIfNeeded(connection.companyId, connection.storeId);
        results.success++;
      } catch (error: any) {
        results.failed++;
        results.errors.push({
          companyId: connection.companyId,
          storeId: connection.storeId,
          error: error.message,
        });
        console.error(`❌ Failed to refresh token for company ${connection.companyId}:`, error.message);
      }
    }

    console.log(`✅ QuickBooks token refresh completed: ${results.success} success, ${results.failed} failed`);
  } catch (error: any) {
    console.error("❌ Error in refreshAllActiveConnections:", error);
  }

  return results;
}

// QuickBooks Vendor interface (maps to QB vendor fields)
export interface QuickBooksVendor {
  id: string;
  displayName: string;
  companyName?: string;
  printOnCheckName?: string;
  active: boolean;
  taxIdentifier?: string; // Maps to our taxId field
  accountNumber?: string;
  email?: string;
  phone?: string;
  website?: string;
  termId?: string; // Payment terms reference ID
  termName?: string; // Payment terms name (e.g., "Net 30")
}

// Fetch vendors from QuickBooks with comprehensive data
export async function fetchQuickBooksVendors(
  companyId: string,
  storeId?: string,
  includeInactive: boolean = false
): Promise<QuickBooksVendor[]> {
  const { client, connection } = await getAuthenticatedClient(companyId, storeId);

  const apiUrl = process.env.QUICKBOOKS_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

  // Fetch all vendors (or only active ones)
  const activeFilter = includeInactive ? "" : " WHERE Active = true";
  const query = `SELECT * FROM Vendor${activeFilter} ORDER BY DisplayName ASC MAXRESULTS 1000`;
  const url = `${apiUrl}/v3/company/${connection.realmId}/query?query=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${client.getToken().access_token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`QuickBooks API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const vendors = data.QueryResponse?.Vendor || [];

    // Map QB vendor data to our structure
    return vendors.map((vendor: any) => ({
      id: vendor.Id,
      displayName: vendor.DisplayName,
      companyName: vendor.CompanyName,
      printOnCheckName: vendor.PrintOnCheckName,
      active: vendor.Active ?? true,
      taxIdentifier: vendor.TaxIdentifier || vendor.Vendor1099,
      accountNumber: vendor.AcctNum,
      email: vendor.PrimaryEmailAddr?.Address,
      phone: vendor.PrimaryPhone?.FreeFormNumber || vendor.Mobile?.FreeFormNumber,
      website: vendor.WebAddr?.URI,
      termId: vendor.TermRef?.value,
      termName: vendor.TermRef?.name,
    }));
  } catch (error: any) {
    console.error("Error fetching QuickBooks vendors:", error);
    throw new Error(`Failed to fetch QuickBooks vendors: ${error.message}`);
  }
}

// Vendor preview item (shows what would happen during import)
export interface VendorPreviewItem {
  qbVendor: QuickBooksVendor;
  matchType: "exact_match" | "possible_match" | "new_vendor" | "already_synced";
  existingVendor?: {
    id: string;
    name: string;
    accountNumber?: string;
    sourceOfTruth: string;
  };
  recommendedAction: "link" | "create" | "update" | "skip";
}

// Vendor sync result interface
export interface VendorSyncResult {
  success: boolean;
  summary: {
    total: number;
    created: number;
    updated: number;
    matched: number;
    skipped: number;
    errors: number;
  };
  vendors: Array<{
    qbVendorId: string;
    qbVendorName: string;
    foodCostVendorId?: string;
    action: "created" | "updated" | "matched" | "skipped" | "error";
    error?: string;
  }>;
}

// Preview QuickBooks vendors for import (does not modify database)
export async function previewQuickBooksVendors(
  companyId: string,
  storeId?: string
): Promise<VendorPreviewItem[]> {
  try {
    console.log(`🔍 Previewing vendors from QuickBooks for company ${companyId}`);
    
    // Fetch QB vendors
    const qbVendors = await fetchQuickBooksVendors(companyId, storeId, false);
    
    // Get existing FnBcostpro vendors
    const existingVendors = await storage.getVendors(companyId);
    
    // Get existing QB vendor mappings
    const existingMappings = await storage.getQuickBooksVendorMappings(companyId);
    const mappingsByQbVendorId = new Map(
      existingMappings.map(m => [m.quickbooksVendorId, m])
    );
    
    // Build preview items
    const preview: VendorPreviewItem[] = [];
    
    for (const qbVendor of qbVendors) {
      // Check if already synced
      const existingMapping = mappingsByQbVendorId.get(qbVendor.id);
      
      if (existingMapping) {
        const existingVendor = existingVendors.find((v: any) => v.id === existingMapping.vendorId);
        
        if (existingVendor) {
          preview.push({
            qbVendor,
            matchType: "already_synced",
            existingVendor: {
              id: existingVendor.id,
              name: existingVendor.name,
              accountNumber: existingVendor.accountNumber,
              sourceOfTruth: existingVendor.sourceOfTruth,
            },
            recommendedAction: existingVendor.sourceOfTruth === "quickbooks" ? "update" : "skip",
          });
        }
      } else {
        // Try to find a match by name or account number
        const matchedVendor = existingVendors.find((v: any) =>
          v.name.toLowerCase().trim() === qbVendor.displayName.toLowerCase().trim() ||
          (v.accountNumber && qbVendor.accountNumber && 
           v.accountNumber.toLowerCase().trim() === qbVendor.accountNumber.toLowerCase().trim())
        );
        
        if (matchedVendor) {
          // Found a potential match
          const isExactMatch = matchedVendor.name.toLowerCase().trim() === qbVendor.displayName.toLowerCase().trim();
          
          preview.push({
            qbVendor,
            matchType: isExactMatch ? "exact_match" : "possible_match",
            existingVendor: {
              id: matchedVendor.id,
              name: matchedVendor.name,
              accountNumber: matchedVendor.accountNumber,
              sourceOfTruth: matchedVendor.sourceOfTruth,
            },
            recommendedAction: "link",
          });
        } else {
          // No match found - would create new vendor
          preview.push({
            qbVendor,
            matchType: "new_vendor",
            recommendedAction: "create",
          });
        }
      }
    }
    
    console.log(`✅ Preview generated: ${preview.length} vendors`);
    return preview;
  } catch (error: any) {
    console.error("❌ Vendor preview failed:", error);
    throw new Error(`Failed to preview QuickBooks vendors: ${error.message}`);
  }
}

// Synchronize selected vendors from QuickBooks to FnBcostpro
export async function syncVendorsFromQuickBooks(
  companyId: string,
  selectedQbVendorIds: string[],
  storeId?: string
): Promise<VendorSyncResult> {
  const result: VendorSyncResult = {
    success: false,
    summary: {
      total: 0,
      created: 0,
      updated: 0,
      matched: 0,
      skipped: 0,
      errors: 0,
    },
    vendors: [],
  };

  try {
    // Fetch QB vendors
    console.log(`🔄 Fetching vendors from QuickBooks for company ${companyId}`);
    const allQbVendors = await fetchQuickBooksVendors(companyId, storeId, false);
    
    // Filter to only selected vendors
    const qbVendors = allQbVendors.filter(v => selectedQbVendorIds.includes(v.id));
    result.summary.total = qbVendors.length;
    
    console.log(`📋 Processing ${qbVendors.length} selected vendors out of ${allQbVendors.length} total`);

    // Get existing FnBcostpro vendors
    const existingVendors = await storage.getVendors(companyId);
    
    // Get existing QB vendor mappings
    const existingMappings = await storage.getQuickBooksVendorMappings(companyId);
    const mappingsByQbVendorId = new Map(
      existingMappings.map(m => [m.quickbooksVendorId, m])
    );

    for (const qbVendor of qbVendors) {
      try {
        // Check if we already have a mapping for this QB vendor
        const existingMapping = mappingsByQbVendorId.get(qbVendor.id);
        
        if (existingMapping) {
          // Update existing vendor with QB data
          const existingVendor = existingVendors.find((v: any) => v.id === existingMapping.vendorId);
          
          if (existingVendor && existingVendor.sourceOfTruth === "quickbooks") {
            await storage.updateVendor(existingMapping.vendorId, {
              name: qbVendor.displayName,
              accountNumber: qbVendor.accountNumber,
              phone: qbVendor.phone,
              website: qbVendor.website,
              taxId: qbVendor.taxIdentifier,
              paymentTerms: qbVendor.termName,
              active: qbVendor.active ? 1 : 0,
              lastSyncAt: new Date(),
              syncStatus: "synced",
            });
            
            result.summary.updated++;
            result.vendors.push({
              qbVendorId: qbVendor.id,
              qbVendorName: qbVendor.displayName,
              foodCostVendorId: existingMapping.vendorId,
              action: "updated",
            });
          } else {
            // Vendor exists but is manually managed - skip update
            result.summary.skipped++;
            result.vendors.push({
              qbVendorId: qbVendor.id,
              qbVendorName: qbVendor.displayName,
              foodCostVendorId: existingMapping.vendorId,
              action: "skipped",
            });
          }
        } else {
          // Try to match by name or account number
          const matchedVendor = existingVendors.find((v: any) =>
            v.name.toLowerCase().trim() === qbVendor.displayName.toLowerCase().trim() ||
            (v.accountNumber && qbVendor.accountNumber && 
             v.accountNumber.toLowerCase().trim() === qbVendor.accountNumber.toLowerCase().trim())
          );

          if (matchedVendor) {
            // Found a match - create mapping and update vendor to QB-managed
            await storage.createQuickBooksVendorMapping({
              companyId,
              vendorId: matchedVendor.id,
              quickbooksVendorId: qbVendor.id,
              quickbooksVendorName: qbVendor.displayName,
              lastSyncAt: new Date(),
              syncStatus: "synced",
              conflictFlag: 0,
            });

            await storage.updateVendor(matchedVendor.id, {
              qbVendorId: qbVendor.id,
              sourceOfTruth: "quickbooks",
              taxId: qbVendor.taxIdentifier || matchedVendor.taxId,
              paymentTerms: qbVendor.termName || matchedVendor.paymentTerms,
              phone: qbVendor.phone || matchedVendor.phone,
              website: qbVendor.website || matchedVendor.website,
              lastSyncAt: new Date(),
              syncStatus: "synced",
            });

            result.summary.matched++;
            result.vendors.push({
              qbVendorId: qbVendor.id,
              qbVendorName: qbVendor.displayName,
              foodCostVendorId: matchedVendor.id,
              action: "matched",
            });
          } else {
            // No match found - create new vendor
            const newVendor = await storage.createVendor({
              companyId,
              name: qbVendor.displayName,
              accountNumber: qbVendor.accountNumber,
              phone: qbVendor.phone,
              website: qbVendor.website,
              taxId: qbVendor.taxIdentifier,
              paymentTerms: qbVendor.termName,
              active: qbVendor.active ? 1 : 0,
              qbVendorId: qbVendor.id,
              sourceOfTruth: "quickbooks",
              lastSyncAt: new Date(),
              syncStatus: "synced",
              orderGuideType: "manual",
              requires1099: 0,
            });

            // Create mapping
            await storage.createQuickBooksVendorMapping({
              companyId,
              vendorId: newVendor.id,
              quickbooksVendorId: qbVendor.id,
              quickbooksVendorName: qbVendor.displayName,
              lastSyncAt: new Date(),
              syncStatus: "synced",
              conflictFlag: 0,
            });

            result.summary.created++;
            result.vendors.push({
              qbVendorId: qbVendor.id,
              qbVendorName: qbVendor.displayName,
              foodCostVendorId: newVendor.id,
              action: "created",
            });
          }
        }
      } catch (error: any) {
        console.error(`❌ Error processing QB vendor ${qbVendor.displayName}:`, error);
        result.summary.errors++;
        result.vendors.push({
          qbVendorId: qbVendor.id,
          qbVendorName: qbVendor.displayName,
          action: "error",
          error: error.message,
        });
      }
    }

    result.success = result.summary.errors === 0;
    console.log(`✅ Vendor sync completed: ${result.summary.created} created, ${result.summary.updated} updated, ${result.summary.matched} matched, ${result.summary.skipped} skipped, ${result.summary.errors} errors`);
    
    return result;
  } catch (error: any) {
    console.error("❌ Vendor sync failed:", error);
    throw new Error(`Failed to sync vendors from QuickBooks: ${error.message}`);
  }
}
