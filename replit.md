# Restaurant Inventory & Recipe Costing Application

## Overview
This project is a comprehensive inventory management and recipe costing system for food service businesses, particularly pizza restaurants. It manages inventory, vendors, recipes, and purchase orders, offering features like complex unit conversions, nested recipes, real-time POS sales data integration, and detailed variance reporting. The system aims to boost operational efficiency, reduce waste, and improve profitability. It supports a multi-company enterprise with robust tenant and store-level data isolation, and integrates deeply with food distributors.

## User Preferences
Preferred communication style: Simple, everyday language.

### Inventory Item Configuration
- **Default Unit of Measure**: Pound should be the default unit when creating new inventory items
- **Unit Abbreviation**: "Pound" displays as "lb." throughout the UI for compact display. The `formatUnitName()` utility function (in `client/src/lib/utils.ts`) handles abbreviation consistently across all pages including inventory items, vendor cards, purchase orders, receiving, recipes, and unit conversions.
- **Yield Field**: Yield is stored as a percentage value (0-100), not a separate yield amount + unit
- **Par Level & Reorder Level**: These fields are stored on the `inventory_items` table as default values that can be overridden at the store level via `store_inventory_items` table
- **Active/Inactive Status**: Dual-level active status system
  - **Global Status**: `inventory_items.active` (integer) controls company-wide active/inactive status
  - **Store-Specific Status**: `store_inventory_items.active` (integer, default 1) allows independent active/inactive status per store
  - **UI Behavior**: When a specific store is selected, toggling active/inactive only affects that store and shows "(this store)" indicator in the dropdown menu. When "All Stores" is selected, toggles the global status.
  - **Security**: PATCH `/api/inventory-items/:id` requires authentication and validates both item and store ownership against the authenticated user's company before updating status
- **Store Locations**: Inventory items require store location assignment during creation. At least one store must be selected using checkboxes. Creating an inventory item automatically generates `store_inventory_items` records for each selected store via `createStoreInventoryItem()` storage method. The UI prevents unselecting the final store and blocks submission if no stores are selected.
  - **Backend Validation**: POST `/api/inventory-items` validates `storeIds` array is present and non-empty before processing
  - **Data Model**: `store_inventory_items` table links inventory items to specific stores with store-level quantities, par levels, and active status
- **Storage Locations**: Inventory items can be associated with multiple storage locations using checkboxes. At least one location is required. The primary location is indicated with a "(p)" badge.
  - **Display**: On the inventory items index page, all locations are displayed as a stacked vertical list within the table row. The primary location shows a "(p)" badge and appears first in the list.
  - **Performance**: Backend uses batched query pattern (`getInventoryItemLocationsBatch`) to fetch all item locations in a single database query, avoiding N+1 query problems.

## System Architecture

### Multi-Company Enterprise Architecture
The system employs a multi-tenant architecture, isolating data per company with store-level operations for inventory, purchase orders, and waste. All domain tables (except global units/conversions) include a `company_id`, and store-level tracking uses `storeId`. Inventory quantities are tracked per store in `store_inventory_items`.

Company context is resolved via `req.companyId` from user or session data, ensuring strict data isolation across all operations (vendors, inventory items, recipes, etc.). Global admins can select their active company.

A default "Misc Grocery" vendor is created for every new company, supporting unit-based ordering. All operational data endpoints enforce strict company and store isolation for storage locations, receipts, transfer orders, transfer logs, waste logs, vendor items, and inventory items.

Thrive Control Center (TCC) integration is supported via `tcc_account_id` (company-level) and `tcc_location_id` (store-level) for POS connectivity.

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI**: shadcn/ui with Radix UI, Tailwind CSS, custom theming (warm orange primary color).
- **State Management**: TanStack Query for server state, local component state.
- **Routing**: Wouter.
- **Features**: Dark/light theme, responsive navigation, search/filtering, real-time data updates via WebSockets, dashboard, quick price adjustments in receiving module.

