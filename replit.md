# Restaurant Inventory & Recipe Costing Application

## Overview
This project is a comprehensive inventory management and recipe costing system for food service businesses, particularly pizza restaurants. It aims to optimize operations, reduce waste, and enhance profitability in multi-company environments. Key features include advanced unit conversions, nested recipe support, real-time POS sales integration, and detailed variance reporting. The system supports a dual pricing model (Last Cost and Weighted Average Cost) for inventory items and offers vendor price comparison during purchase order creation to ensure cost efficiency.

## User Preferences
Preferred communication style: Simple, everyday language.
- **Default Unit of Measure for Inventory Items**: Pound should be the default unit when creating new inventory items.
- **Unit Abbreviation**: "Pound" displays as "lb." throughout the UI.
- **Yield Field**: Yield is stored as a percentage value (0-100).
- **Par Level & Reorder Level**: Stored on `inventory_items` table as default values, overrideable at the store level.
- **Active/Inactive Status**: Dual-level active status (global and store-specific).
- **Store Locations**: Inventory items require assignment to at least one store location during creation.
- **Storage Locations**: Inventory items can be associated with multiple storage locations; at least one is required.
- **Recipe `canBeIngredient`**: Recipes include a `canBeIngredient` checkbox field (0/1 in DB) to mark if they can be used as ingredients in other recipes.
- **Category Filtering in Recipe Builder**: Categories include a `showAsIngredient` field (0/1 in DB) controlling whether items in that category appear in the recipe builder's ingredient selection.
- **Waste Percentage Removal**: The waste percentage field has been removed from recipes.
- **Recipe Cost Calculation Fix**: Ingredient prices must be converted to base unit prices before multiplication.
- **Recipe Company Isolation**: Implement comprehensive company-level isolation for recipes and recipe components.
- **Recipe Builder UI Redesign**: Optimized layout for ingredients window space, with recipe name and total cost on the same row, yield fields and "Can be used as ingredient" checkbox within a collapsed accordion, and reduced heading font size for ingredients section.
- **Recipe Cost Recalculation on Inventory Price Changes**: Automatically recalculate all affected recipes when an inventory item's price changes, including nested recipes, ensuring recalculation in dependency order.
- **Number Input Fields**: All number input fields throughout the application have spinner controls (up/down arrows) removed for a cleaner interface.
- **Placeholder Recipe System**: During CSV menu import onboarding, placeholder recipes are automatically created for all recipe items (isRecipeItem=1), containing 1 oz of a "Placeholder Ingredient" and flagged with isPlaceholder=1. This enables immediate CSV import while allowing gradual recipe building. Menu Items page displays recipe status badges (Placeholder/Complete/Needs Recipe/N/A). Recipe saves set isPlaceholder to 0, converting placeholders to complete recipes. Recipe saves trigger Menu Items page refresh to ensure badge status and recipe costs update immediately.
- **Menu Item Management**: Menu items can be created manually via "Add Menu Item" dialog with form validation (required: name, PLU/SKU; optional: department, category, size, price, recipe, isRecipeItem flag). Recipe selection dropdown allows linking recipes during creation or editing, eliminating the need for manual linking. "Create new recipe with this name" link navigates to Recipe Builder with menu item name pre-populated for streamlined recipe creation workflow. Menu items can be edited by clicking the item name or via the actions dropdown menu. Edit dialog includes all fields plus price and recipe selection. Active/inactive status toggle via dropdown actions menu. Department, category, and type filters (Recipe Item/Non-Recipe Item/All) enable easy sorting and filtering. Table displays Recipe Cost (computed from recipe) and Price columns, with Status and Type columns removed for cleaner UI. SKU cleanup script automatically removes pipe symbols from imported POS data and generates abbreviated SKUs (max 10 characters) from item names, with sequential numbering for duplicates.
- **Menu Item Store Assignment**: Menu items require assignment to at least one store during creation and editing, matching inventory items pattern. Store checkboxes appear in both Add and Edit dialogs with validation. Store assignments properly persist and sync via bulk create/delete operations with company-level data isolation. Fixed backend route imports to use `companyStores` table.
- **Recipe Cost Display**: Menu Items page displays computed recipe costs for all menu items that have recipes assigned, including both placeholder and complete recipes. Items without recipes show "-" in the Recipe Cost column.
- **Menu Items Table Enhancements**: Removed the Recipe status badge column. Added Food Cost % column (calculated as recipe cost / price * 100) as the rightmost data column. All columns are sortable with visual sort indicators (ArrowUpDown, ArrowUp, ArrowDown icons). Clicking a column header sorts ascending, clicking again reverses to descending. Food Cost % displays as a percentage with one decimal place (e.g., "25.4%") when both recipe cost and price exist, otherwise shows "-". Recipe Cost values are clickable links that navigate to the recipe edit page.
- **Recipe Builder Smart Back Button**: Back button in Recipe Builder uses intelligent navigation - if browser history exists (history.length > 1), returns to previous page preserving navigation context; otherwise falls back to /recipes. This ensures users navigating from Menu Items return to Menu Items, while users from Recipes index return to Recipes, and direct URL access falls back gracefully.
- **Dual Pricing Model**: Inventory items track both Last Cost (pricePerUnit - most recent purchase price) and Weighted Average Cost (avgCostPerUnit - WAC calculated across all receipts). Inventory Items page displays both price columns for better pricing visibility and decision-making. WAC is calculated during receiving using company-wide quantities: `((totalCompanyQty * currentAvgCost) + (receivedQty * receivedPrice)) / (totalCompanyQty + receivedQty)`.
- **Vendor Price Comparison**: Purchase order creation includes a "Compare Prices" button (TrendingDown icon) on each item row that opens a dialog showing all vendor prices for that item. The dialog displays vendor name, SKU, case size, unit price, and case price, sorted by case price (lowest first). The lowest-priced vendor is highlighted with a "Best Price" badge. Uses vendor-specific case sizes and includes zero-priced items (promotional offers). Only excludes vendors with null/undefined prices.
- **Vendor-Specific Purchase Order Pricing**: Purchase orders use vendor-specific pricing (vendor_items.lastPrice) instead of general inventory pricing (inventory_items.pricePerUnit). All pricing logic uses nullish coalescing (`??`) to preserve legitimate zero-priced vendor items (promotional offers, free samples) while falling back to inventory pricing only when vendor prices are null/undefined. This ensures accurate vendor-specific costing for purchase orders, receipts, and price comparisons.

