# Restaurant Inventory & Recipe Costing Application

## Overview
This project is a comprehensive inventory management and recipe costing system designed for pizza restaurants and similar food service businesses. It enables management of inventory items, vendors, recipes, and purchase orders. Key capabilities include complex unit conversions, nested recipes, real-time POS sales data integration for theoretical usage, and detailed variance reporting. The system aims to enhance operational efficiency, reduce waste, and improve profitability for food service establishments. The architecture supports a multi-company enterprise with robust tenant and store-level data isolation, and includes deep integration capabilities for food distributors.

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
The system features a multi-tenant structure supporting multiple companies and their respective physical store locations. Data is isolated per company, with operations like inventory counts, purchase orders, and waste logs operating at the store level. This includes a `company_id` on all domain tables (except global units/conversions) and `storeId` for all store-level tracking. Inventory quantities are tracked per store in `store_inventory_items`.

**Company Context Resolution**: 
- Regular users have a fixed `company_id` in the `users` table, automatically providing company context for all operations
- Global admin users (`role = 'global_admin'`) have `company_id = null` and use session-based company selection via `auth_sessions.selected_company_id`
- The `requireAuth` middleware resolves `req.companyId` from either `user.companyId` (regular users) or `session.selectedCompanyId` (global admins)
- Global admins select their active company via POST `/api/auth/select-company`, which updates the session and persists company context across requests
- All domain data queries (vendors, inventory items, recipes, etc.) filter by the resolved `companyId` to ensure strict data isolation

**Vendor Company Isolation**: All vendor operations are isolated by company. The storage layer filters vendors by `companyId`, and API endpoints use the authenticated user's company context. Vendor creation automatically assigns the current company context. This ensures vendors cannot be accessed across company boundaries.

**Purchase Order Store Isolation**: Purchase orders are isolated by both company and store location. Each purchase order is associated with a specific company (from authenticated context) and store (selected by user in form). The storage layer filters purchase orders by `companyId` and optionally by `storeId`. All purchase order operations (create, read, update) respect company boundaries, and the frontend requires store selection when creating new orders. This ensures purchase orders are properly tracked at the store level for inventory management.

**Default "Misc Grocery" Vendor**: Every company automatically gets a "Misc Grocery" vendor upon creation. This special vendor allows unit-based ordering (instead of case-based) and is created both during database seeding for the default company and automatically when new companies are created via POST `/api/companies` endpoint. The vendor is set with `orderGuideType: "manual"` to support flexible ordering patterns.

**Data Compartmentalization Security (Completed Oct 2025)**: All operational data endpoints enforce strict company and store isolation:
- **Storage Locations (Oct 14, 2025)**: Schema updated with non-null `company_id` column for complete company isolation. Storage layer methods (`getStorageLocations`, `getStorageLocation`, `updateStorageLocation`, `deleteStorageLocation`) require and filter by `companyId`. All endpoints use `requireAuth` middleware and pass authenticated `req.companyId`. New companies automatically receive 6 default storage locations (Walk-In Cooler, Dry Storage, Drink Cooler, Walk-In Freezer, Prep Table, Front Counter) via POST `/api/companies`. All `getStorageLocations()` calls throughout codebase (inventory items, transfer orders, legacy endpoints) updated to pass `companyId`, preventing cross-company data leaks.
- **Receipts (Receiving)**: Storage layer `getReceipts()` requires `companyId` parameter. Draft receipt creation properly inherits `companyId` and `storeId` from associated purchase orders. All receipt endpoints use `requireAuth` middleware.
- **Transfer Orders**: Storage layer `getTransferOrders()` requires `companyId` with optional `storeId` filtering for both source and destination stores. Transfer order endpoints enforce company boundaries via `requireAuth`.
- **Transfer Logs**: Schema includes `companyId` field (line 457). Storage layer `getTransferLogs()` filters by `companyId` with optional store-level filtering using `or()` for `fromStoreId`/`toStoreId`.
- **Waste Logs**: Storage layer `getWasteLogs()` requires `companyId` parameter with optional `storeId` filtering. Waste reporting endpoints use `requireAuth` middleware and pass resolved `req.companyId`.
- **Vendor Items**: GET `/api/vendor-items` endpoint uses `requireAuth` middleware and filters inventory items by `companyId`. Response includes full inventory item data (id, name, categoryId, storageLocationId, caseSize, pricePerUnit) to properly display item names on vendor detail pages.
- **Inventory Items**: POST `/api/inventory-items` and PATCH `/api/inventory-items/:id` use `requireAuth` middleware. POST auto-injects `companyId` from authenticated context. PATCH validates both item and store ownership against authenticated user's company before allowing updates.
- All fixes documented in `SECURITY_FIXES_REQUIRED.md` with completion status and implementation details.

