# Restaurant Inventory & Recipe Costing Application

## Overview
This project is a comprehensive inventory management and recipe costing system for food service businesses, particularly pizza restaurants. It offers tools for managing inventory, vendors, recipes, and purchase orders, including complex unit conversions, nested recipes, real-time POS sales data integration, and detailed variance reporting. The system aims to enhance operational efficiency, reduce waste, and improve profitability. It supports multi-company operations with data isolation and integrates with various food distributors.

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
- **Category Filtering in Recipe Builder**: Categories include a `showAsIngredient` field (stored as integer 0/1 in the database, default 1) that controls whether inventory items in that category appear in the recipe builder's ingredient selection.
  - **UI**: Recipe builder displays a category filter dropdown in the left panel. Users can select "All Categories" or a specific category to filter available ingredients. The ingredient list is organized into two sections: "Base Recipes" (recipes with canBeIngredient=1) and "Inventory Items" (regular inventory items).
  - **Database**: `categories.show_as_ingredient` (integer, default 1)
  - **Filtering Logic**: Inventory items are filtered by: (1) search term match, (2) selected category (if not "All Categories"), and (3) `showAsIngredient=1` status on the item's category. This allows exclusion of non-recipe categories like "Beverages" from the recipe builder.
- **Waste Percentage Removal**: The waste percentage field has been removed from recipes. Waste tracking will be implemented later as a separate waste chart feature.
  - **Database**: Removed `waste_percent` column from `recipes` table
  - **Cost Calculation**: Recipe costs now represent raw ingredient costs without any waste multiplier
  - **UI Changes**: Removed waste percentage input from recipe builder, removed waste column from recipes list, removed waste card from recipe detail page
- **Cost Calculation Fix**: Fixed critical bug in recipe cost calculations where ingredient prices were not being converted to base unit prices before multiplication.
  - **Issue**: Multiplying quantity in base units (grams) by price per item unit (pounds) without conversion resulted in incorrect costs (e.g., 4 oz of $2/lb yeast showing as $226.80 instead of $0.50)
  - **Fix**: Convert item's pricePerUnit to price per base unit by dividing by the item's unit toBaseRatio before multiplying by quantity in base units
  - **Applied To**: Frontend recipe builder, backend calculateRecipeCost function, and calculateInventoryItemImpactInRecipe function
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
- **Recipe Cost Recalculation on Inventory Price Changes**: Implemented comprehensive automatic recipe cost updates when inventory item prices changes, including nested recipe support.
  - **Problem**: Previously, when an inventory item's price changed, recipe costs (stored in `recipes.computedCost`) remained stale until manually recalculated
  - **Solution**: PATCH `/api/inventory-items/:id` now automatically recalculates all affected recipes when `pricePerUnit` changes
  - **Dependency Graph**: Helper function `findAffectedRecipesByInventoryItem` builds a complete dependency graph to find:
    - All recipes that directly use the changed inventory item
    - All parent recipes that use those recipes as components (transitive closure)
    - Returns affected recipes in topological order (children before parents)
  - **Recalculation Order**: Recipes are recalculated in dependency order (children first, then parents) to ensure accurate nested cost propagation
  - **Client-Side**: Predicate-based cache invalidation ensures all recipe queries (list, detail, components) refresh after inventory updates
  - **Server-Side**: Cache-Control: no-store headers on recipe endpoints prevent browser-level caching

## System Architecture

### Multi-Company Enterprise Architecture
The system utilizes a multi-tenant architecture with data isolation at company and store levels, enforcing `company_id` and `storeId` context via `req.companyId`. Integration with Thrive Control Center (TCC) for POS connectivity uses `tcc_account_id` and `tcc_location_id`.

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI**: `shadcn/ui` components (Radix UI, Tailwind CSS), custom theming (warm orange primary).
- **State Management**: TanStack Query for server-side state.
- **Routing**: Wouter.
- **Features**: Dark/light theme, responsive navigation, search, filtering, real-time data via WebSockets, dashboard, quick price adjustments.

### Backend
- **Runtime**: Node.js with TypeScript.
- **Web Framework**: Express.js (RESTful APIs).
- **API Design**: RESTful, WebSocket server, Zod validation.
- **Database Layer**: Drizzle ORM, PostgreSQL (Neon serverless), schema-first with migrations.
- **Core Domain Models**: Users, Storage Locations, Units, Inventory Items, Vendors, Recipes (nested), Inventory Counts, Purchase Orders, POS Sales, Transfer/Waste Logs.
- **Business Logic**: Unit conversion, recursive recipe costing, location-based inventory, theoretical vs. actual usage variance, purchase order workflows, COGS analysis.
- **Authentication & Sessions**: Session-based authentication (`auth_sessions` table), `selected_company_id` for global admin.
- **Role-Based Access Control**: Hierarchical permissions (`global_admin`, `company_admin`, `store_manager`, `store_user`) for data isolation and security.

### Architectural Decisions
- **Application Structure**: Single-page application with co-served API and frontend.
- **Real-time Data**: WebSocket for streaming POS data.
- **Precision**: Micro-unit system for accurate tracking and costing.
- **Inventory Adjustments**: Automated adjustments for transfers/waste, historical recipe versioning.
- **Inventory Count Sessions**: Auto-populates items based on dual-active status and company, with cross-company protection.
- **Purchase Order Management**: Unit/case ordering, vendor-specific filtering, keyboard-optimized entry.
- **Terminology Standardization**: Consistent use of "inventory item."
- **Receiving Module**: Partial receipts, resumable sessions, visual indicators, correct PO pricing.
- **Vendor Integration**: Pluggable adapter pattern for distributors (Sysco, GFS, US Foods) via EDI, PunchOut, CSV.
- **Object Storage**: Google Cloud Storage via Replit's object storage for inventory item images (presigned URLs, on-the-fly thumbnails).
- **Unified Orders Page**: Consolidated Purchase Orders and Receiving into a single `/orders` page. This page includes store, vendor, and status filters, and provides status-based navigation to editable, receiving, or read-only detail pages. A single "Orders" menu item replaces separate links.

## External Dependencies
- **Third-Party UI Libraries**: Radix UI, Lucide React, Embla Carousel, cmdk, date-fns, Recharts.
- **Database Services**: Neon serverless PostgreSQL, `@neondatabase/serverless`.
- **Real-time Communication**: `ws` (WebSockets).
- **Image Processing**: Sharp.
- **Vendor Integrations**: Sysco, GFS, US Foods (via custom adapters).