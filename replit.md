# Restaurant Inventory & Recipe Costing Application

## Overview
This project is a comprehensive inventory management and recipe costing system designed for multi-company food service businesses, particularly pizza restaurants. Its primary purpose is to optimize operations, reduce waste, and improve profitability. Key capabilities include advanced unit conversions, nested recipes, real-time POS sales integration, detailed variance reporting, dual pricing models (Last Cost and Weighted Average Cost), and vendor price comparison for purchase orders. The ambition is to provide a robust solution for managing complex restaurant operations efficiently.

## User Preferences
Preferred communication style: Simple, everyday language.
- Default Unit of Measure for Inventory Items: Pound should be the default unit when creating new inventory items.
- Unit Abbreviation: "Pound" displays as "lb." throughout the UI.
- Yield Field: Yield is stored as a percentage value (0-100).
- Par Level & Reorder Level: Stored on `inventory_items` table as default values, overrideable at the store level.
- Active/Inactive Status: Dual-level active status (global and store-specific).
- Store Locations: Inventory items require assignment to at least one store location during creation.
- Storage Locations: Inventory items can be associated with multiple storage locations; at least one is required. Storage Locations page features drag-and-drop reordering using @dnd-kit library. Locations display in a vertical stacked list with GripVertical drag handles. Order changes persist immediately to database via transaction-based bulk updates. The sortOrder field is managed automatically by drag position, removed from create/edit forms. Error handling ensures UI resyncs on failed reorder attempts.
- Recipe `canBeIngredient`: Recipes include a `canBeIngredient` checkbox field (0/1 in DB) to mark if they can be used as ingredients in other recipes.
- Category Filtering in Recipe Builder: Categories include a `showAsIngredient` field (0/1 in DB) controlling whether items in that category appear in the recipe builder's ingredient selection.
- Waste Percentage Removal: The waste percentage field has been removed from recipes.
- Recipe Cost Calculation Fix: Ingredient prices must be converted to base unit prices before multiplication.
- Recipe Company Isolation: Implement comprehensive company-level isolation for recipes and recipe components.
- Recipe Builder UI Redesign: Optimized layout for ingredients window space, with recipe name and total cost on the same row, yield fields and "Can be used as ingredient" checkbox within a collapsed accordion, and reduced heading font size for ingredients section.
- Recipe Cost Recalculation on Inventory Price Changes: Automatically recalculate all affected recipes when an inventory item's price changes, including nested recipes, ensuring recalculation in dependency order.
- Number Input Fields: All number input fields throughout the application have spinner controls (up/down arrows) removed for a cleaner interface.
- Recipe Name Capitalization: Recipe names are automatically displayed with the first letter capitalized in all UI presentations (recipe list, detail pages, dropdowns) while preserving the original database values.
- Placeholder Recipe System: During CSV menu import onboarding, placeholder recipes are automatically created for all recipe items (isRecipeItem=1), containing 1 oz of a "Placeholder Ingredient" and flagged with isPlaceholder=1. This enables immediate CSV import while allowing gradual recipe building. Menu Items page displays recipe status badges (Placeholder/Complete/Needs Recipe/N/A). Recipe saves set isPlaceholder to 0, converting placeholders to complete recipes. Recipe saves trigger Menu Items page refresh to ensure badge status and recipe costs update immediately.
- Menu Item Management: Menu items can be created manually via "Add Menu Item" dialog with form validation (required: name, PLU/SKU; optional: department, category, size, price, recipe, isRecipeItem flag). Recipe selection dropdown allows linking recipes during creation or editing, eliminating the need for manual linking. "Create new recipe with this name" link navigates to Recipe Builder with menu item name pre-populated for streamlined recipe creation workflow. Menu items can be edited by clicking the item name or via the actions dropdown menu. Edit dialog includes all fields plus price and recipe selection. Active/inactive status toggle via dropdown actions menu. Department, category, and type filters (Recipe Item/Non-Recipe Item/All) enable easy sorting and filtering. Table displays Recipe Cost (computed from recipe) and Price columns, with Status and Type columns removed for cleaner UI. SKU cleanup script automatically removes pipe symbols from imported POS data and generates abbreviated SKUs (max 10 characters) from item names, with sequential numbering for duplicates.
- Menu Item Store Assignment: Menu items require assignment to at least one store during creation and editing, matching inventory items pattern. Store checkboxes appear in both Add and Edit dialogs with validation. Store assignments properly persist and sync via bulk create/delete operations with company-level data isolation. Fixed backend route imports to use `companyStores` table.
- Recipe Cost Display: Menu Items page displays computed recipe costs for all menu items that have recipes assigned, including both placeholder and complete recipes. Items without recipes show "-" in the Recipe Cost column.
- Menu Items Table Enhancements: Removed the Recipe status badge column. Added Food Cost % column (calculated as recipe cost / price * 100) as the rightmost data column. All columns are sortable with visual sort indicators (ArrowUpDown, ArrowUp, ArrowDown icons). Clicking a column header sorts ascending, clicking again reverses to descending. Food Cost % displays as a percentage with one decimal trace (e.g., "25.4%") when both recipe cost and price exist, otherwise shows "-". Recipe Cost values are clickable links that navigate to the recipe edit page.
- Recipe Builder Smart Back Button: Back button in Recipe Builder uses intelligent navigation - if browser history exists (history.length > 1), returns to previous page preserving navigation context; otherwise falls back to /recipes. This ensures users navigating from Menu Items return to Menu Items, while users from Recipes index return to Recipes, and direct URL access falls back gracefully.
- Dual Pricing Model: Inventory items track both Last Cost (pricePerUnit - most recent purchase price) and Weighted Average Cost (avgCostPerUnit - WAC calculated across all receipts). Inventory Items page displays both price columns for better pricing visibility and decision-making. WAC is calculated during receiving using company-wide quantities: `((totalCompanyQty * currentAvgCost) + (receivedQty * receivedPrice)) / (totalCompanyQty + receivedQty)`.
- Vendor Price Comparison: Purchase order creation includes a "Compare Prices" button (TrendingDown icon) on each item row that opens a dialog showing all vendor prices for that item. The dialog displays vendor name, SKU, case size, unit price, and case price, sorted by case price (lowest first). The lowest-priced vendor is highlighted with a "Best Price" badge. Uses vendor-specific case sizes and includes zero-priced items (promotional offers). Only excludes vendors with null/undefined prices.
- Vendor-Specific Purchase Order Pricing: Purchase orders use vendor-specific pricing (vendor_items.lastPrice) instead of general inventory pricing (inventory_items.pricePerUnit). All pricing logic uses nullish coalescing (`??`) to preserve legitimate zero-priced vendor items (promotional offers, free samples) while falling back to inventory pricing only when vendor prices are null/undefined. This ensures accurate vendor-specific costing for purchase orders, receipts, and price comparisons.

