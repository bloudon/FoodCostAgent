# Restaurant Inventory & Recipe Costing Application

## Overview
This project is a comprehensive inventory management and recipe costing system tailored for pizza restaurants and similar food service businesses. It enables management of inventory items, vendors, recipes, inventory, and purchase orders. Key capabilities include complex unit conversions, nested recipes, real-time POS sales data integration for theoretical usage calculations, and detailed variance reporting between theoretical and actual usage. The business vision is to provide a robust tool that enhances operational efficiency, reduces waste, and improves profitability for food service establishments.

## User Preferences
Preferred communication style: Simple, everyday language.

### Inventory Item Configuration
- **Default Unit of Measure**: Pound should be the default unit when creating new inventory items
- **Yield Field**: Yield is stored as a percentage value (0-100), not a separate yield amount + unit
- **Storage Locations**: Inventory items can be associated with multiple storage locations using checkboxes. At least one location is required. The primary location is indicated with a "Primary" badge.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI**: shadcn/ui with Radix UI, inspired by Linear and Stripe Dashboard for functional efficiency and professional appearance.
- **Styling**: Tailwind CSS, custom CSS variables for theming (light/dark mode), design tokens, and a pizza-inspired warm orange primary color.
- **State Management**: TanStack Query for server state; local component state for UI.
- **Routing**: Wouter for client-side routing.
- **Key Features**: Dark/light theme, responsive navigation, search/filtering, real-time data updates via WebSockets.

### Backend
- **Runtime**: Node.js with TypeScript.
- **Web Framework**: Express.js for REST APIs.
- **API Design**: RESTful endpoints, WebSocket server for real-time POS sales, structured error handling, Zod for request/response validation.
- **Database Layer**: Drizzle ORM, PostgreSQL (Neon serverless), schema-first approach with migrations, Zod integration.
- **Core Domain Models**: Users, Storage Locations, Units, **Inventory Items** (location-specific items with quantities), Vendors, Vendor Items, Recipes (with nested components using inventory items), Inventory Counts, Purchase Orders, POS Sales, Menu Items, Transfer Logs, Waste Logs.
- **Inventory Architecture (Option A)**: Each inventory item represents a physical item at a specific location with its quantity. Same item at different locations = multiple inventory item records. Aggregated totals computed by summing across locations.
- **Business Logic**: Unit conversion, recursive recipe cost calculation with yield-based scaling, location-based inventory tracking, theoretical vs. actual usage variance, purchase order workflow, COGS analysis, price change impact analysis.

