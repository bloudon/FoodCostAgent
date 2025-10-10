# Vendor Integrations

This module provides integrations with food distributors (Sysco, GFS, US Foods) for automated ordering and inventory management.

## Architecture

The system uses a **VendorAdapter** pattern where each distributor implements a common interface:

```typescript
interface VendorAdapter {
  key: VendorKey;
  name: string;
  supports: { edi: boolean; punchout: boolean; csv: boolean; api: boolean };
  
  syncOrderGuide(opts: SyncOrderGuideOptions): Promise<OrderGuide>;
  submitPO(po: PurchaseOrder): Promise<SubmitPOResponse>;
  fetchInvoices(range: FetchInvoicesRange): Promise<Invoice[]>;
  punchoutInit?(req: PunchoutInitRequest): Promise<PunchoutInitResponse>;
  punchoutReturn?(payload: PunchoutCartReturn): Promise<PunchoutOrderDraft>;
}
```

## Supported Vendors

### Sysco
- **EDI**: X12 850 (PO), 810 (Invoice)
- **CSV**: Order guide downloads
- **API**: Sysco Market Connect API

### Gordon Food Service (GFS)
- **EDI**: X12 850 (PO), 810 (Invoice)
- **CSV**: WebXpress order guide exports
- **API**: GFS WebXpress API

### US Foods
- **EDI**: X12 850 (PO), 810 (Invoice), 832 (Price Catalog)
- **PunchOut**: cXML catalog integration
- **CSV**: US Foods Online exports
- **API**: US Foods Online API

## Integration Methods

### 1. EDI (Electronic Data Interchange)

Purchase orders and invoices are transmitted via X12 EDI format through AS2 or SFTP.

**Files:**
- `edi/GenericEdiGateway.ts` - EDI transmission abstraction
- Supports: 850 (PO), 810 (Invoice), 832 (Price Catalog), 997 (Acknowledgment)

**Configuration:**
```typescript
{
  provider: 'sps' | 'truecommerce' | 'b2bgateway',
  endpoint: string,
  apiKey: string,
  isaId: string,
  gsId: string,
}
```

### 2. CSV Order Guides

Import product catalogs and pricing from CSV files.

**Files:**
- `csv/CsvOrderGuide.ts` - CSV parser with vendor-specific mappings

**Usage:**
```typescript
const orderGuide = await CsvOrderGuide.parse(csvContent, {
  vendorKey: 'sysco',
  skipRows: 1,
  delimiter: ',',
});
```

### 3. PunchOut/cXML

Interactive catalog shopping for US Foods (and potentially others).

**Files:**
- `punchout/CxmlClient.ts` - cXML protocol implementation

**Flow:**
1. Initialize session → Get redirect URL
2. User shops on vendor site
3. Vendor posts cart back → Parse cXML OrderRequest
4. Create order draft in our system

## API Endpoints

### Get Available Integrations
```
GET /api/vendor-integrations
```

Returns list of vendors and their capabilities.

### Sync Order Guide
```
POST /api/vendor-integrations/:vendorKey/sync-order-guide
{
  "since": "2024-01-01",
  "fullSync": false
}
```

### Submit Purchase Order
```
POST /api/vendor-integrations/:vendorKey/submit-po
{
  "internalOrderId": "PO-123",
  "vendorKey": "sysco",
  "orderDate": "2024-10-10",
  "lines": [...]
}
```

### Fetch Invoices
```
POST /api/vendor-integrations/:vendorKey/fetch-invoices
{
  "start": "2024-10-01",
  "end": "2024-10-10"
}
```

### PunchOut (US Foods only)
```
POST /api/vendor-integrations/usfoods/punchout-init
{
  "buyerCookie": "SESSION-123",
  "buyerUserId": "user@restaurant.com",
  "returnUrl": "https://yourapp.com/punchout/return"
}
```

## Credentials Management

Vendor credentials are loaded from environment variables:

```bash
# Sysco
SYSCO_API_KEY=xxx
SYSCO_API_SECRET=xxx
SYSCO_ACCOUNT=xxx

# GFS
GFS_API_KEY=xxx
GFS_USERNAME=xxx
GFS_PASSWORD=xxx

# US Foods
USFOODS_API_KEY=xxx
USFOODS_ACCOUNT=xxx
USFOODS_PUNCHOUT_URL=xxx
USFOODS_SHARED_SECRET=xxx
```

**Note:** In production, these should be stored in Replit Secrets or a secure credentials database.

## Implementation Status

### ✅ Completed
- Core adapter interface and types
- Vendor adapter implementations (stub)
- EDI gateway abstraction (stub)
- CSV order guide parser
- cXML PunchOut client (stub)
- API routes for all integration methods

### 🚧 To Do
- Implement actual EDI transmission (connect to iPaaS)
- Add vendor-specific API clients
- Implement order guide sync logic
- Add invoice reconciliation
- Create UI for managing vendor credentials
- Add integration status monitoring
- Implement retry logic and error handling

## Usage Example

```typescript
import { getVendor } from './integrations';

// Get vendor adapter
const sysco = getVendor('sysco');

// Sync order guide
const orderGuide = await sysco.syncOrderGuide({ fullSync: true });

// Submit purchase order
const result = await sysco.submitPO({
  internalOrderId: 'PO-123',
  vendorKey: 'sysco',
  orderDate: new Date().toISOString(),
  lines: [
    {
      vendorSku: '12345',
      productName: 'Pizza Flour',
      quantity: 5,
      unitPrice: 25.99,
      lineTotal: 129.95,
    }
  ],
  totalAmount: 129.95,
});

console.log('Order submitted:', result.externalId);
```

## Testing

All adapters currently return mock/stub responses. To implement actual integrations:

1. Update adapter methods to call real vendor APIs
2. Configure EDI gateway with iPaaS credentials
3. Implement CSV parsing for vendor-specific formats
4. Set up PunchOut endpoints and cXML processing

## Security Considerations

- Store credentials securely (use Replit Secrets)
- Validate all incoming data (especially cXML cart returns)
- Use HTTPS for all API calls
- Implement rate limiting for vendor API calls
- Log all transactions for audit trail
- Verify EDI acknowledgments (997/999)
