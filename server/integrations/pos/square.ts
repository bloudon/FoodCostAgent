/**
 * Square POS Connector
 * Implements PosConnector using Square's REST API directly (no SDK dependency).
 */
import type { PosConnector, PosLocation, PosCatalogVariation, PosSalesBatch, PosSalesLine } from "./types";

const SQUARE_ENV = process.env.SQUARE_ENVIRONMENT || "sandbox";

function baseUrl(): string {
  return SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function authUrl(): string {
  return SQUARE_ENV === "production"
    ? "https://connect.squareup.com/oauth2/authorize"
    : "https://connect.squareupsandbox.com/oauth2/authorize";
}

/** Thrown when Square returns 401 (token revoked / expired). */
export class SquareTokenRevokedError extends Error {
  readonly code = "SQUARE_TOKEN_REVOKED";
  constructor(body: string) {
    super(`Square API 401: ${body}`);
    this.name = "SquareTokenRevokedError";
  }
}

async function squareFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<any> {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Square-Version": "2024-01-17",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) throw new SquareTokenRevokedError(body);
    throw new Error(`Square API ${res.status}: ${body}`);
  }
  return res.json();
}

/** Build the Square OAuth authorization URL */
export function buildSquareAuthUrl(
  state: string,
  redirectUri: string,
): string {
  const appId = process.env.SQUARE_APP_ID;
  if (!appId) throw new Error("SQUARE_APP_ID environment variable is not set");

  const params = new URLSearchParams({
    client_id: appId,
    response_type: "code",
    scope: "ORDERS_READ ITEMS_READ MERCHANT_PROFILE_READ",
    state,
    redirect_uri: redirectUri,
    session: "false", // Skip the Square login UI if already signed in
  });
  return `${authUrl()}?${params.toString()}`;
}

