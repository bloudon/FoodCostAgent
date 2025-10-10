import type {
  VendorKey,
  OrderGuide,
  PurchaseOrder,
  Invoice,
  PunchoutInitRequest,
  PunchoutInitResponse,
  PunchoutCartReturn,
  PunchoutOrderDraft,
  SyncOrderGuideOptions,
  SubmitPOResponse,
  FetchInvoicesRange,
} from './types';

/**
 * VendorAdapter Interface
 * 
 * Each food distributor (Sysco, GFS, US Foods) implements this interface.
 * Supports multiple integration methods: EDI, CSV, API, PunchOut.
 */
export interface VendorAdapter {
  key: VendorKey;
  name: string;
  
  supports: {
    edi: boolean;
    punchout: boolean;
    csv: boolean;
    api: boolean;
  };

  /**
   * Sync order guide from vendor
   * Returns list of products with pricing and availability
   */
  syncOrderGuide(opts: SyncOrderGuideOptions): Promise<OrderGuide>;

  /**
   * Submit purchase order to vendor
   * Returns external order ID and submission status
   */
  submitPO(po: PurchaseOrder): Promise<SubmitPOResponse>;

  /**
   * Fetch invoices from vendor for a date range
   * Used for reconciliation and receiving
   */
  fetchInvoices(range: FetchInvoicesRange): Promise<Invoice[]>;

  /**
   * Optional: Initialize PunchOut shopping session
   * Returns redirect URL for vendor catalog
   */
  punchoutInit?(req: PunchoutInitRequest): Promise<PunchoutInitResponse>;

  /**
   * Optional: Process PunchOut cart return
   * Converts vendor cart to internal order draft
   */
  punchoutReturn?(payload: PunchoutCartReturn): Promise<PunchoutOrderDraft>;
}