**Thrive Control Center (TCC) Integration**: Companies have a `tcc_account_id` (company-level UUID) for Thrive POS connectivity. Individual stores have an optional `tcc_location_id` (store-level UUID). These IDs are managed through Settings → Data Connections (company-level) and Store Locations page (store-level). Store management includes full CRUD operations with TCC Location ID support, accessible via Settings → Store Locations.

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI**: shadcn/ui with Radix UI, Tailwind CSS for styling, and custom theming with a warm orange primary color.
- **State Management**: TanStack Query for server state, local component state for UI.
- **Routing**: Wouter for client-side routing.
- **Features**: Dark/light theme, responsive navigation, search/filtering, real-time data updates via WebSockets, and a dashboard displaying company information. The receiving module allows quick price adjustments via clickable item names.

### Backend
- **Runtime**: Node.js with TypeScript.
- **Web Framework**: Express.js for REST APIs.
- **API Design**: RESTful endpoints, WebSocket server for real-time POS sales, Zod for validation.
- **Database Layer**: Drizzle ORM, PostgreSQL (Neon serverless), schema-first approach with migrations.
- **Core Domain Models**: Users, Storage Locations, Units, Inventory Items (location-specific), Vendors, Recipes (nested), Inventory Counts, Purchase Orders, POS Sales, Transfer/Waste Logs.
- **Business Logic**: Unit conversion, recursive recipe cost calculation with yield-based scaling, location-based inventory tracking, theoretical vs. actual usage variance, purchase order workflows, COGS analysis, and price change impact analysis.
- **Authentication & Sessions**: Session-based authentication with `auth_sessions` table. Global admin company selection uses `selected_company_id` column (added manually via ALTER TABLE; formal Drizzle migration pending for deployment).

### Architectural Decisions
- Single-page application with API and frontend served from the same Express server.
- WebSocket for real-time POS data streaming.
- Micro-unit system for precise inventory and recursive recipe cost calculation.
- Automated inventory adjustments for transfers and waste, with historical recipe versioning.
- Comprehensive inventory count interface supporting case counts and open units.
- Dedicated pages for managing storage locations, inventory items with status indicators, and detailed recipe views.
- Robust settings module for company info, user profiles, data connections, and system preferences.
- Purchase order management supports unit/case-based ordering, vendor-specific item filtering, and keyboard-optimized entry. The detail page features a full vendor product list view with search and filters.
- Inventory count sessions auto-populate active items associated with the selected store and support inline editing. Items are filtered by store association via `store_inventory_items` table to ensure only relevant items appear in each store's count.
- System-wide standardization from "product" to "inventory item" terminology.
- Enhanced vendor management with CRUD for vendor items and dedicated detail pages.
- Robust unit conversion module with cooking and metric conversions.
- **Receiving Module**: Supports partial receipts with resumable sessions, visual indicators for short quantities, unit-based receiving, and real-time price synchronization from inventory items.
- **Vendor Integration Architecture**:
    - **Classification**: Vendors classified as "electronic" (EDI/API/PunchOut) or "manual".
    - **Adapter Pattern**: Pluggable integration for distributors (Sysco, GFS, US Foods) supporting EDI (X12), CSV order guides, REST APIs, and PunchOut (cXML).
    - **EDI Support**: Bidirectional JSON ↔ X12 conversion for 850 (PO), 855 (PO Ack), 810 (Invoice) with robust parsing and generation.
    - **PunchOut cXML**: Real HTTP integration for interactive catalog sessions and cart return processing, including HMAC signature validation.
    - **CSV Order Guides**: Enhanced to handle innerPack, automatically update vendor_items, and support vendor-specific column mappings.
    - **Credentials Management**: `vendor_credentials` table stores API keys, EDI configs, SFTP details, and PunchOut settings, restricted to admin roles with redaction of sensitive data in API responses.
    - **Data Persistence**: `edi_messages` table logs transmissions, and `order_guides`/`order_guide_lines` store metadata and product line items from fetched order guides.
- **Object Storage Integration**: Integrated Google Cloud Storage via Replit's object storage for inventory item images. Features an `ObjectUploader` component, presigned URL generation, direct upload, ACL policy setting, and on-the-fly thumbnail generation using Sharp. Backend routes for upload, serving, and updating inventory items with image paths.

## External Dependencies
- **Third-Party UI Libraries**: Radix UI, Lucide React, Embla Carousel, cmdk, date-fns, Recharts.
- **Development Tools**: Vite, ESBuild, tsx.
- **Database Services**: Neon serverless PostgreSQL, `ws` (WebSockets), `@neondatabase/serverless` (connection pooling).
- **Authentication Dependencies**: Session management, password hashing, role-based access control.