### Data Storage
- **Primary Database**: PostgreSQL (Neon Serverless) with relational schema, UUIDs, and timestamp tracking.
- **ORM**: Drizzle ORM for type-safe queries, schema definitions, and migration system.
- **Data Seeding**: Automated seed data for pizza restaurant operations, including inventory items (per location), recipes, units, and storage locations.
- **Recent Major Refactoring**: 
  - Replaced `products` table with `inventoryItems` table (location-specific)
  - Removed redundant `inventoryLevels` table
  - Updated all foreign key references from `productId` to `inventoryItemId`
  - Renamed `productPriceHistory` to `inventoryItemPriceHistory`, `vendorProducts` to `vendorItems`
  - Recipe components now use `inventory_item` type instead of `product`
  - Removed Products pages and navigation - fully replaced with Inventory Items
  - Added `yieldPercent` field to inventory items (percentage 0-100)
  - Implemented many-to-many storage locations using `inventory_item_locations` join table
    - Multiple locations per inventory item supported
    - Primary location tracked in both `inventoryItems.storageLocationId` and `inventory_item_locations.isPrimary`
    - Frontend uses checkboxes for location selection
    - Client and server-side validation ensures at least one location is always selected
  - **Vendor Items Management** (October 2025):
    - Full CRUD operations for vendor items (create, update, delete)
    - Dialog-based UI on inventory item detail page for managing vendor relationships
    - Each inventory item can have multiple vendors with vendor-specific details (SKU, pricing, lead times)
    - API routes: POST/PATCH/DELETE /api/vendor-items with Zod validation
    - Proper cache invalidation using TanStack Query
    - Toast notifications for success/error feedback
  - **Inventory Count Sessions** (October 2025):
    - **Auto-Population**: All active inventory items are automatically added as count lines when a session is created (qty=0)
    - **Inline Editing**: Click any quantity to edit inline with Save/Cancel buttons (no add/edit/delete dialogs)
    - **Schema**: Count lines include userId and countedAt timestamp for audit trail
    - **Price Snapshot**: Each count line captures unitCost at time of counting to preserve historical accuracy
    - **Multi-Location Support**: Inventory sessions no longer tied to specific location; use location filter to count by area
    - **Recording Only**: Count sessions do NOT automatically update inventory levels
    - **Dashboard Filtering**: Filter cards show aggregated values by category and location
    - **Toggle Behavior**: Click to filter, click again to clear; both filters can be active simultaneously
    - **Empty Counts**: "Show empty counts" toggle defaults to false (hides items with qty=0)
    - Handles "Uncategorized" items and items without locations using sentinel values
    - **Session Deletion**: Delete button (trash icon) on inventory-sessions page with confirmation dialog
      - Cascade deletes all count lines before deleting session
      - API endpoint: DELETE /api/inventory-counts/:id (returns 204 on success)
      - Shows success toast and invalidates cache to refresh list
  - **Terminology Standardization** (October 2025):
    - Completed comprehensive refactoring from "product" to "inventory item" terminology throughout entire codebase
    - Updated all server routes to use inventory item storage methods
    - Updated all frontend pages, UI text, placeholders, and labels
    - Recipe components now consistently use `inventory_item` componentType
    - All user-facing text standardized: "Search items...", "Variance by Item", "Compare by item"
    - Verified with end-to-end testing and architect review
  - **Vendor Detail Navigation** (October 2025):
    - Added clickable product count on vendor cards to access vendor detail page
    - Created dedicated vendor detail page showing vendor info and all associated inventory items
    - Each inventory item card on vendor detail is clickable, navigating to item detail page
    - Implemented GET /api/vendors/:id endpoint for fetching single vendor
    - Enhanced /api/vendor-items endpoint to return enriched data (inventory item + unit info)
    - Full navigation flow: vendors list → vendor detail → inventory item detail
    - Proper test IDs and e2e test coverage for all interactive elements
  - **Unit Conversions Module** (October 2025):
    - Fixed authentication caching issue: disabled ETag globally to prevent 304 responses
    - Fixed apiRequest parameter order bug in unit-conversions.tsx (method, url, data)
    - Created pound to 16 oz conversion as seed data (1 pound = 16 ounces)
    - Full CRUD functionality tested and working: create, update, delete conversions
    - All API endpoints verified (POST returns 201, PATCH returns 200, DELETE returns 204)
    - **Comprehensive Cooking Conversions Added**:
      - Added 15 total conversions from professional cooking chart
      - Volume conversions: tsp→tbsp (3), fl oz→tbsp (2), cup→fl oz (8), pint→cup (2), quart→pint (2), gallon→quart (4)
      - Metric conversions: tsp→mL (5), tbsp→mL (15), fl oz→mL (30), cup→mL (240), L→mL (1000)
      - Weight conversions: oz→g (28.35), lb→g (454), kg→g (1000), lb→oz (16)
      - Created missing imperial units: pint, quart, gallon
    - **Microunit System Data Integrity Fixes** (October 2025):
      - Removed 14 duplicate units from database (every unit existed twice)
      - Consolidated duplicate ounce (weight) units and updated conversion references
      - Fixed incorrect microunit ratios: pint (473.18mL), quart (946.35mL), gallon (3785.41mL)
      - Verified all 10 inventory items have valid unit references
      - Verified all 15 unit conversions have valid from/to unit references
      - Final system: 13 unique units, 0 duplicates, 100% data integrity
  - **Vendor-Item Display Fix** (October 2025):
    - Fixed vendors page calling wrong endpoint: `/api/vendor-products` → `/api/vendor-items`
    - Added proper TypeScript typing (VendorItem[] instead of any[])
    - Added loading state indicator for vendor item counts
    - Removed duplicate Sysco vendor from database
    - Verified vendor detail navigation shows all associated inventory items
    - Future optimization opportunities: server-side count aggregation, error handling, cache invalidation
  - **System Preferences API Fix** (October 2025):
    - Fixed apiRequest signature bug in settings.tsx mutations
    - Both updateCompanyMutation and updatePrefsMutation were using incorrect fetch-style API
    - Changed from: `apiRequest(url, { method, body, headers })` to `apiRequest(method, url, data)`
    - Settings now properly persist (unit system, currency, timezone changes work correctly)
    - Same bug pattern previously fixed in unit-conversions.tsx
  - **Vendor Detail Price Display Fix** (October 2025):
    - Fixed vendor detail page showing $0.00 for items when inventory item had actual prices
    - Root cause: Page displayed vendor_items.lastPrice (often 0/null) instead of inventory_items.pricePerUnit
    - Solution: Reversed priority to show inventory item values primarily using nullish coalescing
    - Price: `item.inventoryItem?.pricePerUnit ?? item.lastPrice ?? 0`
    - Case Size: `item.inventoryItem?.caseSize ?? item.caseSize`
    - Used `??` instead of `||` to preserve legitimate 0 values and prevent incorrect fallbacks
    - Inventory items are canonical source of truth; vendor-specific values only used when inventory data is null/undefined
  - **Additional Unit Types** (October 2025):
    - Added "each" and "roll" as count-based units (kind='count', toBaseRatio=1)
    - These units do not have conversions defined (standalone units)
    - Available in all inventory item forms and dropdowns
  - **Purchase Orders Management** (October 2025):
    - **List Page**: Full-featured purchase orders index with search, vendor filter, and status filter
    - **Detail Page**: Keyboard-optimized order entry with tabbed navigation between quantity/price fields
    - **Vendor Filtering**: Items dropdown filtered by selected vendor (GET /api/vendor-items?vendor_id={id})
    - **API Enrichment**: GET /api/purchase-orders returns lineCount and totalAmount computed from PO lines
    - **Data Integrity**: Vendor-specific item filtering prevents adding items from wrong vendors
    - **Keyboard Navigation**: Tab key moves between qty→price→next qty without focus trap
    - **Status Badges**: Color-coded status indicators (pending/ordered/received)
    - **Order Entry Flow**: Select vendor → add items → enter qty/price → save
    - **Notes Field**: Optional notes field on purchase orders for additional context
    - **Misc Grocery Workflow**: Special "Misc Grocery" vendor for spot purchases; auto-creates/reuses vendor items to prevent duplicates
    - **Unit Propagation Fix**: Order lines now store unitId/unitName; backend enriches detail response with unitName for proper display
    - **Delete Functionality**: 
      - DELETE /api/purchase-orders/:id endpoint with cascade deletion of PO lines
      - Only non-received orders can be deleted (status validation)
      - Confirmation dialog with AlertDialog component
      - Cache invalidation and success/error toast notifications
    - Routes: /purchase-orders (list), /purchase-orders/new (create), /purchase-orders/:id (detail/edit)

### Architectural Decisions
- Single-page application with client-side routing.
- API and frontend served from the same Express server.
- WebSocket for real-time POS data streaming at `/ws/pos`.
- Micro-unit system for precise inventory.
- Recursive recipe cost calculation with yield-based scaling.
- Automatic inventory adjustments for transfers and waste.
- Historical recipe versioning for cost tracking.
- Comprehensive inventory count interface including case counts and open units.
- Dedicated pages for managing storage locations, inventory items with status indicators, and detailed recipe views.
- Robust settings and configuration module for company info, user profiles, data connections, and system preferences.

## External Dependencies
- **Third-Party UI Libraries**: Radix UI, Lucide React, Embla Carousel, cmdk, date-fns, Recharts.
- **Development Tools**: Vite, ESBuild, tsx.
- **Database Services**: Neon serverless PostgreSQL, `ws` package for WebSockets, `@neondatabase/serverless` for connection pooling.
- **Authentication Dependencies**: Session management infrastructure, password hashing, role-based access control.