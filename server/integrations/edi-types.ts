/**
 * EDI X12 Normalized JSON Types
 * Supports 850 (PO), 855 (PO Ack), 810 (Invoice)
 */

// Common address/party information (N1 loop)
export interface EdiParty {
  qualifier: string; // ST=Ship To, BT=Bill To, VN=Vendor, BY=Buyer
  name: string;
  identifierCode?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

// 850 Purchase Order (Outbound)
export interface Edi850PurchaseOrder {
  docType: '850';
  purpose: string; // 00=Original, 01=Cancellation, 04=Change, 05=Replace
  orderType: string; // NE=New Order, etc.
  poNumber: string;
  poDate: string; // YYYYMMDD
  deliveryDate?: string; // YYYYMMDD (DTM segment)
  
  // N1 loops
  shipTo?: EdiParty;
  billTo?: EdiParty;
  vendor?: EdiParty;
  
  // Line items (PO1 segments)
  lineItems: Array<{
    lineNumber: string;
    quantity: number;
    uom: string; // EA=Each, CS=Case, LB=Pound, etc.
    unitPrice: number;
    vendorSku?: string;
    buyerSku?: string;
    description?: string; // PID segment
  }>;
  
  totalLines?: number; // CTT segment
}

// 855 Purchase Order Acknowledgement (Inbound)
export interface Edi855PoAcknowledgement {
  docType: '855';
  ackType: string; // AC=Acknowledge, RJ=Reject, etc.
  poNumber: string;
  poDate: string; // YYYYMMDD
  ackDate?: string; // YYYYMMDD
  
  // Line items with confirmed details
  lineItems: Array<{
    lineNumber: string;
    quantity: number;
    uom: string;
    unitPrice?: number;
    vendorSku?: string;
    status?: string; // IA=Item Accepted, IB=Backordered, etc.
    confirmedDate?: string; // YYYYMMDD
  }>;
}

// 810 Invoice (Inbound)
export interface Edi810Invoice {
  docType: '810';
  invoiceNumber: string;
  invoiceDate: string; // YYYYMMDD
  poNumber?: string;
  
  // N1 loops
  billTo?: EdiParty;
  shipTo?: EdiParty;
  vendor?: EdiParty;
  
  // Line items (IT1 segments)
  lineItems: Array<{
    lineNumber: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    vendorSku?: string;
    buyerSku?: string;
    description?: string;
  }>;
  
  // TDS totals
  totalAmount?: number;
  totalLines?: number;
}

// Union type for all EDI documents
export type EdiDocument = Edi850PurchaseOrder | Edi855PoAcknowledgement | Edi810Invoice;

// X12 Parsing result
export interface X12ParseResult<T extends EdiDocument = EdiDocument> {
  normalized: T;
  raw: string;
  segments: string[];
}

// X12 Generation options
export interface X12GenerateOptions {
  segmentTerminator?: string; // Default: ~
  elementSeparator?: string; // Default: *
  compositeElementSeparator?: string; // Default: :
}
