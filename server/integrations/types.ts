/**
 * Shared domain types for vendor integrations
 */

export type VendorKey = 'sysco' | 'gfs' | 'usfoods';

export interface VendorProduct {
  vendorSku: string;
  vendorProductName: string;
  description?: string;
  caseSize?: number;
  innerPack?: number;
  unit?: string;
  price?: number;
  brandName?: string;
  categoryCode?: string;
  upc?: string;
  lastUpdated?: string;
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
