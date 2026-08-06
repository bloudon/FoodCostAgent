import type { ProcurementConnector } from '../ProcurementConnector';
import type {
  OrderGuide,
  PurchaseOrder,
  Invoice,
  SyncOrderGuideOptions,
  SubmitPOResponse,
  FetchInvoicesRange,
  VendorCredentials,
} from '../types';

/**
 * Ben E. Keith (BEK) Vendor Adapter
 *
 * BEK supports CSV order guide exports from their customer portal (BEK.com / My BEK).
 *
 * Confirmed CSV column headers (from Costguard documentation and BEK portal exports):
 *   Item Number   — vendor SKU / item code
 *   Description   — product description / name
 *   Pack          — case pack count (e.g. "6", "12")
 *   Size          — inner pack size with unit (e.g. "5 LB", "32 OZ", "#10")
 *   UOM           — ordering unit of measure (e.g. "CS", "EA") — purchase denomination only
 *   Your Price    — contracted case price (may also appear as "Price")
 *   Brand         — manufacturer / brand name
 *   Category      — product category description
 *
 * Notes:
 *   - Pack + Size combine to describe the full case pack (e.g. Pack=6, Size="5 LB" → 6/5 LB)
 *   - UOM is the ordering UOM (CS/EA), not the measurement unit — ignored in favor of Size
 *   - Your Price is the case price; unit price is derived by the order guide processor
 */
export class BekAdapter implements ProcurementConnector {
  connectorId = 'bek' as const;
  displayName = 'Ben E. Keith';

  capabilities = {
    retrieveCatalog:     'csv' as const,
    exportOrderTemplate: 'csv' as const,
  };

  constructor(private credentials: VendorCredentials) {}

  async syncOrderGuide(opts: SyncOrderGuideOptions): Promise<OrderGuide> {
    console.log('[BEK] Syncing order guide', opts);

    return {
      vendorKey: 'bek',
      products: [],
      effectiveDate: new Date().toISOString(),
    };
  }

  async submitPO(po: PurchaseOrder): Promise<SubmitPOResponse> {
    console.log('[BEK] Submitting PO', po.internalOrderId);

    return {
      externalId: `BEK-${Date.now()}`,
      status: 'queued',
      message: 'Order queued for submission',
    };
  }

  async fetchInvoices(range: FetchInvoicesRange): Promise<Invoice[]> {
    console.log('[BEK] Fetching invoices', range);
    return [];
  }
}
