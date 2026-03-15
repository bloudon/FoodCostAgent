# Overview

FNB Cost Pro is an inventory management and recipe costing system designed for food service businesses. Its primary goal is to boost profitability and operational efficiency through precise unit conversions, comprehensive nested recipe management, integration with POS sales data, and detailed variance reporting. The system aims to minimize waste, optimize profit margins, provide real-time inventory estimates, streamline vendor interactions, and accurately control food costs, thereby supporting business growth and informed decision-making.

# User Preferences

- Preferred communication style: Simple, everyday language.
- Branding: FNB Cost Pro logo (white "FNB" text with green "cost pro" and bottle icon on black background) integrated across all pages.
- Color Scheme: Header/menu uses slate blue grey (`--primary: 215 16% 47%`), buttons use orange accent (`--accent-button: 24 93% 50%`, hex `#f2690d`). Defined in `client/src/index.css` with dark mode variants.
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
- Yield Override: Recipe ingredients can have a per-recipe yield override (stored as `yieldOverride` on `recipe_components` table, nullable real 0-100) that supersedes the inventory item's default yield percentage. This enables more accurate costing when the same ingredient has different waste factors in different preparations. A badge displays next to ingredients with custom yields.
- Number Input Fields: All number input fields throughout the application have spinner controls (up/down arrows) removed.
- Recipe Name Capitalization: Recipe names are automatically displayed with the first letter capitalized in all UI presentations while preserving the original database values.
- User Accountability Tracking: All key actions (receipts completion, transfer creation/execution/receiving, waste logging) track the user who performed them. Dates display tooltips showing "Action by Username" on hover.
- Case Price Entry: Vendor items use case price as the primary entry field (matches vendor invoices). Unit price is automatically calculated: `unitPrice = casePrice ÷ (caseSize × innerPackSize)`. The `lastCasePrice` field stores the entered case price, while `lastPrice` stores the derived unit price. Unit prices display with 4 decimal precision.
- Password Show/Hide Toggle: All password input fields have Eye/EyeOff toggle buttons for visibility control.
- Two-Stage Signup Flow: Lead capture (/signup) → Account activation (/activate) → Dashboard (/). Email auto-fills on activation page. No duplicate data entry between stages. No intermediate success screen.
- Setup Milestone Tracker: Dashboard shows a "Getting Started" checklist (Store, Categories, Vendors, Inventory, Recipes, Menu) with dismiss/undismiss capability. Auto-hides when all milestones complete. Expanded by default on login, collapsible during session (session-only state), re-expands on next login. Shows X/Y progress count and encouragement message. Store creation is inline within the tracker (no separate onboarding page). Default store name is "%companyName%'s Store". Store form auto-expands on initial load when store hasn't been created yet.
- Onboarding API Endpoints: POST /api/leads/signup (creates inactive account), POST /api/leads/activate (sets password, activates), POST /api/onboarding/store (creates first store), GET /api/onboarding/milestones (milestone status), POST /api/onboarding/milestones/dismiss, POST /api/onboarding/milestones/undismiss.
- Setup Progress Banner: `SetupProgressBanner` component (`client/src/components/setup-progress-banner.tsx`) is a fixed bottom bar shown on milestone-related pages (categories, vendors, inventory-items, recipes, menu-items). Shows "Step X of Y" while working, then "Done! → Next: ..." with a Continue button after completing the current milestone. Skip button on the bottom right (no Dashboard button). Top-right Skip buttons removed from milestone pages — only Continue remains at top right. Pages include `pb-16` for content clearance.
- Header Navigation: Compact header with Logo (links to dashboard) | Store Selector | spacer | Hamburger menu (main nav dropdown) | Gear icon (settings dropdown with Locations submenu) | Avatar circle (account dropdown with theme toggle and logout). No separate Home/Dashboard icon in header. Mobile uses Sheet slide-out for main nav.

# System Architecture

- **Frontend**: Mobile-first React 18 SPA with TypeScript, Vite, `shadcn/ui` (Radix UI, Tailwind CSS), TanStack Query, React Context, and Wouter for routing.
- **Backend**: Node.js (TypeScript) with Express.js and Zod for data validation.
- **Database**: PostgreSQL with Drizzle ORM.
- **Application Structure**: Multi-tenant Single Page Application (SPA) with strict data isolation.
- **UI/UX Decisions**: Mobile-first design; intuitive recipe creation; dynamic dashboards with filterable tables; consistent, color-coded status badges; conditional UI rendering based on data availability; smooth scrolling; and optimized inventory count layouts.
- **Technical Implementations**: Micro-unit precision for all inventory calculations, comprehensive unit conversion system, multi-level nested recipe costing, dual inventory pricing (Last Cost & Weighted Average Cost), robust multi-tenant QuickBooks integration, intelligent vendor order guide import, real-time recipe cost calculation with caching, dynamic estimated on-hand inventory with automated cache invalidation, detailed TFC (Theoretical Food Cost) variance reporting, and single-timezone date handling for data consistency.
- **System Design Choices**: Adherence to strict multi-tenancy principles, secure OAuth using HMAC-SHA256, extensive server-side validation, and robust vendor relationship management features.
- **Vendor-Store Assignment Model**: Vendors are company-level entities with shared credentials, but a `store_vendors` join table controls which stores can access each vendor. Order guides can be assigned to multiple stores via an `order_guide_stores` join table. Order guide approval accepts a `targetStoreIds` array to create inventory items for all selected stores simultaneously.
- **Subscription Tier System**: Three-tier model (Free < Basic < Pro) stored as `subscriptionTier` on the `companies` table. Tier configuration in `shared/tier-config.ts` defines hierarchy and feature mapping. Backend gating uses `requireTier(minTier)` middleware, while frontend gating uses `useTier()` hook and `TierGate` component.
- **Marketing Website**: Hostname-based routing (`fnbcostpro.com` for marketing, `app.fnbcostpro.com` for the app) handled by the same Express server. Marketing pages (`/`, `/features`, `/pricing`, `/about`, `/contact`) are self-contained. Pricing page fetches live Stripe plans. Contact form sends emails via SMTP2GO. Homepage hero uses a background image gallery.

# External Dependencies

- **Database Services**: Neon serverless PostgreSQL.
- **Real-time Communication**: `ws` library (WebSockets).
- **Image Processing**: Sharp library.
- **Object Storage**: Dual-mode (Replit native or local filesystem) with company-isolated directories.
- **Vendor Integrations**: Custom adapters for Sysco, GFS, and US Foods order guides.
- **QuickBooks Online Integration**: `intuit-oauth` package for OAuth 2.0.
- **Stripe Integration**: Subscription billing using Stripe Checkout + Webhooks.
- **Email Service**: SMTP2GO (for contact form).
- **Background Image System**: Unsplash (images seeded from).