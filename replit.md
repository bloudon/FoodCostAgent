# Overview

This project is an inventory management and recipe costing system for food service businesses (FNB Cost Pro). Its core purpose is to enhance profitability and operational efficiency by providing precise unit conversions, comprehensive nested recipe management, integration with POS sales data, and detailed variance reporting. The system aims to minimize waste, optimize profit margins, offer real-time inventory estimates, streamline vendor interactions, and accurately control food costs, thereby supporting business growth and informed decision-making.

# User Preferences

- Preferred communication style: Simple, everyday language.
- Branding: FNB Cost Pro logo (white "FNB" text with green "cost pro" and bottle icon on black background) integrated across all pages.
- Color Scheme: Header/menu uses slate blue grey (`--primary: 215 16% 47%`), buttons use periwinkle blue accent (`--accent-button: 217 91% 60%`). Defined in `client/src/index.css` with dark mode variants.
- Default Unit of Measure for Inventory Items: Pound should be the default unit when creating new inventory items.
- Unit Abbreviation: "Pound" displays as "lb." throughout the UI.
- Yield Field: Yield is stored as a percentage value (0-100).
- Par Level & Reorder Level: Stored on `inventory_items` table as default values, overrideable at the store level.
- Active/Inactive Status: Dual-level active status (global and store-specific).
- Store Locations: Inventory items require assignment to at least one store location during creation.
- Storage Locations: Inventory items can be associated with multiple storage locations; at least one is required. Storage Locations page features drag-and-drop reordering. Inventory count displays respect storage location sortOrder.
- Recipe `canBeIngredient`: Recipes include a `canBeIngredient` checkbox field (0/1 in DB) to mark if they can be used as ingredients in other recipes.
- Category Filtering in Recipe Builder: Categories include a `showAsIngredient` field (0/1 in DB) controlling whether items in this category appear in the recipe builder's ingredient selection.
- Recipe Cost Calculation Fix: Ingredient prices must be converted to base unit prices before multiplication.
- Recipe Company Isolation: Implement comprehensive company-level isolation for recipes and recipe components.
- Recipe Cost Recalculation on Inventory Price Changes: Automatically recalculate all affected recipes when an inventory item's price changes, including nested recipes, ensuring recalculation in dependency order.
- Number Input Fields: All number input fields throughout the application have spinner controls (up/down arrows) removed.
- Recipe Name Capitalization: Recipe names are automatically displayed with the first letter capitalized in all UI presentations while preserving the original database values.
- User Accountability Tracking: All key actions (receipts completion, transfer creation/execution/receiving, waste logging) track the user who performed them. Dates display tooltips showing "Action by Username" on hover.

# System Architecture

- **Frontend**: Mobile-first React 18 SPA with TypeScript, Vite, `shadcn/ui` (Radix UI, Tailwind CSS), TanStack Query, React Context, and Wouter for routing.
- **Backend**: Node.js (TypeScript) with Express.js and Zod for data validation.
- **Database**: PostgreSQL with Drizzle ORM.
- **Application Structure**: Multi-tenant Single Page Application (SPA) with strict data isolation.
- **UI/UX Decisions**: Mobile-first design; intuitive recipe creation; dynamic dashboards with filterable tables; consistent, color-coded status badges; conditional UI rendering based on data availability; smooth scrolling; and optimized inventory count layouts.
- **Technical Implementations**: Micro-unit precision for all inventory calculations, comprehensive unit conversion system, multi-level nested recipe costing, dual inventory pricing (Last Cost & Weighted Average Cost), robust multi-tenant QuickBooks integration, intelligent vendor order guide import, real-time recipe cost calculation with caching, dynamic estimated on-hand inventory with automated cache invalidation, detailed TFC (Theoretical Food Cost) variance reporting, and single-timezone date handling for data consistency.
- **System Design Choices**: Adherence to strict multi-tenancy principles, secure OAuth using HMAC-SHA256, extensive server-side validation, and robust vendor relationship management features.

# External Dependencies

- **Database Services**: Neon serverless PostgreSQL.
- **Real-time Communication**: `ws` library (WebSockets).
- **Image Processing**: Sharp library.
- **Object Storage**: Replit's native object storage solution.
- **Vendor Integrations**: Custom adapters for Sysco, GFS, and US Foods order guides.
- **QuickBooks Online Integration**: `intuit-oauth` package for OAuth 2.0.