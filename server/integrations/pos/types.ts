/**
 * POS Connector Foundation — shared types and interface
 * Every POS adapter (Square, Clover, etc.) implements PosConnector.
 */

export interface PosLocation {
  externalId: string;
  name: string;
  address?: string;
  timezone?: string;
}

export interface PosCatalogVariation {
  externalItemId: string;
  externalVariationId: string;
  itemName: string;
  variationName: string;
  priceMoney?: number; // in smallest currency unit
}

export interface PosSalesLine {
  provider: string;
  externalLocationId: string;
  externalOrderId: string;
  externalLineId: string;

  businessDate: string; // YYYY-MM-DD local business date
  closedAt: string; // ISO timestamp

  externalItemId?: string;
  externalVariationId?: string;
  externalModifierIds?: string[];

  itemName: string;
  variationName?: string;
  quantity: number;

  grossSalesMoney: number; // cents
  discountsMoney: number;  // cents
  netSalesMoney: number;   // cents

  voidedQuantity?: number;
  refundedQuantity?: number;

  rawPayloadReference: string; // JSON-stringified raw order/line for audit
}

export interface PosSalesBatch {
  locationId: string;
  businessDate: string;
  lines: PosSalesLine[];
  cursor?: string; // pagination cursor for next page
}

export interface PosSyncCursor {
  [locationId: string]: {
    lastBusinessDate?: string;
    updatedAfter?: string;
  };
}

export interface PosConnector {
  readonly providerId: string;

  /** Exchange auth code for tokens and store in connection record */
  exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    merchantId: string;
  }>;

  /** List all locations available under this merchant */
  listLocations(accessToken: string): Promise<PosLocation[]>;

  /** Pull all sellable catalog item variations */
  retrieveCatalog(accessToken: string): Promise<PosCatalogVariation[]>;

  /**
   * Retrieve closed orders for a given location and business date range.
   * Returns a batch of normalized sales lines plus an optional cursor.
   */
  retrieveSales(
    accessToken: string,
    locationId: string,
    startDate: string,
    endDate: string,
  ): Promise<PosSalesBatch[]>;

  /** Refresh an expiring access token (optional — Square tokens are long-lived) */
  refreshCredentials?(
    accessToken: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; tokenExpiresAt?: Date }>;
}
