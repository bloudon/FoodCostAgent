[![Playwright Tests](https://github.com/bloudon/FoodCostAgent/actions/workflows/playwright.yml/badge.svg)](https://github.com/bloudon/FoodCostAgent/actions/workflows/playwright.yml)

# Overview

FNB Cost Pro is an AI-powered inventory management and recipe costing system for food service businesses. Its core purpose is to boost profitability and operational efficiency by utilizing photo-first data entry (menu, recipe, invoice, shelf scans), precise unit conversions, multi-level nested recipe costing, POS sales data integration, and comprehensive variance reporting. The project aims to reduce waste, optimize profit margins, offer real-time inventory insights, streamline vendor interactions, and establish strong food cost control within the restaurant industry.

---

# ⚠️ CRITICAL ARCHITECTURE — READ FIRST, NEVER FORGET

## Two fully built, active client surfaces — one backend

FnB Cost Pro has **TWO production client applications** sharing one PostgreSQL database and one Express backend:

### 1. Expo Native Mobile App ("Floor Mode")
- **Repo**: https://replit.com/@loudonbrian/Fnb-Cost-Scanner
- **Status**: Fully developed, active, in production. NOT a prototype.
- **Purpose**: Floor-level tasks — inventory counting, shelf scanning, catch-weight, waste logging. Crew and manager tool.
- **Auth**: Token-based. `POST /api/mobile/login` returns session token in JSON body (not cookie). Sessions tagged `source: "mobile"` in `authSessions`.
- **Pattern**: Deliberate hybrid — native React Native screens for hardware/shell, WebViews for management content.

**Native React Native screens** (custom UI, call `/api/mobile/*` directly):
- Login, Settings (auth shell)
- Home / dashboard tab
- Camera (device hardware required)
- Scan results
- Session detail, session items list, individual item view

**WebView screens** (wrap mobile-optimized web app pages, auth via `?mobileToken=` + JS Bearer header patch):
- Inventory sessions list → `https://app.fnbcostpro.com/inventory-sessions?embedded=true`
- Count session → `https://app.fnbcostpro.com/count/[sessionId]/mobile`

**Governing rule**: If a mobile-optimized web route exists → Expo wraps it in a WebView. If not → native screen calling `/api/mobile/*`. New mobile UI features should follow this pattern: build the route here first, Expo wraps it.

### 2. Web SPA — Management Interface
- **URL**: `app.fnbcostpro.com`
- **Purpose**: Office/management tasks — recipe building, TFC variance, vendor orders, QuickBooks, transfers, reports, setup.
- **Auth**: Cookie-based sessions (standard).
- **Stack**: React 18, TypeScript, Vite, shadcn/ui, TanStack Query, Wouter.
- Marketing site at `fnbcostpro.com` (hostname-based routing separates the two).

## Mobile API Contract (`/api/mobile/*`)
All mobile endpoints require Bearer token auth except where noted:
- `POST /api/mobile/login` — token-based login (no auth required)
- `GET  /api/mobile/dashboard` — home screen (businessName, locationName, recentScans)
- `GET  /api/mobile/stores` — store picker for starting a count
- `POST /api/mobile/sweep-scan` — AI shelf scan via GPT-4o Vision (multipart image upload)
- `POST /api/mobile/catch-weight-scan` — barcode + scale weight scan
- `GET  /api/mobile/background-images` — mobile-flagged images (`isMobileAvailable=1`)
- `POST /api/mobile/sessions` — create inventory count session
- `GET  /api/mobile/sessions/active` — active sessions for user
- `GET  /api/mobile/sessions/:id` — session detail
- `GET  /api/mobile/sessions/:id/items` — session items
- `GET  /api/mobile/sessions/:id/inventory` — session inventory
- `PATCH /api/mobile/sessions/:id/inventory/:itemId` — update item count
- `GET  /api/mobile/sessions/:id/lines` — session count lines
- `PATCH /api/mobile/sessions/:id/lines/:lineId` — update a count line
- `POST /api/mobile/sessions/:id/apply` — finalize and apply a count session
- `POST /api/mobile/sessions/:id/apply-scan` — apply AI-identified items from scan

## User Roles (three tiers, used for role-aware mobile dashboard)
- **Company Admin** — full access, management + floor. DB value: `company_admin`. Note: legacy accounts may have role `owner` in the DB — this is normalized to `company_admin` at the auth middleware layer (`server/auth.ts`) so all permission checks work without modification. Never add `owner` checks elsewhere.
- **Store Manager** — store-level management + floor tasks
- **User** — floor tasks only (counting, scanning, waste)

## Planned Mobile Expansions (not yet built)
- Role-aware `/dashboard/mobile` WebView page (replaces native home screen — Option A)
- Alert system: `alerts` table + `/api/mobile/alerts` + `/alerts/mobile` WebView
- @Messaging: `messages` table + `/api/mobile/messages` + `/messages/mobile` WebView
- Expo push token storage: `/api/mobile/push-token` endpoint

---

# Development Standards

See **`STANDARDS.md`** for the full ratified standards. Summary of key points for quick reference:

- Simplicity over configurability. Mobile-first. AI assists, never overrides.
- `shared/schema.ts` is the single source of truth for all types.
- `server/routes.ts` must not grow unnecessarily — new routes go in domain-grouped files.
- API responses: `{ data: ... }` on success, `{ error: string }` on failure.
- All AI outputs require confidence metadata. Low-confidence outputs require human review.
- Never silently overwrite operator-entered data.
- "Sweep scan" and "catch-weight scan" are internal terms — use plain language in UI.
- Stabilize before refactoring. No heroic rewrites before beta.

---

# User Preferences

- Preferred communication style: Simple, everyday language.
- Default Unit of Measure for Inventory Items: Pound should be the default unit when creating new inventory items.
- Unit Abbreviation: "Pound" displays as "lb." throughout the UI.
- Yield Field: Yield is stored as a percentage value (0-100).
- Par Level & Reorder Level: Stored on `inventory_items` table as default values, overrideable at the store level.
- Active/Inactive Status: Dual-level active status (global and store-specific).
- Store Locations: Inventory items require assignment to at least one store location during creation.
- Storage Locations: Inventory items can be associated with multiple storage locations; at least one is required. Storage Locations page features drag-and-drop reordering. Inventory count displays respect storage location sortOrder.
- Recipe `canBeIngredient`: Recipes include a `canBeIngredient` checkbox field (0/1 in DB) to mark if they can be used as ingredients in other recipes.
- Count Entry Sub-History: `inventoryCountEntries` table tracks discrete count additions per line (id, inventoryCountLineId, qty, userId, enteredAt). POST creates the first entry; PATCH with `accumulate: true` appends a new entry (used by "+" button"); direct PATCH replaces entries. GET `/api/inventory-count-lines/:countId` furnishes each line with `entries[]` (qty, enteredAt, userName). UI shows collapsible "Count history" inline on any card that has more than one entry.
- Prep Chart Recipe Linkage & Pull List: When a prep item is linked to a `canBeIngredient` recipe, the recipe's components are shown as read-only inherited ingredients in the Prep Item Builder. The Prep Chart generate endpoint enriches each chart line with `requiredIngredients` (ingredient qty × recommendedBatches, sourced from linked recipe's components or the prep item's own ingredients). The Prep Chart UI shows a "Requires" column per line and a "Pull List" toggle view that aggregates all required ingredients across all chart lines grouped by ingredient.
- Category Filtering in Recipe Builder: Categories include a `showAsIngredient` field (0/1 in DB) controlling whether items in this category appear in the recipe builder's ingredient selection.
- Category Soft-Delete Protection: Categories use soft-delete only (`isActive` column, integer 0/1). `DELETE` endpoint sets `isActive=0`; a `POST /api/categories/:id/restore` endpoint reactivates. `GET /api/categories` returns only active; `?includeInactive=true` returns all. Database-level FK constraint (`inventory_items_category_id_fk`) with `ON DELETE SET NULL` prevents orphaned items if a hard delete ever reaches the DB. Default category set is 18 food-focused categories: Produce, Dairy, Proteins, Seafood, Cheese, Bread & Dough, Dry Goods & Pantry, Frozen, Oils & Condiments, Spices & Seasonings, Herbs & Garnish, Beer, Wine, Spirits & Liquor, Non-Alcoholic Beverages, Desserts & Pastry, Cleaning & Supplies, Paper & Smallwares. Item count shown as a badge on each category. Inactive categories collapsible section at bottom of page. Onboarding Categories step shows a 2-column checkbox grid (all pre-checked) for the full food category list; categories already in DB show an "Added" badge; invoice-scan-created categories that aren't in the suggested list appear below for renaming; custom add field at bottom.
- Recipe Cost Calculation Fix: Ingredient prices must be converted to base unit prices before multiplication.
- Recipe Company Isolation: Implement comprehensive company-level isolation for recipes and recipe components.
- Recipe Cost Recalculation on Inventory Price Changes: Automatically recalculate all affected recipes when an inventory item's price changes, including nested recipes, ensuring recalculation in dependency order.
- Yield Override: Recipe ingredients can have a per-recipe yield override (stored as `yieldOverride` on `recipe_components` table, nullable real 0-100) that supersedes the inventory item's default yield percentage. This enables more accurate costing when the same ingredient has different waste factors in different preparations. A badge displays next to ingredients with custom yields.
- Missing Item Name: `recipe_components` table has a `missingItemName` (text, nullable) column. Used by the recipe scan wizard to persist unmatched-but-included ingredients as placeholder components (with a random UUID as componentId that won't exist in inventory). The GET /api/recipe-components endpoint returns these as `missingItem: true` with the stored name as display label. The `/api/recipes/missing-ingredients` endpoint uses this name in its response.
- Recipe Instructions & Photo: `recipes` table has `instructions` (text, nullable) and `imagePath` (text, nullable, maps to `image_path`). Recipe builder shows a collapsible "Preparation Instructions" card (Accordion) with a Textarea and "Scan from Photo" button (gated at Basic/ai_assistant tier) that calls `POST /api/recipes/extract-instructions` with an objectPath to extract steps via GPT-4o Vision. A "Recipe Photo" card shows an ObjectUploader (or thumbnail + remove button). Both are saved via the main Save Recipe button; photo changes also immediately PATCH via `/api/recipes/:id`.
- Number Input Fields: All number input fields throughout the application have spinner controls (up/down arrows) removed.
- Recipe Name Capitalization: Recipe names are automatically displayed with the first letter capitalized in all UI presentations while preserving the original database values.
- User Accountability Tracking: All key actions (receipts completion, transfer creation/execution/receiving, waste logging) track the user who performed them. Dates display tooltips showing "Action by Username" on hover.
- Case Price Entry: Vendor items use case price as the primary entry field (matches vendor invoices). Unit price is automatically calculated: `unitPrice = casePrice ÷ (caseSize × innerPackSize)`. The `lastCasePrice` field stores the entered case price, while `lastPrice` stores the derived unit price. Unit prices display with 4 decimal precision.
- Password Show/Hide Toggle: All password input fields have Eye/EyeOff toggle buttons for visibility control.
- Signup & Onboarding Flow: New users follow a 3-stage journey. (1) Lead capture at `/signup` (`client/src/pages/lead-signup.tsx`) — collects first name, last name, email, phone, company name, and zip code → `POST /api/leads/signup`. (2) Email verification + password → `/activate` (`client/src/pages/activate-account.tsx`) — enter 6-digit OTP then set password → `POST /api/leads/activate` → redirects to `/onboarding/setup`. (3) Full setup wizard at `/onboarding/setup` (`client/src/pages/onboarding-setup.tsx`) — 9-step guided wizard (see below). The legacy admin-only wizard at `/onboarding-wizard` is restricted to global admins only (accessible via the Admin Dashboard "Launch Onboarding Wizard" button).
- Onboarding Setup Wizard: `client/src/pages/onboarding-setup.tsx` is the primary first-run experience for all new self-service users, reached after account activation. Nine steps with a progress stepper: (1) Menu — upload a menu photo, GPT-4o Vision extracts recipe names; skip available. (2) Plan — tier selection (Starter / Pro / Enterprise). (3) Store — set store name and details. (4) Storage — configure storage locations. (5) Invoice — optional invoice scan to seed inventory items. (6) Categories — review and confirm food categories. (7) Recipes — review AI-extracted recipes from menu scan. (8) Review — summary before going live. (9) Count #1 — optional first inventory count. Wizard state persists in localStorage per company. Each step advance posts a milestone update to `/api/onboarding/milestones/review-step`.
- Choose-Plan Location Recommendation: When a user arrives at `/choose-plan` with `?locations=2` or higher, a callout banner appears above the tier cards explaining that multiple locations require the Pro plan. The Pro card's banner label also switches from "Most Popular" to "Recommended for You". The Basic plan remains fully selectable — this is a soft recommendation only.
- Setup Milestone Tracker: Dashboard shows a "Getting Started" checklist (Store, Categories, Vendors, Inventory, Recipes, Menu) with dismiss/undismiss capability. Auto-hides when all milestones complete. Expanded by default on login, collapsible during session (session-only state), re-expands on next login. Shows X/Y progress count and encouragement message. Store creation is inline within the tracker (no separate onboarding page). Default store name is "%companyName%'s Store". Store form auto-expands on initial load when store hasn't been created yet.
- Onboarding API Endpoints: POST /api/leads/signup (creates inactive account), POST /api/leads/activate (sets password, activates), POST /api/onboarding/store (creates first store), GET /api/onboarding/milestones (milestone status), POST /api/onboarding/milestones/dismiss, POST /api/onboarding/milestones/undismiss.
- Setup Progress Banner: `SetupProgressBanner` component (`client/src/components/setup-progress-banner.tsx`) is a fixed bottom bar shown on milestone-related pages (categories, vendors, inventory-items, recipes, menu-items). Shows "Step X of Y" while working, then "Done! → Next: ..." with a Continue button after completing the current milestone. Skip button on the bottom right (no Dashboard button). Top-right Skip buttons removed from milestone pages — only Continue remains at top right. Pages include `pb-16` for content clearance.
- Header Navigation: Compact header with Logo (links to dashboard) | Store Selector | spacer | Hamburger menu (main nav dropdown) | Gear icon (settings dropdown with Locations submenu) | Avatar circle (account dropdown with theme toggle and logout). No separate Home/Dashboard icon in header. Mobile uses Sheet slide-out for main nav.
- Admin Dashboard (`/companies`): Global admins see a live stats row (total companies, pending signups, active users, active now refreshed every 30s), a collapsible "Incomplete Signups" panel listing accounts created but never activated with per-row Resend Code and Delete actions, a collapsible "AI Chat Logs" panel showing Q&A pairs with company filter and a corrections sub-section for authoring ideal answers, a full company list with inline tier management, and a "Launch Onboarding Wizard" button that opens the legacy admin-only setup wizard for manually onboarding a company.
- AI Chat Logging & Corrections: Every AI assistant exchange is logged to `chat_logs` table (companyId, userId, userMessage, assistantResponse, tier). Global admins can view logs at `/companies` (AI Chat Logs panel), add corrections to `chat_corrections` table, and toggle/delete them. Active corrections (is_active=1) are injected as few-shot examples into the system prompt before every AI chat response. Admin endpoints: GET /api/admin/chat-logs, GET/POST /api/admin/chat-corrections, PATCH/DELETE /api/admin/chat-corrections/:id.
- Managed Menu Departments: `menuDepartments` table (id UUID, companyId, name, sortOrder) provides top-level menu sections (Appetizers, Entrees, etc.) per company. `menuItems.menuDepartmentId` nullable FK. Full CRUD at `GET/POST /api/menu-departments`, `PATCH/DELETE /api/menu-departments/:id`, `POST /api/menu-departments/reorder`. "Manage Sections" button on menu-items page opens a dialog with drag-to-reorder, inline rename, delete, and add. Department filter dropdown uses managed dept IDs. Add/edit dialogs uses a Select for section assignment. Hierarchy view shows section header rows when departments exist. Legacy `department` text field synced to dept name on save.

# ⚠️ PRODUCTION DEPLOYMENT — READ FIRST, NEVER SUGGEST REPLIT DEPLOY

**Production runs on a VPS, NOT Replit.** Never suggest using Replit's built-in deployment/publishing for this project.

- **Production URL**: `app.fnbcostpro.com` — hosted on a VPS managed with **PM2**
- **Deploy process**: SSH into VPS → `git checkout -- package-lock.json && git pull origin main` → `./scripts/deploy-vps.sh` (handles npm install, SQL migrations via `scripts/vps-migrate.sql`, build, npm prune, and pm2 restart automatically). **Never run `npm run db:push` on the VPS** — the deploy script uses the idempotent SQL migration file instead.
- **Replit's role**: Development environment and code editor only. Not a host.
- **Replit Deploy button**: Do not use. Do not suggest. Do not mention unless the user explicitly brings it up.
- The Expo mobile app points to `app.fnbcostpro.com` — any hosting change would require updating the mobile app config too.

---

# System Architecture

- **Web Frontend**: React 18 SPA with TypeScript, Vite, `shadcn/ui` (Radix UI, Tailwind CSS), TanStack Query, React Context, and Wouter for routing. Hostname-based routing separates marketing (`fnbcostpro.com`) from the application (`app.fnbcostpro.com`).
- **Native Mobile**: Expo app (separate repo: https://replit.com/@loudonbrian/Fnb-Cost-Scanner) — fully built, production. Hybrid native + WebView architecture. See CRITICAL ARCHITECTURE section above.
- **Backend**: Node.js (TypeScript) with Express.js and Zod for data validation.
- **Database**: PostgreSQL with Drizzle ORM (Neon serverless).
- **Application Structure**: Multi-tenant SPA with strict company-level data isolation. Same DB serves both web and Expo.
- **Technical Implementations**: Micro-unit precision, comprehensive unit conversion, multi-level nested recipe costing, dual inventory pricing (Last Cost & Weighted Average Cost), multi-tenant QuickBooks integration, intelligent vendor order guide import, real-time recipe cost calculation with caching, dynamic estimated on-hand inventory with automated cache invalidation, detailed Theoretical Food Cost (TFC) variance reporting, and single-timezone date handling.
- **System Design Choices**: Strict multi-tenancy, secure OAuth using HMAC-SHA256, robust vendor relationship management, and a subscription tier system (Starter, Pro, Enterprise). Vendors are managed at the company level, assigned to stores via a join table, and order guides can be assigned to multiple stores.
- **UI/UX Decisions**: Branding utilizes the FNB Cost Pro logo (white "FNB" text with green "cost pro" and bottle icon on black background). Color scheme for header/menu is slate blue grey (`--primary: 215 16% 47%`), and buttons use an orange accent (`--accent-button: 24 93% 50%`, hex `#f2690d`), defined in `client/src/index.css` with dark mode variants.

# External Dependencies

- **Database**: Neon serverless PostgreSQL with Drizzle ORM.
- **Native Mobile App**: Expo (https://replit.com/@loudonbrian/Fnb-Cost-Scanner) — production, hybrid native+WebView.
- **Real-time Communication**: `ws` library (WebSockets).
- **Image Processing**: Sharp library.
- **Object Storage & File Uploads**: Replit native object storage.
- **Vendor Integrations**: Custom adapters for Sysco, GFS, and US Foods order guides.
- **QuickBooks Online Integration**: `intuit-oauth` package for OAuth 2.0.
- **Stripe Integration**: Subscription billing using Stripe Checkout + Webhooks.
- **Email Service**: SMTP2GO.
- **Background Image System**: Unsplash.
- **AI Chat**: OpenAI GPT-4o-mini via `openai` npm package.
- **AI Vision**: GPT-4o Vision (recipe scan, invoice scan, shelf sweep scan, catch-weight scan, instruction extraction).
- **AI CSV Inventory Import**: GPT-4o-mini for column mapping.
