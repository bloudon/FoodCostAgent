# Restaurant Inventory & Recipe Costing Application

## Overview
This project is a comprehensive inventory management and recipe costing system designed for multi-company food service businesses, particularly pizza restaurants. Its primary purpose is to enhance operational efficiency, minimize waste, and boost profitability across multiple locations. Key capabilities include advanced unit conversions, nested recipe management, real-time POS sales integration, detailed variance reporting, dual inventory pricing (Last Cost and Weighted Average Cost), and optimized purchasing through vendor price comparison. The system provides robust cost control and extensive operational oversight for multi-unit restaurant environments.

## User Preferences
- Preferred communication style: Simple, everyday language.
- Default Unit of Measure for Inventory Items: Pound should be the default unit when creating new inventory items.
- Unit Abbreviation: "Pound" displays as "lb." throughout the UI.
- Yield Field: Yield is stored as a percentage value (0-100).
- Par Level & Reorder Level: Stored on `inventory_items` table as default values, overrideable at the store level.
- Active/Inactive Status: Dual-level active status (global and store-specific).
- Store Locations: Inventory items require assignment to at least one store location during creation.
- Storage Locations: Inventory items can be associated with multiple storage locations; at least one is required. Storage Locations page features drag-and-drop reordering. The sortOrder field is managed automatically by drag position, removed from create/edit forms. Inventory count displays respect storage location sortOrder - both the location summary cards and the grouped item displays are sorted by storage location sortOrder for consistent organization.
- Recipe `canBeIngredient`: Recipes include a `canBeIngredient` checkbox field (0/1 in DB) to mark if they can be used as ingredients in other recipes.
- Category Filtering in Recipe Builder: Categories include a `showAsIngredient` field (0/1 in DB) controlling whether items in this category appear in the recipe builder's ingredient selection.
- Waste Percentage Removal: The waste percentage field has been removed from recipes.
- Recipe Cost Calculation Fix: Ingredient prices must be converted to base unit prices before multiplication.
- Recipe Company Isolation: Implement comprehensive company-level isolation for recipes and recipe components.
- Recipe Builder UI Redesign: Optimized layout for ingredients window space, with recipe name and total cost on the same row, yield fields and "Can be used as ingredient" checkbox within a collapsed accordion, and reduced heading font size for ingredients section.
- Recipe Cost Recalculation on Inventory Price Changes: Automatically recalculate all affected recipes when an inventory item's price changes, including nested recipes, ensuring recalculation in dependency order.
- Number Input Fields: All number input fields throughout the application have spinner controls (up/down arrows) removed for a cleaner interface.
- Recipe Name Capitalization: Recipe names are automatically displayed with the first letter capitalized in all UI presentations (recipe list, detail pages, dropdowns) while preserving the original database values.
- Placeholder Recipe System: During CSV menu import onboarding, placeholder recipes are automatically created for all recipe items (isRecipeItem=1), containing 1 oz of a "Placeholder Ingredient" and flagged with isPlaceholder=1. This enables immediate CSV import while allowing gradual recipe building. Menu Items page displays recipe status badges (Placeholder/Complete/Needs Recipe/N/A). Recipe saves set isPlaceholder to 0, converting placeholders to complete recipes. Recipe saves trigger Menu Items page refresh to ensure badge status and recipe costs update immediately.
- Menu Item Management: Menu items can be created manually via "Add Menu Item" dialog with form validation (required: name, PLU/SKU; optional: department, category, size, price, recipe, isRecipeItem flag). Recipe selection dropdown allows linking recipes during creation or editing. "Create new recipe with this name" link navigates to Recipe Builder with menu item name pre-populated. Menu items can be edited by clicking the item name or via the actions dropdown menu. Edit dialog includes all fields plus price and recipe selection. Active/inactive status toggle via dropdown actions menu. Department, category, and type filters (Recipe Item/Non-Recipe Item/All) enable easy sorting and filtering. Table displays Recipe Cost (computed from recipe) and Price columns, with Status and Type columns removed for cleaner UI. SKU cleanup script automatically removes pipe symbols from imported POS data and generates abbreviated SKUs (max 10 characters) from item names, with sequential numbering for duplicates.
- Menu Item Store Assignment: Menu items require assignment to at least one store during creation and editing, matching inventory items pattern. Store checkboxes appear in both Add and Edit dialogs with validation.
- Recipe Cost Display: Menu Items page displays computed recipe costs for all menu items that have recipes assigned, including both placeholder and complete recipes. Items without recipes show "-" in the Recipe Cost column.
- Menu Items Table Enhancements: Removed the Recipe status badge column. Added Food Cost % column (calculated as recipe cost / price * 100) as the rightmost data column. All columns are sortable with visual sort indicators (ArrowUpDown, ArrowUp, ArrowDown icons). Clicking a column header sorts ascending, clicking again reverses to descending. Food Cost % displays as a percentage with one decimal trace (e.4%) when both recipe cost and price exist, otherwise shows "-". Recipe Cost values are clickable links that navigate to the recipe edit page.
- Recipe Builder Smart Back Button: Back button in Recipe Builder uses intelligent navigation - if browser history exists (history.length > 1), returns to previous page preserving navigation context; otherwise falls back to /recipes.
- Dual Pricing Model: Inventory items track both Last Cost (pricePerUnit - most recent purchase price) and Weighted Average Cost (avgCostPerUnit - WAC calculated across all receipts). Inventory Items page displays both price columns. WAC is calculated during receiving using company-wide quantities: `((totalCompanyQty * currentAvgCost) + (receivedQty * receivedPrice)) / (totalCompanyQty + receivedPrice)) / (totalCompanyQty + receivedQty)`.
- Vendor Price Comparison: Purchase order creation includes a "Compare Prices" button (TrendingDown icon) on each item row that opens a dialog showing all vendor prices for that item. The dialog displays vendor name, SKU, case size, unit price, and case price, sorted by case price (lowest first). The lowest-priced vendor is highlighted with a "Best Price" badge. Uses vendor-specific case sizes and includes zero-priced items (promotional offers). Only excludes vendors with null/undefined prices.
- Vendor-Specific Purchase Order Pricing: Purchase orders use vendor-specific pricing (vendor_items.lastPrice) instead of general inventory pricing (inventory_items.pricePerUnit). All pricing logic uses nullish coalescing (`??`) to preserve legitimate zero-priced vendor items (promotional offers, free samples) while falling back to inventory pricing only when vendor prices are null/undefined.
- Vendor Delivery Scheduling: Delivery scheduling is managed at the vendor level. Each vendor has `deliveryDays` (array of weekdays when vendor delivers) and `leadDaysAhead` (number of days before delivery that orders must be placed). Vendors page includes checkboxes for each weekday and a numeric input for lead days ahead in the add/edit vendor dialog. Lead time field has been completely removed from vendor items.
- Vendor Deletion Constraints: Vendors with purchase orders or vendor items (products) cannot be deleted - only deactivated. Backend enforces constraints returning 400 errors with guidance to deactivate instead. Frontend displays error messages via toast notifications with clean, user-friendly text parsed from JSON responses.
- Misc Grocery Vendor Protection: "Misc Grocery" is a system vendor automatically created for each company, used for unit-based ordering. Frontend hides delete button for vendors with names containing "misc grocery" (case-insensitive). Backend additionally blocks deletion attempts via API, returning error: "Cannot delete Misc Grocery vendor. This is a system vendor used for unit-based ordering." Edit functionality remains available.
- Default Categories: All companies automatically start with three default categories: "Frozen", "Walk-In", and "Dry/Pantry". Companies can customize and add additional categories as needed.
- Comprehensive Kitchen Units: System includes 40 comprehensive kitchen measurement units covering both imperial and metric systems. Companies have a `preferredUnitSystem` setting (imperial/metric/both) to control default unit display preferences throughout the application.
- Unit Compatibility Filtering: Recipe builder implements intelligent unit filtering to prevent incompatible unit selections. When adding or editing ingredients, the unit dropdown automatically filters to show only units matching the ingredient's measurement kind (weight/volume/count) and the company's preferredUnitSystem setting (imperial/metric/both). Backend endpoint GET `/api/units/compatible?unitId=<uuid>` returns filtered units. Frontend uses React Query with custom queryFn to fetch compatible units, implementing length-aware fallback `(compatibleUnits?.length ? compatibleUnits : allUnits)` to ensure dropdown always has options.
- Recipe Cost Caching: Recipes list displays real-time calculated costs instead of stale database values. GET /api/recipes endpoint calculates costs on-demand using bulk-loaded data with parallel processing and per-request memoization. Calculated costs overwrite the `computedCost` field in API responses. A 5-minute cache (`recipes:costs:${companyId}`) optimizes performance. Cache invalidation via `cacheInvalidator.invalidateRecipes()` ensures the cache is cleared when recipes, recipe components, or inventory prices changes.
- Order Completion Timestamps: Orders page displays completion timestamps via mouseover tooltips on status badges. For transfer orders with status="completed", tooltip shows `transferOrder.completedAt`. For purchase orders with status="received", tooltip shows the latest completed receipt's `receivedAt` timestamp. Only orders with status="completed" or "received" AND a valid completedAt value show the tooltip.
- Date Formatting & Timezone Safety: All date displays use `formatDateString()` helper that parses YYYY-MM-DD strings into local timezone Date objects. Purchase order Expected Date field uses standard HTML `<input type="date">`. Date flow is entirely string-based: backend sends YYYY-MM-DD, frontend stores/edits as string, display converts to local timezone only.
- Receiving Page Status Display: Consolidated duplicate status badges into single Badge component with conditional styling. Shows green "received" badge when receipt is completed OR purchase order status is "received".
- Transfer Order Usage Tracking: Usage calculation on Purchase Order detail page now accounts for outbound transfers to prevent over-ordering. Formula updated to: Usage = Previous Count + Received - Transferred - Current. New "Transfers" column displays between "Current" and "Usage" columns, showing quantities transferred out during the count period. Multi-tenant data isolation enforced with comprehensive validation.
- Conditional Transfer UI Rendering: Transfer-related features are automatically hidden for single-store companies (transfers require minimum 2 stores). Sidebar's "Transfer Orders" menu item is conditionally rendered based on accessible stores count. Purchase Order detail page's "Transfers" column is conditionally rendered using the same logic.
- Tare Weight Categories & Case Counting: Categories table includes `isTareWeightCategory` field (integer 0/1, default 0) to identify categories that enable case counting in inventory counts. Storage Locations table includes `allowCaseCounting` field (integer 0/1, default 0) to enable case count fields for items in specific locations. Both fields appear as checkboxes in their respective management UIs.
- Mobile Responsiveness for Inventory Counts: Count session page fully optimized for mobile warehouse usage. Touch-friendly inputs (h-10 on mobile, h-9 on desktop), responsive layouts with sm: breakpoint at 640px, compact sticky dashboard (reduced padding and text sizes, hidden icons on mobile), wrapping item headers that stack vertically on small screens, and hidden "Previous" links on mobile for cleaner interface. All layouts transition smoothly from mobile → tablet → desktop without horizontal overflow.

