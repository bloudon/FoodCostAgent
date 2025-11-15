import OAuthClient from "intuit-oauth";
import { storage } from "../storage";
import type { QuickBooksConnection } from "@shared/schema";

// Initialize OAuth Client with environment configuration
export function createOAuthClient(): OAuthClient {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || "sandbox";

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing QuickBooks credentials. Please set QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, and QUICKBOOKS_REDIRECT_URI environment variables."
    );
  }

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

// Refresh QuickBooks access token if needed (within 60 seconds of expiry)
export async function refreshTokenIfNeeded(
  companyId: string,
  storeId: string | null
): Promise<string> {
  const connection = await storage.getQuickBooksConnection(companyId, storeId || undefined);

  if (!connection) {
    throw new Error("No active QuickBooks connection found");
  }

  // Check if token needs refresh (within 60 seconds of expiry)
  const now = Date.now();
  const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();

  if (now >= expiresAt - 60000) {
    const oauthClient = createOAuthClient();

    try {
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

      return token.access_token;
    } catch (error: any) {
      console.error("QuickBooks token refresh failed:", error);
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
