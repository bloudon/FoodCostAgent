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
    - **Recording Only**: Count sessions do NOT automatically update inventory levels
    - **Dashboard Filtering**: Filter cards show aggregated values by category and location
    - **Toggle Behavior**: Click to filter, click again to clear; both filters can be active simultaneously
    - **Empty Counts**: "Show empty counts" toggle defaults to false (hides items with qty=0)
    - Handles "Uncategorized" items and items without locations using sentinel values
  - **Terminology Standardization** (October 2025):
    - Completed comprehensive refactoring from "product" to "inventory item" terminology throughout entire codebase
    - Updated all server routes to use inventory item storage methods
    - Updated all frontend pages, UI text, placeholders, and labels
    - Recipe components now consistently use `inventory_item` componentType
    - All user-facing text standardized: "Search items...", "Variance by Item", "Compare by item"
    - Verified with end-to-end testing and architect review

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