export const squarePosConnector: PosConnector = {
  providerId: "square",

  async exchangeCode(code: string) {
    const appId = process.env.SQUARE_APP_ID;
    const appSecret = process.env.SQUARE_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error("SQUARE_APP_ID and SQUARE_APP_SECRET must be set");
    }

    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    const redirectUri = replitDomain
      ? `https://${replitDomain}/api/pos/oauth/square/callback`
      : `http://localhost:5000/api/pos/oauth/square/callback`;

    const res = await fetch(`${baseUrl()}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Square-Version": "2024-01-17" },
      body: JSON.stringify({
        client_id: appId,
        client_secret: appSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Square token exchange failed: ${body}`);
    }

    const data = await res.json();
    const merchantId = data.merchant_id || "";

    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string | undefined,
      tokenExpiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
      merchantId,
    };
  },

  async listLocations(accessToken: string): Promise<PosLocation[]> {
    const data = await squareFetch("/v2/locations", accessToken);
    const locations: any[] = data.locations || [];
    return locations.map((loc: any) => ({
      externalId: loc.id,
      name: loc.name,
      address: loc.address
        ? [loc.address.address_line_1, loc.address.locality, loc.address.administrative_district_level_1]
            .filter(Boolean)
            .join(", ")
        : undefined,
      timezone: loc.timezone,
    }));
  },

  async retrieveCatalog(accessToken: string): Promise<PosCatalogVariation[]> {
    const variations: PosCatalogVariation[] = [];
    let cursor: string | undefined;

    // First pass: collect ITEM_VARIATION objects and their parent ITEM names
    const itemNames = new Map<string, string>(); // item ID → item name
    const rawVariations: any[] = [];

    do {
      const body: any = {
        object_types: ["ITEM"],
        include_related_objects: false,
      };
      if (cursor) body.cursor = cursor;

      const data = await squareFetch("/v2/catalog/search-catalog-objects", accessToken, {
        method: "POST",
        body: JSON.stringify(body),
      });

      const objects: any[] = data.catalog_objects || [];
      for (const obj of objects) {
        if (obj.type === "ITEM" && obj.item_data) {
          const itemName = obj.item_data.name || "Unknown Item";
          itemNames.set(obj.id, itemName);
          for (const v of obj.item_data.variations || []) {
            rawVariations.push({ parentId: obj.id, parentName: itemName, variation: v });
          }
        }
      }
      cursor = data.cursor;
    } while (cursor);

    for (const { parentId, parentName, variation } of rawVariations) {
      const v = variation;
      if (!v.item_variation_data) continue;
      variations.push({
        externalItemId: parentId,
        externalVariationId: v.id,
        itemName: parentName,
        variationName: v.item_variation_data.name || "Regular",
        priceMoney: v.item_variation_data.price_money?.amount,
      });
    }

    return variations;
  },

  async retrieveSales(
    accessToken: string,
    locationId: string,
    startDate: string,
    endDate: string,
  ): Promise<PosSalesBatch[]> {
    // Business date filtering: use closed_at range covering the full local day window.
    // Square uses RFC 3339 timestamps — pad with time bounds to cover a full business day.
    const batchesByDate = new Map<string, PosSalesLine[]>();
    let cursor: string | undefined;

    do {
      const body: any = {
        location_ids: [locationId],
        query: {
          filter: {
            state_filter: { states: ["COMPLETED"] },
            date_time_filter: {
              closed_at: {
                start_at: `${startDate}T00:00:00Z`,
                end_at: `${endDate}T23:59:59Z`,
              },
            },
          },
          sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
        },
        limit: 500,
      };
      if (cursor) body.cursor = cursor;

      const data = await squareFetch("/v2/orders/search", accessToken, {
        method: "POST",
        body: JSON.stringify(body),
      });

      const orders: any[] = data.orders || [];
      for (const order of orders) {
        if (!order.line_items) continue;
        const closedAt: string = order.closed_at || order.updated_at || "";
        // Derive business date from closedAt timestamp (date portion only)
        const businessDate = closedAt.slice(0, 10);

        if (!batchesByDate.has(businessDate)) {
          batchesByDate.set(businessDate, []);
        }

        for (const line of order.line_items || []) {
          const lineId = line.uid || line.id || `${order.id}-line`;
          const qty = parseFloat(line.quantity || "0");
          const grossMoney = line.gross_sales_money?.amount ?? 0;
          const discountMoney = line.total_discount_money?.amount ?? 0;
          const netMoney = line.total_money?.amount ?? 0;

          const salesLine: PosSalesLine = {
            provider: "square",
            externalLocationId: locationId,
            externalOrderId: order.id,
            externalLineId: lineId,
            businessDate,
            closedAt,
            externalItemId: line.catalog_object_id,
            externalVariationId: line.catalog_object_id,
            externalModifierIds: (line.modifiers || []).map((m: any) => m.catalog_object_id).filter(Boolean),
            itemName: line.name || "Unknown Item",
            variationName: line.variation_name,
            quantity: qty,
            grossSalesMoney: grossMoney,
            discountsMoney: discountMoney,
            netSalesMoney: netMoney,
            voidedQuantity: undefined,
            refundedQuantity: undefined,
            rawPayloadReference: JSON.stringify({ orderId: order.id, lineUid: line.uid }),
          };

          batchesByDate.get(businessDate)!.push(salesLine);
        }
      }

      cursor = data.cursor;
    } while (cursor);

    return Array.from(batchesByDate.entries()).map(([businessDate, lines]) => ({
      locationId,
      businessDate,
      lines,
    }));
  },

  async refreshCredentials(accessToken: string, refreshToken: string) {
    const appId = process.env.SQUARE_APP_ID;
    const appSecret = process.env.SQUARE_APP_SECRET;
    if (!appId || !appSecret) throw new Error("Square credentials not set");

    const res = await fetch(`${baseUrl()}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Square-Version": "2024-01-17" },
      body: JSON.stringify({
        client_id: appId,
        client_secret: appSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401) throw new SquareTokenRevokedError(body);
      throw new Error(`Square token refresh failed: ${body}`);
    }

    const data = await res.json();
    return {
      accessToken: data.access_token as string,
      tokenExpiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
    };
  },
};