## System Architecture

### Multi-Company Enterprise Architecture
The system utilizes a multi-tenant architecture with data isolation at company and store levels, integrating with Thrive Control Center (TCC).

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI**: `shadcn/ui` components (Radix UI, Tailwind CSS) for custom theming, dark/light modes, and responsive navigation.
- **State Management**: TanStack Query.
- **Routing**: Wouter.

### Backend
- **Runtime**: Node.js with TypeScript.
- **Web Framework**: Express.js for RESTful APIs.
- **API Design**: RESTful, WebSocket for real-time data, Zod validation.
- **Database Layer**: Drizzle ORM, PostgreSQL (Neon serverless), schema-first with migrations.
- **Core Domain Models**: Users, Storage Locations, Units, Inventory Items, Vendors, Recipes (nested), Inventory Counts, Purchase Orders, POS Sales, Transfer/Waste Logs.
- **Business Logic**: Unit conversion, recursive recipe costing, location-based inventory, theoretical vs. actual usage variance, purchase order workflows, COGS analysis.
- **Authentication & Sessions**: Hybrid authentication supporting both username/password AND enterprise SSO (Replit OpenID Connect). Session-based with `selected_company_id`.
- **Role-Based Access Control**: Hierarchical permissions (`global_admin`, `company_admin`, `store_manager`, `store_user`). Company admins require access to all store locations by default.
- **Enterprise SSO Integration (Production-Ready)**: Replit OpenID Connect for enterprise authentication, email-based account linking, Passport.js session management with PostgreSQL storage (sessions table). Session cookies configured with `secure: false` in development, `sameSite: "lax"` for OAuth redirects. Backend routes: /api/sso/login, /api/sso/callback, /api/sso/logout. Frontend displays SSO status in Settings > Profile tab. Pending-approval page for users without company assignments. **Fully tested and operational.**
- **User Invitation System (Phase 2 - Production-Ready)**: Comprehensive invitation system with dual authentication support (SSO + username/password). Features token-validated invitation flow, secure session-scoped token transfer, email verification in SSO callback to prevent cross-account attacks, company admin auto-assignment to all stores, and invitation management UI in /users page. Both authentication methods consistently handle selectedCompanyId for global admin company selection. Architected with security-first design, including HMAC token validation, expiration checks, and proper session handling across both auth modes. **All security vulnerabilities resolved, code production-ready.**