## System Architecture

### Multi-Company Enterprise Architecture
The system employs a multi-tenant architecture with robust data isolation at both company and store levels.

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI**: `shadcn/ui` components, built on Radix UI and styled with Tailwind CSS.
- **State Management**: TanStack Query for data fetching/caching; React Context for global state.
- **Routing**: Wouter for client-side navigation.

### Backend
- **Runtime**: Node.js with TypeScript.
- **Web Framework**: Express.js for RESTful APIs.
- **API Design**: RESTful principles, WebSockets for real-time communication, Zod for schema validation.
- **Database Layer**: Drizzle ORM with PostgreSQL.

### Architectural Decisions
- **Application Structure**: Single-Page Application (SPA).
- **Real-time Data**: WebSockets for real-time updates.
- **Precision**: Micro-unit system for accurate inventory and costing.
- **Inventory Management**: Automated adjustments, historical recipe versioning, auto-populated and locked inventory count sessions, dynamic `onHandQty` updates.
- **Purchase Order Management**: Unit/case ordering, vendor filtering, keyboard-optimized data entry, partial receipts, resumable sessions, on-the-fly unit price editing.
- **Vendor Integration**: Pluggable adapter pattern.
- **Object Storage**: Presigned URLs and thumbnail generation for images.
- **Unified Orders Page**: Centralized interface for Purchase Orders, Receiving, and Transfer Orders.
- **Store-to-Store Transfer Orders**: Facilitates inter-store inventory movement.
- **Waste Tracking Module**: Comprehensive logging and management of waste with store-level isolation.
- **Security**: HMAC-SHA256 for secure API integrations.
- **Scalability**: Connection pooling, composite indexes, atomic transactions, session cleanup, Redis caching, response compression (gzip).

## External Dependencies
- **Database Services**: Neon serverless PostgreSQL.
- **Real-time Communication**: `ws` library (WebSockets).
- **Image Processing**: Sharp.
- **Object Storage**: Replit's object storage.
- **Vendor Integrations**: Custom adapters for Sysco, GFS, and US Foods.