import type {
  VendorKey,
  ConnectorCapability,
  ConnectorTransport,
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
 * ProcurementConnector Interface
 *
 * Each food distributor (Sysco, GFS, US Foods, etc.) implements this interface.
 *
 * M2: capabilities is a map from each capability to the transport(s) the connector
 * supports for it. When an array is supplied (e.g. US Foods submitOrder: ['edi', 'punchout']),
 * the first element is the preferred/default transport.
 *
 * Example:
 *   capabilities = {
 *     retrieveCatalog:     'csv',
 *     submitOrder:         ['edi', 'punchout'],  // EDI preferred, PunchOut also supported
 *     exportOrderTemplate: 'csv',
 *     retrieveInvoices:    'api',
 *     populateCart:        'punchout',
 *     retrievePrices:      'api',
 *   }
 */
export interface ProcurementConnector {
  connectorId: VendorKey;
  displayName: string;

  /**
   * M2 capability-transport map.
   * Value is a single transport or an ordered array (first = preferred).
   * Only capabilities the connector actually supports need to be present.
   */
  capabilities: Partial<Record<ConnectorCapability, ConnectorTransport | ConnectorTransport[]>>;

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

/**
 * VendorAdapter is a type alias for ProcurementConnector.
 * Preserved for zero-friction migration — all existing import sites continue
 * to work without changes. New code should import ProcurementConnector directly.
 */
export type VendorAdapter = ProcurementConnector;
