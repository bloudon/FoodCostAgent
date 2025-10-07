# Restaurant Inventory & Recipe Costing Application

## Overview

This is a comprehensive restaurant inventory management and recipe costing system designed for pizza restaurants and similar food service operations. The application helps manage products, vendors, recipes, inventory counts, purchase orders, and provides detailed variance reporting between theoretical and actual usage. It supports complex unit conversions, nested recipe components (bills of materials), and real-time POS sales data ingestion for theoretical usage calculations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React 18 with TypeScript and Vite as the build tool

**UI Component System**: shadcn/ui with Radix UI primitives
- Custom design system inspired by Linear and Stripe Dashboard patterns
- Emphasis on functional efficiency over decorative elements
- Information hierarchy through typography and spacing
- Professional appearance for daily operational use

**Styling Approach**:
- Tailwind CSS for utility-first styling
- Custom CSS variables for theming (light/dark mode support)
- Design tokens for consistent spacing, colors, and typography
- Pizza-inspired warm orange primary color (24 100% 50%)
- Inter font for UI, JetBrains Mono for numerical data

**State Management**:
- TanStack Query (React Query) for server state and caching
- Local component state for UI interactions
- Custom query client with optimized cache settings

**Routing**: Wouter for lightweight client-side routing

**Key Features**:
- Dark/light theme toggle with persistent storage
- Responsive sidebar navigation with mobile sheet fallback
- Search and filtering capabilities across all data views
- Real-time data updates through WebSocket connections

### Backend Architecture

**Runtime**: Node.js with TypeScript

**Web Framework**: Express.js for REST API endpoints

**API Design**:
- RESTful endpoints for CRUD operations
- WebSocket server for real-time POS sales streaming
- Structured error handling and logging middleware
- Request/response validation using Zod schemas

**Database Layer**:
- Drizzle ORM for type-safe database operations
- PostgreSQL via Neon serverless database
- Schema-first approach with migrations
- Zod integration for runtime validation

**Core Domain Models**:
- Users (authentication and role-based access)
- Storage Locations (Walk-In Cooler, Dry Storage, etc.)
- Units (weight, volume, count with conversion ratios)
- Products (inventory items with unit specifications)
- Vendors and Vendor Products (product catalogs with pricing)
- Recipes with nested components (BOM structure)
- Recipe Versions (historical cost change tracking)
- Inventory Counts by location
- Purchase Orders and Receipts
- POS Sales data for theoretical usage (real-time WebSocket ingestion)
- Menu Items linked to recipes
- Transfer Logs (inter-location movements with automatic inventory updates)
- Waste Logs (spoilage tracking with reason codes and trend analysis)

**Business Logic**:
- Unit conversion system with base ratio calculations
- Recipe cost computation including nested recipes with proper yield-based scaling
- Theoretical vs actual usage variance analysis
- Purchase order receiving workflow
- Inventory level tracking across storage locations with automatic adjustment
- Transfer tracking with source/destination inventory updates
- Waste tracking with automatic inventory deduction and validation
- COGS analysis with gross profit and margin calculation
- Price change impact analysis for product cost fluctuations

### Data Storage Solutions

**Primary Database**: PostgreSQL (Neon Serverless)
- Relational schema with foreign key constraints
- UUID primary keys for all entities
- Timestamp tracking for audit trails
- Support for complex joins and aggregations

**ORM Strategy**:
- Drizzle ORM for type-safe queries
- Schema definitions as single source of truth
- Migration system for version control
- Zod schema generation from Drizzle schemas

**Data Seeding**:
- Automated seed data for pizza restaurant operations
- Sample products (flour, cheese, sauce, etc.)
- Example recipes (pizza dough, margherita pizza)
- Pre-configured units and storage locations

### External Dependencies

**Third-Party UI Libraries**:
- Radix UI primitives for accessible components
- Lucide React for iconography
- Embla Carousel for carousel functionality
- cmdk for command palette patterns
- date-fns for date manipulation
- Recharts for data visualization

**Development Tools**:
- Vite for fast development and building
- ESBuild for production bundling
- tsx for TypeScript execution
- Vitest/Jest for testing (configured but implementation pending)

**Database Services**:
- Neon serverless PostgreSQL database
- WebSocket support via ws package
- Connection pooling through @neondatabase/serverless

**Authentication Dependencies**:
- Session management (infrastructure present, implementation pending)
- Password hashing capabilities
- Role-based access control schema (admin, manager, counter, viewer)

**Notable Architectural Decisions**:
- Single-page application with client-side routing
- API and frontend served from same Express server
- Development mode uses Vite middleware for HMR
- Production mode serves pre-built static files
- WebSocket connection for real-time POS data streaming at `/ws/pos`
- Micro-unit system for precise inventory tracking and recipe costing
- Recursive recipe cost calculation with yield-based scaling for sub-recipes
- Automatic inventory adjustments for transfers and waste with validation
- Historical recipe versioning for cost change tracking over time

## Recent Changes (October 2025)

### Database Migration to PostgreSQL
- Migrated from in-memory storage to persistent PostgreSQL database
- Implemented DatabaseStorage class using Drizzle ORM
- All data now persists across application restarts
- Seed data automatically populates on first run

### Real-Time POS Integration
- Added WebSocket server at `/ws/pos` for live sales data ingestion
- Supports real-time streaming of POS sales and line items
- Broadcasts sales to all connected clients
- Integrated with theoretical usage calculations

### Recipe Versioning System
- New `recipe_versions` table tracks historical recipe changes
- Stores version number, components, change reason, and timestamp
- API endpoints: GET/POST `/api/recipe-versions/:recipeId`
- Enables cost change analysis over time

### Transfer & Waste Tracking
- **Transfer Logs**: Track inventory movements between storage locations
  - Automatic inventory updates (deduct from source, add to destination)
  - Quantity validation prevents negative inventory
  - Full audit trail with timestamps and user tracking
  - API: GET/POST `/api/transfers`

- **Waste Logs**: Track spoilage and losses with reason codes
  - Automatic inventory deduction when waste is logged
  - Reason code categorization (spoilage, expired, damaged, etc.)
  - Waste trend analysis by product and reason
  - API: GET/POST `/api/waste`, GET `/api/reports/waste-trends`

### Advanced Cost & Profitability Reports
- **COGS Summary** (`/api/reports/cogs-summary`):
  - Calculates total revenue, COGS, gross profit, and margin %
  - Menu item breakdown with individual profitability
  - Handles nested recipes with correct yield-based scaling
  - Uses POS sales data for accurate revenue tracking

- **Price Change Impact Analysis** (`/api/reports/price-change-impact`):
  - Shows all menu items affected by product price changes
  - Calculates cost contribution and percentage per menu item
  - Recursively tracks product usage through sub-recipes
  - Provides 10% cost change impact estimates

### Recipe Cost Calculation Improvements
- Implemented recursive cost calculation for nested recipes
- Fixed yield-based scaling to prevent double-counting waste
- Sub-recipes properly converted using yield ratios
- Waste percentage applied only once per recipe level
- Helper functions: `calculateRecipeCost`, `calculateProductImpactInRecipe`