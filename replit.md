# Restaurant Inventory & Recipe Costing Application

## Overview
This project is a comprehensive inventory management and recipe costing system designed for pizza restaurants and similar food service businesses. It enables management of inventory items, vendors, recipes, and purchase orders. Key capabilities include complex unit conversions, nested recipes, real-time POS sales data integration for theoretical usage, and detailed variance reporting. The system aims to enhance operational efficiency, reduce waste, and improve profitability for food service establishments. The architecture supports a multi-company enterprise with robust tenant and store-level data isolation, and includes deep integration capabilities for food distributors.

## User Preferences
Preferred communication style: Simple, everyday language.

### Inventory Item Configuration
- **Default Unit of Measure**: Pound should be the default unit when creating new inventory items
- **Yield Field**: Yield is stored as a percentage value (0-100), not a separate yield amount + unit
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
- Inventory count sessions auto-populate active items and support inline editing.
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