# Restaurant Inventory & Recipe Costing Application

## Overview
This project is a comprehensive inventory management and recipe costing system designed for pizza restaurants and similar food service businesses. It facilitates the management of inventory items, vendors, recipes, and purchase orders. Key capabilities include complex unit conversions, nested recipes, real-time POS sales data integration for theoretical usage calculations, and detailed variance reporting. The system aims to enhance operational efficiency, reduce waste, and improve profitability for food service establishments.

## User Preferences
Preferred communication style: Simple, everyday language.

### Inventory Item Configuration
- **Default Unit of Measure**: Pound should be the default unit when creating new inventory items
- **Yield Field**: Yield is stored as a percentage value (0-100), not a separate yield amount + unit
- **Storage Locations**: Inventory items can be associated with multiple storage locations using checkboxes. At least one location is required. The primary location is indicated with a "Primary" badge.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI**: shadcn/ui with Radix UI, inspired by Linear and Stripe Dashboard.
- **Styling**: Tailwind CSS, custom CSS variables for theming, design tokens, and a pizza-inspired warm orange primary color.
- **State Management**: TanStack Query for server state; local component state for UI.
- **Routing**: Wouter for client-side routing.
- **Key Features**: Dark/light theme, responsive navigation, search/filtering, real-time data updates via WebSockets.

### Backend
- **Runtime**: Node.js with TypeScript.
- **Web Framework**: Express.js for REST APIs.
- **API Design**: RESTful endpoints, WebSocket server for real-time POS sales, structured error handling, Zod for validation.
- **Database Layer**: Drizzle ORM, PostgreSQL (Neon serverless), schema-first approach with migrations, Zod integration.
- **Core Domain Models**: Users, Storage Locations, Units, Inventory Items (location-specific with quantities), Vendors, Vendor Items, Recipes (with nested components), Inventory Counts, Purchase Orders, POS Sales, Menu Items, Transfer Logs, Waste Logs.
- **Inventory Architecture**: Inventory items are physical items at specific locations, with aggregated totals computed across locations.
- **Business Logic**: Unit conversion, recursive recipe cost calculation with yield-based scaling, location-based inventory tracking, theoretical vs. actual usage variance, purchase order workflow, COGS analysis, price change impact analysis.

### Architectural Decisions
- Single-page application with client-side routing.
- API and frontend served from the same Express server.
- WebSocket for real-time POS data streaming.
- Micro-unit system for precise inventory.
- Recursive recipe cost calculation with yield-based scaling.
- Automatic inventory adjustments for transfers and waste.
- Historical recipe versioning for cost tracking.
- Comprehensive inventory count interface including case counts and open units.
- Dedicated pages for managing storage locations, inventory items with status indicators, and detailed recipe views.
- Robust settings and configuration module for company info, user profiles, data connections, and system preferences.
- Purchase order management supports both unit-based and case-based ordering, with vendor-specific item filtering and keyboard-optimized entry.
- Inventory count sessions auto-populate active items, support inline editing, capture price snapshots, and allow multi-location filtering without directly updating inventory levels.
- System-wide standardization from "product" to "inventory item" terminology.
- Enhanced vendor management with CRUD operations for vendor items and dedicated vendor detail pages.
- Robust unit conversion module with comprehensive cooking and metric conversions.

## External Dependencies
- **Third-Party UI Libraries**: Radix UI, Lucide React, Embla Carousel, cmdk, date-fns, Recharts.
- **Development Tools**: Vite, ESBuild, tsx.
- **Database Services**: Neon serverless PostgreSQL, `ws` package for WebSockets, `@neondatabase/serverless` for connection pooling.
- **Authentication Dependencies**: Session management infrastructure, password hashing, role-based access control.