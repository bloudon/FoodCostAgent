# Restaurant Inventory & Recipe Costing Application

## Overview
This project is a comprehensive inventory management and recipe costing system for food service businesses, particularly pizza restaurants. It manages inventory, vendors, recipes, and purchase orders, offering features like complex unit conversions, nested recipes, real-time POS sales data integration, and detailed variance reporting. The system aims to boost operational efficiency, reduce waste, and improve profitability. It supports a multi-company enterprise with robust tenant and store-level data isolation, and integrates deeply with food distributors. The business vision is to provide a critical tool for food service operators to gain granular control over their costs and inventory, leading to significant improvements in profitability and operational efficiency. The market potential is vast, targeting a wide range of food service establishments.

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

### Recipe Configuration
- **Can Be Used as Ingredient**: Recipes include a `canBeIngredient` checkbox field (stored as integer 0/1 in the database) that marks whether a recipe can be used as an ingredient in other recipes (nested recipes).
  - **UI**: Checkbox labeled "Can be used as ingredient in other recipes" in the Recipe Builder form
  - **Database**: `recipes.can_be_ingredient` (integer, default 0)
  - **API**: 
    - POST `/api/recipes` - Creates recipe with canBeIngredient field
    - PATCH `/api/recipes/:id` - Updates recipe including canBeIngredient (validates with Zod schema)
  - **Seed Data**: Only "Pizza Dough (100 lb Batch)" is marked as can_be_ingredient=1 in Brian's Pizza test data
  - **Date Added**: October 19, 2025

- **Category Filtering in Recipe Builder**: Categories include a `showAsIngredient` field (stored as integer 0/1 in the database, default 1) that controls whether inventory items in that category appear in the recipe builder's ingredient selection.
  - **UI**: Recipe builder displays a category filter dropdown in the left panel. Users can select "All Categories" or a specific category to filter available ingredients. The ingredient list is organized into two sections: "Base Recipes" (recipes with canBeIngredient=1) and "Inventory Items" (regular inventory items).
  - **Database**: `categories.show_as_ingredient` (integer, default 1)
  - **Filtering Logic**: Inventory items are filtered by: (1) search term match, (2) selected category (if not "All Categories"), and (3) `showAsIngredient=1` status on the item's category. This allows exclusion of non-recipe categories like "Beverages" from the recipe builder.
  - **Seed Data**: "Beverages" category is marked as showAsIngredient=0 to exclude beverages from recipe ingredient selection
  - **Date Added**: October 19, 2025

- **Waste Percentage Removal**: The waste percentage field has been removed from recipes. Waste tracking will be implemented later as a separate waste chart feature.
  - **Database**: Removed `waste_percent` column from `recipes` table
  - **Cost Calculation**: Recipe costs now represent raw ingredient costs without any waste multiplier
  - **UI Changes**: Removed waste percentage input from recipe builder, removed waste column from recipes list, removed waste card from recipe detail page
  - **Date Removed**: October 20, 2025

- **Cost Calculation Fix**: Fixed critical bug in recipe cost calculations where ingredient prices were not being converted to base unit prices before multiplication.
  - **Issue**: Multiplying quantity in base units (grams) by price per item unit (pounds) without conversion resulted in incorrect costs (e.g., 4 oz of $2/lb yeast showing as $226.80 instead of $0.50)
  - **Fix**: Convert item's pricePerUnit to price per base unit by dividing by the item's unit toBaseRatio before multiplying by quantity in base units
  - **Applied To**: Frontend recipe builder, backend calculateRecipeCost function, and calculateInventoryItemImpactInRecipe function
  - **Date Fixed**: October 20, 2025

- **Recipe Company Isolation**: Implemented comprehensive company-level isolation for recipes and recipe components to prevent cross-company data access.
  - **Storage Layer**: Updated `getRecipes(companyId?)` and `getRecipe(id, companyId?)` to filter by company
  - **Authentication**: Added `requireAuth` middleware to all recipe and recipe component routes
  - **Security Validation**: All endpoints verify recipe ownership before operations:
    - GET /api/recipes - filters by user's company
    - GET /api/recipes/:id - returns 404 if recipe doesn't belong to company
    - POST /api/recipes - auto-injects companyId on create
    - PATCH /api/recipes/:id - verifies ownership before update
    - GET /api/recipe-components/:recipeId - verifies recipe ownership
    - POST /api/recipes/:id/components - verifies recipe ownership and validates referenced inventory items/sub-recipes belong to same company
    - POST /api/recipe-components - verifies recipe ownership and validates component references
    - PATCH /api/recipe-components/:id - verifies recipe ownership and validates updated component references
    - DELETE /api/recipe-components/:id - verifies recipe ownership before deletion
  - **Defense-in-Depth**: Component creation/updates validate that referenced inventory items and sub-recipes belong to the same company, preventing cross-company data linkage
  - **Date Implemented**: October 20, 2025

