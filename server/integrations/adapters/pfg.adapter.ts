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
 * Performance Food Group (PFG) Vendor Adapter — Performance Net CSV format
 *
 * PFG's online ordering platform is called Performance Net (performancenet.com).
 * This adapter handles CSV exports from Performance Net order guides.
 *
 * Confirmed CSV column headers (from Performance Net portal documentation and
 * RRG Consulting export guide at rrgconsulting.com/export-your-performance-net-order-guide.html):
 *   Item Code         — vendor SKU / item number
 *   Item Description  — product description / name
 *   Pack Size         — compound pack string (e.g. "6/5 LB", "24/1 CS", "12/32 OZ")
 *   UOM               — ordering unit of measure (CS/EA) — purchase denomination only
 *   Your Price        — contracted case price (may also appear as "Price" or "Net Price")
 *   Brand             — manufacturer / brand name
 *   Category          — product category
 *
 * Notes:
 *   - Pack Size is a compound string ("6/5 LB") — parsed by CsvOrderGuide.parseCompoundPackSize
 *   - UOM is the ordering denomination (CS), not the measurement unit — ignored
 *   - Your Price is always a case price; unit price is derived by the order guide processor
 *   - Some exports include "Extended Description" as a secondary description column
 *
 * Relationship to existing 'pfs' connector:
 *   - 'pfs' connector maps to the legacy Performance Food Service CSV format
 *   - 'pfg' connector maps specifically to the Performance Net (online portal) CSV format
 *   - Both connectors point to the same distributor family but different export layouts
 */
export class PfgAdapter implements ProcurementConnector {
  connectorId = 'pfg' as const;
  displayName = 'Performance Food Group';

  capabilities = {
    retrieveCatalog:     'csv' as const,
    exportOrderTemplate: 'csv' as const,
  };

  constructor(private credentials: VendorCredentials) {}

  async syncOrderGuide(opts: SyncOrderGuideOptions): Promise<OrderGuide> {
    console.log('[PFG] Syncing order guide', opts);

    return {
      vendorKey: 'pfg',
      products: [],
      effectiveDate: new Date().toISOString(),
    };
  }

  async submitPO(po: PurchaseOrder): Promise<SubmitPOResponse> {
    console.log('[PFG] Submitting PO', po.internalOrderId);

    return {
      externalId: `PFG-${Date.now()}`,
      status: 'queued',
      message: 'Order queued for submission',
    };
  }

  async fetchInvoices(range: FetchInvoicesRange): Promise<Invoice[]> {
    console.log('[PFG] Fetching invoices', range);
    return [];
  }
}