## System Architecture

### Multi-Company Enterprise Architecture
The system utilizes a multi-tenant architecture with data isolation enforced at company and store levels using `company_id` and `storeId`. It integrates with Thrive Control Center (TCC) via `tcc_account_id` and `tcc_location_id`.

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI**: `shadcn/ui` components (Radix UI, Tailwind CSS) with custom theming, featuring dark/light modes and responsive navigation.
- **State Management**: TanStack Query for server-side state.
- **Routing**: Wouter.

### Backend
- **Runtime**: Node.js with TypeScript.
- **Web Framework**: Express.js for RESTful APIs.
- **API Design**: RESTful, WebSocket server for real-time data, Zod validation.
- **Database Layer**: Drizzle ORM, PostgreSQL (Neon serverless), with a schema-first approach and migrations.
- **Core Domain Models**: Users, Storage Locations, Units, Inventory Items, Vendors, Recipes (nested), Inventory Counts, Purchase Orders, POS Sales, Transfer/Waste Logs.
- **Business Logic**: Includes unit conversion, recursive recipe costing, location-based inventory, theoretical vs. actual usage variance, purchase order workflows, and COGS analysis.
- **Authentication & Sessions**: Session-based authentication, with `selected_company_id` for global admin context.
- **Role-Based Access Control**: Hierarchical permissions (`global_admin`, `company_admin`, `store_manager`, `store_user`).

### Architectural Decisions
- **Application Structure**: Single-page application with co-served API and frontend.
- **Real-time Data**: WebSocket for streaming POS data.
- **Precision**: Micro-unit system for accurate tracking and costing.
- **Inventory Adjustments**: Automated adjustments for transfers/waste, historical recipe versioning.
- **Inventory Count Sessions**: Auto-populates items based on active status and company. Inventory counts update `store_inventory_items.onHandQty` and lock the session. Administrators can unlock closed/applied sessions for corrections.
- **Purchase Order Management**: Supports unit/case ordering, vendor-specific filtering, and keyboard-optimized entry. Expected date is a required field.
- **Terminology Standardization**: Consistent use of "inventory item."
- **Receiving Module**: Supports partial receipts, resumable sessions, and visual indicators. Allows editing unit prices on unsaved rows, with real-time updates to totals. Backend correctly treats `receipt_lines.price_each` as unit price and updates `inventory_items.pricePerUnit` directly.
- **Vendor Integration**: Pluggable adapter pattern for distributors (Sysco, GFS, US Foods) via EDI, PunchOut, CSV.
- **Object Storage**: Google Cloud Storage via Replit's object storage for inventory item images (presigned URLs, on-the-fly thumbnails).
- **Unified Orders Page**: Consolidates Purchase Orders, Receiving, and Transfer Orders.
- **Store-to-Store Transfer Orders**: Tracks inventory movement with a defined workflow (pending → Execute Transfer → in_transit → Receive Transfer → completed).
- **Waste Tracking Module**: Comprehensive waste logging with store-level isolation for both inventory and menu items. Features a touch-friendly UI, automatic value calculation, and tracks various waste reasons. Enforces store-level access control. Menu items are grouped by department (not category) with "(No Department)" bucket for items without departments. Waste log displays in table format with separate Inventory Items and Menu Items sections, right-aligned values, subtotals for each section, and grand total. Store selector positioned in top right header area for consistency with other pages.
- **HMAC Authentication for Inbound Data Feeds**: Implemented hierarchical HMAC-SHA256 bearer token authentication for securing inbound API integrations (POS, vendor EDI), including company-level credentials, cryptographically secure keys, timestamp/nonce validation, content MD5 integrity checking, and optional IP whitelisting.
- **Company Data Purge System (Development Only)**: Cascading delete functionality for purging all company-associated data, restricted to development environment and global_admin. Purges across 40+ tables in dependency order, excluding user records.

## External Dependencies
- **Third-Party UI Libraries**: Radix UI, Lucide React, Embla Carousel, cmdk, date-fns, Recharts.
- **Database Services**: Neon serverless PostgreSQL, `@neondatabase/serverless`.
- **Real-time Communication**: `ws` (WebSockets).
- **Image Processing**: Sharp.
- **Vendor Integrations**: Sysco, GFS, US Foods (via custom adapters).