### Backend
- **Runtime**: Node.js with TypeScript.
- **Web Framework**: Express.js for REST APIs.
- **API Design**: RESTful, WebSocket server, Zod validation.
- **Database Layer**: Drizzle ORM, PostgreSQL (Neon serverless), schema-first with migrations.
- **Core Domain Models**: Users, Storage Locations, Units, Inventory Items, Vendors, Recipes (nested), Inventory Counts, Purchase Orders, POS Sales, Transfer/Waste Logs.
- **Business Logic**: Unit conversion, recursive recipe cost calculation, location-based inventory, theoretical vs. actual usage variance, purchase order workflows, COGS analysis, price change impact analysis.
- **Authentication & Sessions**: Session-based authentication with `auth_sessions` table; global admin company selection via `selected_company_id`.
- **Role-Based Access Control (Oct 15, 2025)**: Hierarchical permission system with four user roles:
  - **`global_admin`**: Full system access across all companies; can use "become company" feature via `selectedCompanyId`
  - **`company_admin`**: Full access within assigned company; equivalent to global_admin permissions but scoped to their company; can manage all stores and users within their company
  - **`store_manager`**: Full access to assigned store(s); can perform operations but cannot modify company-wide settings
  - **`store_user`**: Read-only or limited access to assigned store(s); can perform daily operations (counts, receiving, etc.)
  
  **Data Structure**: `users.companyId` links user to company (null for global_admin); `users.role` defines permission level; `user_stores` junction table tracks store assignments for store_manager/store_user roles.
  
  **Permission Utilities** (`server/permissions.ts`): Helper functions for access control (isGlobalAdmin, hasCompanyAccess, canAccessStore, getAccessibleStores, canManageUsers).
  
  **Middleware** (`server/auth.ts`): Permission enforcement via `requireGlobalAdmin`, `requireCompanyAdmin`, `requireStoreAccess` middleware functions.
  
  **Security Hardening (Oct 15, 2025)**: Comprehensive security measures to prevent privilege escalation and scope bypass:
  - **Role Creation Constraints**: Company admins cannot create or elevate users to `global_admin` role; global admins must explicitly set `companyId=null` when creating other global admins
  - **Store Assignment Validation**: All store assignments validated against company boundaries; company admins restricted to assigning users to stores within their company only; store must belong to target user's company
  - **Update Restrictions**: Company admins cannot change user's `companyId`, set it to null, or elevate users to global admin via PATCH `/api/users/:id`
  - **Query Scoping**: Frontend user queries keyed by `companyId` (`["/api/users", companyId]`) to eliminate cross-company cache leakage
  - **User Management UI**: Settings > Users tab provides CRUD interface with role badges, active status toggles, and store assignment checkboxes; enforces security constraints at UI level
  
  **Store Isolation (Oct 16, 2025)**: Complete store-level access control ensuring users only see stores they're authorized to access:
  - **Backend API**: GET `/api/stores/accessible` endpoint returns filtered stores based on user role and assignments
    - Uses `getAccessibleStores(user, companyId)` from `server/permissions.ts`
    - Returns all stores for `global_admin` and `company_admin`
    - Returns only assigned stores (via `user_stores` table) for `store_manager` and `store_user`
    - Leverages `req.companyId` from auth middleware for proper company context resolution
  - **Frontend Hook**: `useAccessibleStores()` custom hook in `client/src/hooks/use-accessible-stores.ts`
    - Fetches from `/api/stores/accessible` with 5-minute cache
    - Returns typed `CompanyStore[]` array
    - Used across all store selector components for consistent isolation
  - **Updated Components**: All store selectors use `useAccessibleStores()` hook:
    - `client/src/pages/inventory-item-create.tsx`
    - `client/src/pages/inventory-items.tsx`
    - `client/src/pages/inventory-sessions.tsx`
    - `client/src/pages/purchase-order-detail.tsx`
    - `client/src/pages/settings.tsx`
    - `client/src/pages/stores.tsx`
    - `client/src/components/UsersManagement.tsx`
  - **Cache Invalidation**: All store CRUD mutations invalidate `["/api/stores/accessible"]` cache key:
    - Create/update/delete operations in `stores.tsx` and `company-detail.tsx`
    - Ensures real-time updates without waiting for cache expiration
    - Maintains data consistency across all store selectors

