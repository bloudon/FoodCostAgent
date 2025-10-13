# Critical Security Fixes - Data Compartmentalization

## Status: ✅ COMPLETED

All critical data compartmentalization issues have been resolved. Data is now properly isolated by company and store boundaries.

## Fixes Applied

### ✅ Receipts API
- **Storage Layer:** Updated `getReceipts()` to require and filter by `companyId`
- **API Routes:** Added `requireAuth` middleware to `/api/receipts` endpoints
- **Receipt Creation:** Fixed draft receipt creation to include `companyId` and `storeId` from associated purchase order

### ✅ Transfer Orders API  
- **Storage Layer:** Updated `getTransferOrders()` to require `companyId` parameter with optional `storeId` filtering
- **API Routes:** Added `requireAuth` middleware to `/api/transfer-orders` endpoints
- **Store Isolation:** Transfer orders now properly filter by stores using `fromStoreId` and `toStoreId`

### ✅ Transfer Logs API
- **Schema:** Confirmed `companyId` field already exists in `transferLogs` table (line 457 in schema.ts)
- **Storage Layer:** Updated `getTransferLogs()` to require `companyId` with proper filtering by company and store
- **Import Fix:** Added `or` import from `drizzle-orm` for proper store filtering logic

### ✅ Waste Logs API
- **Storage Layer:** Updated `getWasteLogs()` to require `companyId` parameter with optional `storeId` filtering  
- **API Routes:** Added `requireAuth` middleware to `/api/reports/waste-trends` endpoint
- **Data Isolation:** Waste logs now properly filter by company and optionally by store

## Issues Found (Historical Record)

### 1. Receipts (Receiving Module)
**Severity:** CRITICAL
**Current Behavior:** Returns all receipts from all companies and stores
**Files Affected:**
- `server/storage.ts` - `getReceipts()` method (line 840-842)
- `server/routes.ts` - `GET /api/receipts` (line 1995-1998)
- `server/routes.ts` - `GET /api/receipts/draft/:poId` (line 2001-2009)

**Required Fix:**
```typescript
// Storage layer
async getReceipts(companyId: string, storeId?: string): Promise<Receipt[]> {
  const conditions = [eq(receipts.companyId, companyId)];
  if (storeId) {
    conditions.push(eq(receipts.storeId, storeId));
  }
  return db.select().from(receipts).where(and(...conditions));
}

// API layer
app.get("/api/receipts", requireAuth, async (req, res) => {
  const receipts = await storage.getReceipts(req.companyId!);
  res.json(receipts);
});
```

### 2. Transfer Orders
**Severity:** CRITICAL
**Current Behavior:** Returns all transfer orders from all companies
**Files Affected:**
- `server/storage.ts` - `getTransferOrders()` method (line 973-975)
- `server/routes.ts` - `GET /api/transfer-orders` (line 2437-2451)

**Required Fix:**
```typescript
// Storage layer - update interface
getTransferOrders(companyId: string, storeId?: string): Promise<TransferOrder[]>;

// Storage layer - update implementation
async getTransferOrders(companyId: string, storeId?: string): Promise<TransferOrder[]> {
  const conditions = [eq(transferOrders.companyId, companyId)];
  if (storeId) {
    // Filter for orders where store is either source or destination
    conditions.push(
      or(
        eq(transferOrders.fromStoreId, storeId),
        eq(transferOrders.toStoreId, storeId)
      )
    );
  }
  return db.select().from(transferOrders).where(and(...conditions)).orderBy(transferOrders.createdAt);
}

// API layer
app.get("/api/transfer-orders", requireAuth, async (req, res) => {
  const orders = await storage.getTransferOrders(req.companyId!);
  // ... rest of implementation
});
```

### 3. Transfer Logs
**Severity:** HIGH
**Current Behavior:** 
- Schema missing `companyId` field
- No company or store filtering in queries

**Files Affected:**
- `shared/schema.ts` - `transferLogs` table (line 458-466)
- `server/storage.ts` - `getTransferLogs()` method (line 947-965)

**Required Fix:**
1. Add `companyId` to schema:
```typescript
export const transferLogs = pgTable("transfer_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(), // ADD THIS
  inventoryItemId: varchar("inventory_item_id").notNull(),
  fromStoreId: varchar("from_store_id").notNull(),
  toStoreId: varchar("to_store_id").notNull(),
  // ... rest of fields
});
```

2. Update storage method:
```typescript
// Update interface
getTransferLogs(companyId: string, inventoryItemId?: string, storeId?: string, startDate?: Date, endDate?: Date): Promise<TransferLog[]>;

// Update implementation
async getTransferLogs(companyId: string, inventoryItemId?: string, storeId?: string, startDate?: Date, endDate?: Date): Promise<TransferLog[]> {
  let query = db.select().from(transferLogs);
  const conditions = [eq(transferLogs.companyId, companyId)];
  
  if (inventoryItemId) {
    conditions.push(eq(transferLogs.inventoryItemId, inventoryItemId));
  }
  if (storeId) {
    conditions.push(
      or(
        eq(transferLogs.fromStoreId, storeId),
        eq(transferLogs.toStoreId, storeId)
      )
    );
  }
  if (startDate) {
    conditions.push(gte(transferLogs.transferredAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(transferLogs.transferredAt, endDate));
  }
  
  return query.where(and(...conditions));
}
```

3. Update insert schema to include companyId

### 4. Waste Logs
**Severity:** CRITICAL
**Current Behavior:** Returns all waste logs regardless of company/store
**Files Affected:**
- `server/storage.ts` - `getWasteLogs()` method (line 1024-1042)

**Required Fix:**
```typescript
// Update interface
getWasteLogs(companyId: string, inventoryItemId?: string, storeId?: string, startDate?: Date, endDate?: Date): Promise<WasteLog[]>;

// Update implementation
async getWasteLogs(companyId: string, inventoryItemId?: string, storeId?: string, startDate?: Date, endDate?: Date): Promise<WasteLog[]> {
  let query = db.select().from(wasteLogs);
  const conditions = [eq(wasteLogs.companyId, companyId)];
  
  if (inventoryItemId) {
    conditions.push(eq(wasteLogs.inventoryItemId, inventoryItemId));
  }
  if (storeId) {
    conditions.push(eq(wasteLogs.storeId, storeId));
  }
  if (startDate) {
    conditions.push(gte(wasteLogs.wastedAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(wasteLogs.wastedAt, endDate));
  }
  
  return query.where(and(...conditions));
}
```

## Implementation Priority

1. **IMMEDIATE:** Fix receipts, transfer orders, waste logs (add companyId filtering)
2. **HIGH:** Fix transfer logs (add companyId column + filtering)
3. **VERIFY:** Audit all other endpoints to ensure proper filtering

## Testing Checklist

After implementing fixes:
- [ ] Verify receipts API returns only company-scoped data
- [ ] Verify transfer orders API returns only company-scoped data
- [ ] Verify waste logs properly filter by company and store
- [ ] Test global admin company switching doesn't expose other company data
- [ ] Test regular users cannot access other company data
- [ ] Verify all aggregation endpoints properly join through company hierarchy

## Database Migration for Transfer Logs

```sql
-- Add companyId to transfer_logs table
ALTER TABLE transfer_logs ADD COLUMN company_id VARCHAR;

-- Populate companyId from store → company relationship
UPDATE transfer_logs tl
SET company_id = cs.company_id
FROM company_stores cs
WHERE tl.from_store_id = cs.id;

-- Make companyId NOT NULL after population
ALTER TABLE transfer_logs ALTER COLUMN company_id SET NOT NULL;
```
