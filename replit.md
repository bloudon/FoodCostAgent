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
- **Dashboard**: Displays company information card (name, address, phone, email) with conditional rendering and proper icon formatting (October 2025).
- **Receiving Module Enhancements** (October 2025): Clickable item names in receiving table open inventory item edit dialog for quick price adjustments during receiving; changes immediately reflect in the receiving table.

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
- Purchase order detail page redesigned (October 2025): Full vendor product list view with search and category filters, inline case quantity inputs, real-time summary totals, supports both Misc Grocery (unit-based, keyed by inventoryItemId) and regular vendors (case-based, keyed by vendorItemId).
- Inventory count sessions auto-populate active items, support inline editing, capture price snapshots, and allow multi-location filtering without directly updating inventory levels.
- System-wide standardization from "product" to "inventory item" terminology.
- Enhanced vendor management with CRUD operations for vendor items and dedicated vendor detail pages.
- Robust unit conversion module with comprehensive cooking and metric conversions.
- **Receiving Module** (October 2025):
  - **Partial Receipt Workflow**: Draft receipts support resumable receiving sessions with per-line saves, visual indicators for short quantities (red/pink row background), and automatic state persistence across navigation
  - **Clickable Item Names**: Item names in receiving table are interactive buttons that open inventory item edit dialog for quick price adjustments; updated prices immediately recalculate in the receiving table via real-time backend price queries
  - **Unit-Based Receiving**: Orders placed in cases are received in units for precise quantity tracking; expected quantities calculated from case quantities × case size
  - **Price Synchronization**: Purchase order detail endpoint returns current inventory item prices (pricePerUnit × caseSize) instead of locked PO line prices, enabling real-time price updates during receiving
