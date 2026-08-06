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
 * Gordon Food Service (GFS) Vendor Adapter
 * 
 * GFS supports:
 * - EDI (X12 850 for POs, 810 for invoices)
 * - CSV order guide exports
 * - GFS WebXpress API
 */
export class GfsAdapter implements ProcurementConnector {
  connectorId = 'gfs' as const;
  displayName = 'Gordon Food Service';

  capabilities = {
    retrieveCatalog:     'csv' as const,
    submitOrder:         'edi' as const,
    exportOrderTemplate: 'csv' as const,
    retrieveInvoices:    'api' as const,
  };

  constructor(private credentials: VendorCredentials) {}

  async syncOrderGuide(opts: SyncOrderGuideOptions): Promise<OrderGuide> {
    // TODO: Implement GFS order guide sync
    // Options:
    // 1. CSV export from GFS WebXpress
    // 2. API call to GFS product catalog
    // 3. SFTP pickup of price files
    
    console.log('[GFS] Syncing order guide', opts);
    
    return {
      vendorKey: 'gfs',
      products: [],
      effectiveDate: new Date().toISOString(),
    };
  }

  async submitPO(po: PurchaseOrder): Promise<SubmitPOResponse> {
    // TODO: Implement GFS PO submission
    // Options:
    // 1. EDI 850 via AS2/SFTP
    // 2. API submission to GFS WebXpress
    // 3. Email integration (fallback)
    
    console.log('[GFS] Submitting PO', po.internalOrderId);
    
    return {
      externalId: `GFS-${Date.now()}`,
      status: 'queued',
      message: 'Order queued for EDI transmission',
    };
  }

  async fetchInvoices(range: FetchInvoicesRange): Promise<Invoice[]> {
    // TODO: Implement GFS invoice fetch
    // Options:
    // 1. EDI 810 via AS2/SFTP
    // 2. API call to GFS invoice API
    // 3. SFTP pickup of invoice files
    
    console.log('[GFS] Fetching invoices', range);
    
    return [];
  }
}