- **Recipe Builder UI Redesign**: Optimized layout to maximize ingredients window space and improve usability.
  - **Top Section Layout**: Recipe name input and total cost now share the same row:
    - Recipe name field takes up flex-1 (majority of horizontal space)
    - Cost display is right-aligned with fixed width (w-48)
    - Cost label simplified to "Cost:" (from "Total Recipe Cost:")
    - Removed "Recipe Details" header to reduce vertical space
  - **Default Values**: New recipes default to yield of 1 "each" unit
    - Yield quantity: "1" (set via useState)
    - Yield unit: "each" (set via useEffect finding unit by name)
  - **Collapsed Accordion**: Yield fields and "Can be used as ingredient" checkbox are now inside a "Recipe Yield & Options" accordion
    - Default state: collapsed
    - Contains: Yield Quantity, Yield Unit, and canBeIngredient checkbox
    - Reduces visual clutter and maximizes vertical space for ingredients
  - **Ingredients Section**: Reduced heading font size from CardTitle to text-sm font-medium (matches other labels)
    - Provides more vertical space for the ingredients table
    - Maintains visual hierarchy while being less prominent
  - **Date Redesigned**: October 20, 2025

## System Architecture

### Multi-Company Enterprise Architecture
The system employs a multi-tenant architecture, isolating data per company with store-level operations. All domain tables include a `company_id`, and store-level tracking uses `storeId`. Company context is resolved via `req.companyId`, ensuring strict data isolation. A default "Misc Grocery" vendor is created for every new company. Thrive Control Center (TCC) integration is supported via `tcc_account_id` (company-level) and `tcc_location_id` (store-level) for POS connectivity.

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI**: shadcn/ui with Radix UI, Tailwind CSS, custom theming (warm orange primary color).
- **State Management**: TanStack Query for server state, local component state.
- **Routing**: Wouter.
- **Features**: Dark/light theme, responsive navigation, search/filtering, real-time data updates via WebSockets, dashboard, quick price adjustments.

### Backend
- **Runtime**: Node.js with TypeScript.
- **Web Framework**: Express.js for REST APIs.
- **API Design**: RESTful, WebSocket server, Zod validation.
- **Database Layer**: Drizzle ORM, PostgreSQL (Neon serverless), schema-first with migrations.
- **Core Domain Models**: Users, Storage Locations, Units, Inventory Items, Vendors, Recipes (nested), Inventory Counts, Purchase Orders, POS Sales, Transfer/Waste Logs.
- **Business Logic**: Unit conversion, recursive recipe cost calculation, location-based inventory, theoretical vs. actual usage variance, purchase order workflows, COGS analysis.
- **Authentication & Sessions**: Session-based authentication with `auth_sessions` table; global admin company selection via `selected_company_id`.
- **Role-Based Access Control**: Hierarchical permission system with `global_admin`, `company_admin`, `store_manager`, `store_user` roles. Enforces data isolation and prevents privilege escalation. Store isolation ensures users only see authorized stores via a dedicated API endpoint and frontend hook.

### Architectural Decisions
- Single-page application with API and frontend served from the same Express server.
- WebSocket for real-time POS data streaming.
- Micro-unit system for precise inventory and recursive recipe cost calculation.
- Automated inventory adjustments for transfers and waste, with historical recipe versioning.
- **Inventory Count Sessions**: Auto-populate items based on dual-active status filtering and company match. Implements cross-company protection via PostgreSQL triggers. Count page maintains stable item order (ORDER BY id) during entry to prevent page jumping when quantities are updated (Oct 19, 2025).
- Purchase order management supports unit/case-based ordering, vendor-specific item filtering, and keyboard-optimized entry. The purchase order creation page displays usage equation components (Previous Count, Received, Current Count, Usage) with navigable links to associated records.
- System-wide standardization from "product" to "inventory item" terminology.
- **Receiving Module**: Supports partial receipts, resumable sessions, visual indicators for short quantities, and correct PO pricing based on original order prices.
- **Vendor Integration Architecture**: Pluggable adapter pattern for distributors (Sysco, GFS, US Foods) supporting EDI, PunchOut, and CSV order guides.
- **Object Storage Integration**: Google Cloud Storage via Replit's object storage for inventory item images, featuring presigned URLs and on-the-fly thumbnail generation.

## External Dependencies
- **Third-Party UI Libraries**: Radix UI, Lucide React, Embla Carousel, cmdk, date-fns, Recharts.
- **Database Services**: Neon serverless PostgreSQL, `@neondatabase/serverless`.
- **Real-time Communication**: `ws` (WebSockets).
- **Authentication Dependencies**: Session management, password hashing, role-based access control.
- **Image Processing**: Sharp (for thumbnail generation).
- **Vendor Integrations**: Sysco, GFS, US Foods (via custom adapters for EDI, PunchOut, CSV).