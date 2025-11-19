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