### Architectural Decisions
- Single-page application with API and frontend served from the same Express server.
- WebSocket for real-time POS data streaming.
- Micro-unit system for precise inventory and recursive recipe cost calculation.
- Automated inventory adjustments for transfers and waste, with historical recipe versioning.
- **Inventory Count Sessions**: Auto-populate items with dual-active status filtering (global `inventory_items.active=1` AND store `store_inventory_items.active=1`) plus strict company match for data integrity.
  - **Cross-Company Protection (Oct 14, 2025)**: Added `company_id` column to `store_inventory_items` with PostgreSQL trigger `enforce_store_inventory_item_company` that validates both store and inventory item belong to the same company before INSERT/UPDATE. Cleaned up 18 cross-company associations from data pollution. Count creation enforces company isolation via direct database query.
- Dedicated pages for managing storage locations, inventory items, and detailed recipe views.
- Robust settings module for company info, user profiles, data connections, and system preferences.
- Purchase order management supports unit/case-based ordering, vendor-specific item filtering, and keyboard-optimized entry.
  - **Item Usage Display (Oct 17, 2025)**: Purchase order creation page displays usage equation components for transparency:
    - **Previous Count**: Quantity from previous inventory count
    - **Received**: Total received from purchase orders between counts
    - **Current Count**: Most recent inventory count quantity
    - **Usage**: Calculated as (Previous Count + Received) - Current Count
    - Negative usage values highlighted in red (indicates potential receiving errors or count discrepancies)
    - Shows "N/A" for items without previous count data
    - API endpoint GET `/api/stores/:storeId/item-usage` provides usage data aggregated across storage locations
  - **Table Redesign (Oct 17, 2025)**: Streamlined purchase order table layout for clarity:
    - **Item/SKU Column**: Combined item name and vendor SKU into single column (SKU shown in muted text after item name)
    - **Category Grouping**: When "All Categories" filter selected, items grouped by category name (alphabetically sorted) with header rows
    - **Category Filtering**: When specific category selected, items shown without grouping in flat list
    - **Case-based Layout**: Item/SKU, Case Size, Unit Price, Case Price, Prev Count, Received, Current, Usage, Cases, Total (10 columns)
    - **Unit-based Layout**: Item/SKU, Unit, Price Each, Prev Count, Received, Current, Usage, Qty, Total (9 columns for Misc Grocery)
    - Category grouping headers use correct colSpan (10 for case-based, 9 for unit-based) to span all columns including Total
- System-wide standardization from "product" to "inventory item" terminology.
- Enhanced vendor management with CRUD for vendor items.
- Robust unit conversion module.
- **Receiving Module**: Supports partial receipts, resumable sessions, visual indicators for short quantities, unit-based receiving, and correct PO pricing. Storage location assignment was removed from the receiving process (Oct 14, 2025) - inventory on-hand quantities are updated for all items without location-based filtering.
  - **Purchase Order Pricing (Oct 15, 2025)**: Fixed GET `/api/purchase-orders/:id` endpoint to use original PO line prices (`line.priceEach`) instead of current inventory item prices (`item.pricePerUnit`). This ensures unit prices and order totals display correctly during receiving, using the prices that were agreed upon when the order was placed.
- **Vendor Integration Architecture**: Pluggable adapter pattern for distributors (Sysco, GFS, US Foods) supporting EDI (X12 bidirectional JSON conversion), PunchOut (cXML with HMAC validation), and CSV order guides (enhanced to handle `innerPack` and vendor-specific column mappings). `vendor_credentials` table stores integration settings.
- **Object Storage Integration**: Google Cloud Storage via Replit's object storage for inventory item images, featuring presigned URLs, direct upload, ACL, and on-the-fly thumbnail generation using Sharp.

## External Dependencies
- **Third-Party UI Libraries**: Radix UI, Lucide React, Embla Carousel, cmdk, date-fns, Recharts.
- **Database Services**: Neon serverless PostgreSQL, `ws` (WebSockets), `@neondatabase/serverless`.
- **Authentication Dependencies**: Session management, password hashing, role-based access control.