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
 * Sysco Vendor Adapter
 * 
 * Sysco supports:
 * - EDI (X12 850 for POs, 810 for invoices)
 * - CSV order guide downloads
 * - API (if credentials available)
 */
export class SyscoAdapter implements ProcurementConnector {
  connectorId = 'sysco' as const;
  displayName = 'Sysco';

  capabilities = {
    retrieveCatalog:     'csv'  as const,
    submitOrder:         'edi'  as const,
    exportOrderTemplate: 'csv'  as const,
    retrieveInvoices:    'api'  as const,
    retrievePrices:      'api'  as const,
  };

  constructor(private credentials: VendorCredentials) {}

  async syncOrderGuide(opts: SyncOrderGuideOptions): Promise<OrderGuide> {
    // TODO: Implement Sysco order guide sync
    // Options:
    // 1. CSV download from Sysco Market Connect
    // 2. API call to Sysco's product catalog API
    // 3. SFTP pickup of daily price file
    
    console.log('[Sysco] Syncing order guide', opts);
    
    return {
      vendorKey: 'sysco',
      products: [],
      effectiveDate: new Date().toISOString(),
    };
  }

  async submitPO(po: PurchaseOrder): Promise<SubmitPOResponse> {
    // TODO: Implement Sysco PO submission
    // Options:
    // 1. EDI 850 via AS2/SFTP
    // 2. API submission to Sysco Order Gateway
    // 3. Email integration (fallback)
    
    console.log('[Sysco] Submitting PO', po.internalOrderId);
    
    return {
      externalId: `SYSCO-${Date.now()}`,
      status: 'queued',
      message: 'Order queued for EDI transmission',
    };
  }

  async fetchInvoices(range: FetchInvoicesRange): Promise<Invoice[]> {
    // TODO: Implement Sysco invoice fetch
    // Options:
    // 1. EDI 810 via AS2/SFTP
    // 2. API call to Sysco invoice API
    // 3. SFTP pickup of daily invoice files
    
    console.log('[Sysco] Fetching invoices', range);
    
    return [];
  }
}
