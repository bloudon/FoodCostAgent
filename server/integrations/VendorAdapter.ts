import type {
  VendorKey,
  CapabilitySpec,
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
 * Each food distributor (Sysco, GFS, US Foods, etc.) implements this interface.
 *
 * M2: capabilities replaces the M1 boolean `supports` flags.
 * Instead of { edi: true, csv: true, punchout: false } use a CapabilitySpec array
 * that explicitly binds each capability to its transport:
 *   [
 *     { capability: 'order_guide_import',    transport: 'csv' },
 *     { capability: 'purchase_order_export', transport: 'edi' },
 *     { capability: 'invoice_fetch',         transport: 'api' },
 *   ]
 */
export interface VendorAdapter {
  key: VendorKey;
  name: string;

  /** M2 capability-transport bindings (replaces boolean `supports` flags). */
  capabilities: CapabilitySpec[];

  /**
   * Sync order guide from vendor.
   * Returns list of products with pricing and availability.
   */
  syncOrderGuide(opts: SyncOrderGuideOptions): Promise<OrderGuide>;

  /**
   * Submit purchase order to vendor.
   * Returns external order ID and submission status.
   */
  submitPO(po: PurchaseOrder): Promise<SubmitPOResponse>;

  /**
   * Fetch invoices from vendor for a date range.
   * Used for reconciliation and receiving.
   */
  fetchInvoices(range: FetchInvoicesRange): Promise<Invoice[]>;

  /**
   * Optional: Initialize PunchOut shopping session.
   * Returns redirect URL for vendor catalog.
   */
  punchoutInit?(req: PunchoutInitRequest): Promise<PunchoutInitResponse>;

  /**
   * Optional: Process PunchOut cart return.
   * Converts vendor cart to internal order draft.
   */
  punchoutReturn?(payload: PunchoutCartReturn): Promise<PunchoutOrderDraft>;
}
