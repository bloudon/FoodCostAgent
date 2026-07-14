/**
 * Shared domain types for vendor integrations
 */

export type VendorKey = 'sysco' | 'gfs' | 'usfoods' | 'pfs' | 'pfg' | 'bek' | 'sofo' | 'generic';

/**
 * M2 — Connector Registry and Capability Transport Model
 *
 * Transport: the wire protocol used to exchange data with a supplier.
 * Capability: a named operation the connector can perform.
 * CapabilitySpec: binds a capability to its default transport for a given connector.
 *
 * One connector may advertise the same capability over multiple transports
 * (e.g. US Foods supports submitOrder via both 'edi' and 'punchout').
 * The first entry in the capabilities array is the preferred/default transport.
 */
export type ConnectorTransport =
  | 'api'
  | 'csv'
  | 'edi'
  | 'email'
  | 'excel'
  | 'manual'
  | 'manual_or_email'
  | 'ocr'
  | 'punchout'
  | 'sftp'
  | 'browser_extension'
  | 'unsupported';

export type ConnectorCapability =
  | 'retrieveCatalog'
  | 'retrievePrices'
  | 'retrieveInvoices'
  | 'exportOrderTemplate'
  | 'populateCart'
  | 'submitOrder';

export interface CapabilitySpec {
  capability: ConnectorCapability;
  transport: ConnectorTransport;
}

/**
 * Per-company connection instance for a supplier connector.
 *
 * A single connection may use different transports for different capabilities
 * (e.g. retrieve the catalog over CSV while submitting orders over EDI).
 * `transportOverrides` is therefore a per-capability map, not a single field.
 * When a capability is absent from the map the connector's registry default
 * transport is used.
 *
 * Type-only in M2 — persisted via the `customer_supplier_connections` DB table
 * (see shared/schema.ts `customerSupplierConnections`).
 */
export interface CustomerSupplierConnection {
  /** Identifies which connector definition to use (matches connectorRegistry key). */
  connectorId: string;
  companyId: string;
  /** Optional: when connection is scoped to a specific store location. */
  locationId?: string;
  /**
   * Per-capability transport overrides.
   * Key:   ConnectorCapability ('retrieveCatalog', 'submitOrder', …)
   * Value: ConnectorTransport  ('csv', 'edi', 'punchout', …)
   * Absent key → fall through to connector registry default.
   */
  transportOverrides?: Partial<Record<ConnectorCapability, ConnectorTransport>>;
  /** Optional reference to a vendorCredentials row for this connection. */
  credentialRef?: string;
  isActive: boolean;
}

export interface VendorProduct {
  vendorSku: string;
  vendorProductName: string;
  description?: string;
  caseSize?: number;           // Parsed numeric value for calculations
  caseSizeRaw?: string;        // Original pack string from vendor (e.g., "6/5 LB")
  innerPack?: number;          // Parsed numeric value for calculations
  innerPackRaw?: string;       // Original inner pack string from vendor
  unit?: string;
  price?: number;
  brandName?: string;
  categoryCode?: string;
  upc?: string;
  lastUpdated?: string;
  isVariableWeight?: boolean;  // True if vendor marks item as variable/catch weight
  /**
   * Per-each weight in LB, derived when the vendor CSV provides both an EA count
   * column and a separate case-weight column (e.g. 24 EA + 18 LB → 0.75 LB/each).
   * When set, the parser has already adjusted `unit` to "LB", `innerPack` to this
   * value, and `innerPackRaw` to "each" so the order-guide processor can seed an
   * "each" Recipe Unit automatically via autoSeedRecipeUnitsForItem.
   */
  eaPerCase?: number;
}

export interface OrderGuide {
  vendorKey: VendorKey;
  products: VendorProduct[];
  effectiveDate: string;
  expirationDate?: string;
}

export interface PurchaseOrderLine {
  vendorSku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  unitOfMeasure?: string;
  lineTotal: number;
}

export interface PurchaseOrder {
  internalOrderId: string;
  vendorKey: VendorKey;
  orderDate: string;
  expectedDeliveryDate?: string;
  deliveryAddress?: {
    name: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zip: string;
  };
  lines: PurchaseOrderLine[];
  totalAmount: number;
  notes?: string;
}

export interface Invoice {
  externalInvoiceId: string;
  vendorKey: VendorKey;
  invoiceDate: string;
  orderReference?: string;
  lines: Array<{
    vendorSku: string;
    productName: string;
    quantityShipped: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  tax?: number;
  shipping?: number;
  totalAmount: number;
  dueDate?: string;
}

export interface PunchoutInitRequest {
  buyerCookie: string;
  buyerUserId: string;
  buyerEmail?: string;
  returnUrl: string;
}

export interface PunchoutInitResponse {
  redirectUrl: string;
  sessionId: string;
}

export interface PunchoutCartReturn {
  sessionId: string;
  items: Array<{
    vendorSku: string;
    quantity: number;
    unitPrice: number;
    description: string;
  }>;
  totalAmount: number;
}

export interface PunchoutOrderDraft {
  lines: PurchaseOrderLine[];
  totalAmount: number;
}

export interface VendorCredentials {
  vendorKey: VendorKey;
  // API Credentials
  apiKey?: string;
  apiSecret?: string;
  apiUrl?: string;
  username?: string;
  password?: string;
  accountNumber?: string;
  // EDI Configuration
  ediIsaId?: string;
  ediGsId?: string;
  ediQualifier?: string;
  as2Url?: string;
  as2Identifier?: string;
  // SFTP Configuration
  sftpHost?: string;
  sftpPort?: number;
  sftpUsername?: string;
  sftpPassword?: string;
  sftpPath?: string;
  // PunchOut Configuration
  punchoutUrl?: string;
  punchoutDomain?: string;
  punchoutIdentity?: string;
  sharedSecret?: string;
}

export interface SyncOrderGuideOptions {
  since?: string;
  fullSync?: boolean;
}

export interface SubmitPOResponse {
  externalId: string;
  status: 'queued' | 'sent' | 'acknowledged' | 'failed';
  message?: string;
}

export interface FetchInvoicesRange {
  start: string;
  end: string;
}
