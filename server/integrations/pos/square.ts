/**
 * Square POS Connector
 * Implements PosConnector using Square's REST API directly (no SDK dependency).
 */
import type { PosConnector, PosLocation, PosCatalogVariation, PosSalesBatch, PosSalesLine } from "./types";

const SQUARE_ENV = process.env.SQUARE_ENVIRONMENT || "sandbox";

/**
 * Pinned Square API version.  All requests include this as the `Square-Version`
 * header.  Bump this intentionally after reviewing the Square changelog at
 * https://developer.squareup.com/changelog/apis
 */
export const SQUARE_API_VERSION = "2024-02-28";

/** Status codes that are safe to retry (transient). */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

/** Maximum number of attempts (1 original + 3 retries). */
const MAX_ATTEMPTS = 4;

/** Base delay for exponential backoff (1 s). */
const BASE_DELAY_MS = 1_000;

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

/**
 * Compute the delay before the next retry attempt.
 *
 * @param attempt   Zero-based attempt index (0 = first failure).
 * @param retryAfterMs  Value from the `Retry-After` header in ms, if present.
 * @returns Milliseconds to wait before retrying.
 */
function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs != null) return retryAfterMs;
  // Exponential base-2: 1s, 2s, 4s, 8s + ±25% jitter
  const base = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = base * 0.25 * (Math.random() * 2 - 1); // ±25%
  return Math.max(0, Math.round(base + jitter));
}

/**
 * Injectable sleep function — overridable in unit tests to skip real delays.
 * Import and replace `squareSleepFn` before the test if you need instant retries.
 *
 * @example
 * import { squareTestHooks } from "./square";
 * squareTestHooks.sleep = async () => {};
 */
export const squareTestHooks = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Fetch a Square API endpoint with automatic retry on transient errors.
 *
 * - 401   → throws SquareTokenRevokedError immediately (no retry)
 * - 429   → retries, honouring the Retry-After header when present
 * - 5xx   → retries with exponential backoff + jitter
 * - other → throws immediately
 */
async function squareFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<any> {
  const url = `${baseUrl()}${path}`;
  let lastError: Error = new Error("Square API request failed");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Square-Version": SQUARE_API_VERSION,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (res.ok) return res.json();

    const body = await res.text();

    // Non-retryable errors
    if (!RETRYABLE_STATUS_CODES.has(res.status)) {
      if (res.status === 401) throw new SquareTokenRevokedError(body);
      throw new Error(`Square API ${res.status}: ${body}`);
    }

    // Retryable — record and sleep before next attempt
    lastError = new Error(`Square API ${res.status}: ${body}`);

    if (attempt < MAX_ATTEMPTS - 1) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader != null
        ? Math.ceil(parseFloat(retryAfterHeader) * 1_000)
        : undefined;
      const delay = retryDelayMs(attempt, retryAfterMs);
      await squareTestHooks.sleep(delay);
    }
  }

  throw lastError;
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
      headers: { "Content-Type": "application/json", "Square-Version": SQUARE_API_VERSION },
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
    // Filter by updated_at (not closed_at) so that orders updated by a refund after their
    // original close date re-appear in the rolling window.  The business date is always
    // derived from closed_at so sales land on the correct date regardless of when the
    // refund was applied.
    const batchesByDate = new Map<string, PosSalesLine[]>();
    let cursor: string | undefined;

    do {
      const body: any = {
        location_ids: [locationId],
        query: {
          filter: {
            state_filter: { states: ["COMPLETED"] },
            date_time_filter: {
              updated_at: {
                start_at: `${startDate}T00:00:00Z`,
                end_at: `${endDate}T23:59:59Z`,
              },
            },
          },
          sort: { sort_field: "UPDATED_AT", sort_order: "ASC" },
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
        const closedAt: string = order.closed_at || order.updated_at || "";
        // Derive business date from closedAt timestamp (date portion only)
        const businessDate = closedAt.slice(0, 10);

        if (!batchesByDate.has(businessDate)) {
          batchesByDate.set(businessDate, []);
        }

        // ── Forward sale lines ──────────────────────────────────────────────
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

        // ── Return (refund) line items ──────────────────────────────────────
        // Each entry in order.returns can have multiple return_line_items.
        // Lines with a catalog_object_id are itemized refunds — emit them as
        // negative-quantity rows so that re-ingesting the order correctly
        // reverses the mapped item's theoretical usage.
        // Lines WITHOUT a catalog_object_id are custom-dollar refunds; the
        // ingestion service will detect the missing variationId and skip them.
        for (const ret of order.returns || []) {
          for (const rline of ret.return_line_items || []) {
            const rlineId = rline.uid || `${order.id}-return-${ret.uid ?? ""}`;
            const rqty = -Math.abs(parseFloat(rline.quantity || "0")); // always negative
            const rGross = -(rline.gross_return_money?.amount ?? 0);
            const rNet   = -(rline.total_money?.amount ?? 0);

            const returnLine: PosSalesLine = {
              provider: "square",
              externalLocationId: locationId,
              externalOrderId: order.id,
              externalLineId: rlineId,
              businessDate,
              closedAt,
              externalItemId: rline.catalog_object_id,
              externalVariationId: rline.catalog_object_id, // null for custom-dollar refunds
              externalModifierIds: [],
              itemName: rline.name || "Return",
              variationName: rline.variation_name,
              quantity: rqty,
              grossSalesMoney: rGross,
              discountsMoney: 0,
              netSalesMoney: rNet,
              voidedQuantity: undefined,
              refundedQuantity: Math.abs(rqty),
              rawPayloadReference: JSON.stringify({ orderId: order.id, returnLineUid: rline.uid }),
            };

            batchesByDate.get(businessDate)!.push(returnLine);
          }
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
      headers: { "Content-Type": "application/json", "Square-Version": SQUARE_API_VERSION },
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