- **Vendor Integration Architecture** (October 2025):
  - **Order Guide Type Classification**: Vendors are classified as "electronic" (EDI/API/PunchOut enabled) or "manual" (local suppliers requiring manual entry). This field is stored in the vendors.orderGuideType column and displayed in the UI with badges and form controls.
  - **VendorAdapter Pattern**: Pluggable integration system for food distributors (Sysco, GFS, US Foods)
  - **Multiple Integration Methods**: EDI (X12), CSV order guides, REST APIs, PunchOut/cXML
  - **EDI Support**: Generic gateway for X12 transactions (850 PO, 810 Invoice, 832 Price Catalog, 997 Ack)
  - **CSV Parser**: Vendor-specific column mappings for order guide imports
  - **PunchOut Integration**: cXML protocol support for interactive catalog shopping (US Foods)
  - **API Routes**: Authenticated endpoints for sync, submit PO, fetch invoices, PunchOut flows
  - **Security**: All integration endpoints protected with requireAuth middleware and Zod validation
  - **Credentials Management** (October 2025):
    - **Database Storage**: vendor_credentials table stores all vendor API keys, EDI configs, SFTP details, and PunchOut settings
    - **Admin-Only Access**: Credential management restricted to admin role via requireAdmin middleware
    - **Credential Redaction**: API responses redact sensitive fields (passwords, secrets, API keys) from non-admin views
    - **Field Coverage**: Supports API (key/secret/URL/username/password), EDI (ISA/GS/Qualifier/AS2), SFTP (host/port/credentials/path), PunchOut (URL/domain/identity/shared secret)
    - **Active Status**: Adapters only load for isActive=1 credentials; deactivated vendors automatically evict cache
    - **Cache Invalidation**: Adapter cache cleared on credential updates to ensure fresh configuration
    - **Fallback Support**: Environment variables used as fallback if database credentials not configured
  - **Data Persistence** (October 2025):
    - **edi_messages table**: Logs all EDI transmissions (sent/received) with status tracking, control numbers, and raw X12 content
    - **order_guides table**: Stores metadata about fetched order guides (vendor, source method, row count, dates)
    - **order_guide_lines table**: Product line items from order guides with SKU, pricing, pack sizes, and category data
    - **Integration**: Storage layer supports batch operations for efficient order guide imports and EDI message logging
  - **EDI X12 Mapping** (October 2025):
    - **Bidirectional Conversion**: JSON ↔ X12 transformation for 850 (PO), 855 (PO Ack), 810 (Invoice)
    - **Parser**: Converts X12 to normalized JSON, handles all required segments (BEG, DTM, N1/N3/N4, PO1/IT1, PID, CTT, BAK, BIG, ACK, TDS)
    - **Generator**: Converts normalized JSON to X12 format with configurable separators
    - **N1 Loop Handling**: Properly parses/generates both identification qualifiers and codes for trading partners
    - **Dual Storage**: Stores both normalized JSON (payloadJson) and raw X12 (rawEdi) in edi_messages table
    - **No Hard-Coded Conversions**: Uses existing units system, no hard-wired densities
    - **Webhook Integration**: Parses incoming X12 documents, verifies HMAC signatures
    - **PO Submission**: Generates X12 from JSON when submitting purchase orders
    - **Test Coverage**: Comprehensive test suite covering parsing, generation, and round-trip conversion
  - **PunchOut cXML Implementation** (October 2025):
    - **Real HTTP Integration**: CxmlClient sends POST requests to vendor punchout URLs with cXML SetupRequest
    - **XML Parsing**: fast-xml-parser library parses cXML responses and PunchOutOrderMessage documents
    - **Session Management**: Extracts redirect URLs from SetupResponse for interactive catalog sessions
    - **Cart Return Processing**: Parses ItemIn elements with robust Money/UnitPrice handling for accurate pricing
    - **HMAC Signature Validation**: Validates incoming cXML payloads using HMAC-SHA256 with constant-time comparison
    - **Test Coverage**: Comprehensive fixtures (setup-response.xml, order-message.xml) and executable test script
  - **CSV Order Guide Enhancements** (October 2025):
    - **InnerPack Support**: VendorProduct interface and CSV parser handle innerPack field from order guides
    - **Vendor Item Sync**: Order guide imports automatically update vendor_items with latest prices, case sizes, and inner pack sizes
    - **Column Mapping**: Supports vendor-specific CSV formats (Sysco, GFS, US Foods) with flexible column detection
  - **Environment Configuration** (October 2025):
    - **Zod Validation**: server/config/env.ts validates all environment variables at startup
    - **Required Fields**: EDI_GATEWAY_BASE_URL, EDI_GATEWAY_TOKEN, AS2_INBOUND_HMAC_SECRET, MAX_UPLOAD_SIZE_MB
    - **Example Template**: .env.example provides template for all integration credentials
  - **Status**: Complete vendor integration infrastructure with EDI X12, CSV parsing, and PunchOut cXML support; ready for live vendor connections
- **Object Storage Integration** (October 2025):
  - **Replit Object Storage**: Integrated Google Cloud Storage via Replit's object storage service for inventory item images
  - **Image Upload Flow**: ObjectUploader component (Uppy-based) → presigned URL generation → direct upload to GCS → ACL policy setting
  - **Thumbnail Generation**: Sharp library automatically creates 200x200px thumbnails on-the-fly via query parameter (?thumbnail=true)
  - **Backend Routes**:
    - `POST /api/objects/upload`: Generates presigned URLs for authenticated uploads
    - `GET /objects/:objectPath(*)`: Serves images with optional thumbnail rendering
    - `PUT /api/inventory-items/:id/image`: Updates inventory item with uploaded image path and sets ACL
  - **ACL Management**: Public visibility for inventory item images with owner tracking; supports extensible access control rules
  - **Environment Variables**: Requires `PRIVATE_OBJECT_DIR` for uploaded files and optionally `PUBLIC_OBJECT_SEARCH_PATHS` for static assets
  - **UI Components**: ObjectUploader button with modal interface, drag-drop support, progress tracking, and automatic cache invalidation
  - **File Handling**: Max 10MB uploads, image-only restriction, automatic content-type detection, efficient streaming with caching headers

## External Dependencies
- **Third-Party UI Libraries**: Radix UI, Lucide React, Embla Carousel, cmdk, date-fns, Recharts.
- **Development Tools**: Vite, ESBuild, tsx.
- **Database Services**: Neon serverless PostgreSQL, `ws` package for WebSockets, `@neondatabase/serverless` for connection pooling.
- **Authentication Dependencies**: Session management infrastructure, password hashing, role-based access control.