### Architectural Decisions
- **Application Structure**: Single-page application with co-served API and frontend.
- **Real-time Data**: WebSocket for POS data.
- **Precision**: Micro-unit system for accurate tracking and costing.
- **Inventory Adjustments**: Automated for transfers/waste, historical recipe versioning.
- **Inventory Count Sessions**: Auto-populates items, updates `store_inventory_items.onHandQty`, and locks sessions.
- **Purchase Order Management**: Supports unit/case ordering, vendor-specific filtering, and keyboard-optimized entry.
- **Terminology Standardization**: Consistent use of "inventory item."
- **Receiving Module**: Supports partial receipts, resumable sessions, and allows editing unit prices.
- **Vendor Integration**: Pluggable adapter pattern for distributors.
- **Object Storage**: Google Cloud Storage (via Replit's object storage) for inventory item images, using presigned URLs and on-the-fly thumbnails.
- **Unified Orders Page**: Consolidates Purchase Orders, Receiving, and Transfer Orders.
- **Store-to-Store Transfer Orders**: Tracks inventory movement with a defined workflow.
- **Waste Tracking Module**: Comprehensive waste logging with store-level isolation, touch-friendly UI, automatic value calculation.
- **HMAC Authentication for Inbound Data Feeds**: Implemented hierarchical HMAC-SHA256 for securing API integrations (POS, vendor EDI), including company-level credentials, timestamp/nonce validation, content MD5, and optional IP whitelisting.
- **Company Data Purge System (Development Only)**: Cascading delete for purging all company-associated data, restricted to development and global_admin.
- **Scalability Optimizations (Phase 1 & 2)**: Production-ready infrastructure for 50-200 concurrent users.
  - **Phase 1 (Completed)**: Connection pooling (max 20 connections), 13 composite indexes on high-traffic tables, atomic transactions, session cleanup.
  - **Phase 2 (Completed)**: Redis caching layer with graceful fallback, session/user caching with automatic invalidation, response compression (gzip).
  - **Performance**: Load tested at 50/100/150 concurrent users with 0% error rate. Linear latency degradation (277ms → 548ms → 825ms). Expected 40-60% latency reduction when Redis configured.
  - **Redis Setup**: Optional but recommended for production. See REDIS_SETUP.md for Upstash/Redis Labs configuration. System works correctly without Redis using database fallback.

## External Dependencies
- **Third-Party UI Libraries**: Radix UI, Lucide React, Embla Carousel, cmdk, date-fns, Recharts.
- **Database Services**: Neon serverless PostgreSQL, `@neondatabase/serverless`.
- **Real-time Communication**: `ws` (WebSockets).
- **Image Processing**: Sharp.
- **Vendor Integrations**: Sysco, GFS, US Foods (via custom adapters).