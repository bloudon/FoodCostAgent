[![Playwright Tests](https://github.com/bloudon/FoodCostAgent/actions/workflows/playwright.yml/badge.svg)](https://github.com/bloudon/FoodCostAgent/actions/workflows/playwright.yml)

# Overview

FNB Cost Pro is an AI-powered inventory management and recipe costing system for food service businesses. Core capabilities: photo-first data entry (menu, recipe, invoice, shelf scans), precise unit conversions, multi-level nested recipe costing, POS sales data integration, and comprehensive variance reporting.

For detailed feature specs by module see **`FEATURE_SPECS.md`**. For technical and architectural standards see **`STANDARDS.md`**.

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

## User Roles (three tiers)
- **Company Admin** — full access, management + floor. DB value: `company_admin`. Note: legacy accounts may have role `owner` in the DB — this is normalized to `company_admin` at the auth middleware layer (`server/auth.ts`) so all permission checks work without modification. Never add `owner` checks elsewhere.
- **Store Manager** — store-level management + floor tasks
- **User** — floor tasks only (counting, scanning, waste)

## Planned Mobile Expansions (not yet built)
- Role-aware `/dashboard/mobile` WebView page (replaces native home screen — Option A)
- Alert system: `alerts` table + `/api/mobile/alerts` + `/alerts/mobile` WebView
- Messaging: `messages` table + `/api/mobile/messages` + `/messages/mobile` WebView
- Expo push token storage: `/api/mobile/push-token` endpoint

---

# Development Standards

See **`STANDARDS.md`** for the full ratified standards. Key rules for quick reference:

- `shared/schema.ts` is the single source of truth for all types.
- `server/routes.ts` must not grow unnecessarily — new routes go in domain-grouped files.
- API responses: `{ data: ... }` on success, `{ error: string }` on failure.
- All AI outputs require confidence metadata. Low-confidence outputs require human review.
- Never silently overwrite operator-entered data.
- Stabilize before refactoring. No heroic rewrites before beta.
- **Every schema change must go in BOTH** `server/index.ts` `runStartupMigrations()` AND `scripts/vps-migrate.sql` — see STANDARDS.md for the full checklist.

---

# User Preferences

- **Communication style**: Simple, everyday language.
- **Default Unit of Measure**: Pound (`lb.`) is the default when creating new inventory items. "Pound" always displays as "lb." in the UI.
- **Yield**: Stored as a percentage value (0–100).
- **Par Level & Reorder Level**: Stored on `inventory_items` as defaults; overridable at the store level via `storeInventoryItems`.
- **Active/Inactive Status**: Dual-level — global (`inventory_items.isActive`) and store-specific (`storeInventoryItems.isActive`).
- **Store Locations**: Inventory items require assignment to at least one store location on creation.
- **Storage Locations**: Inventory items require at least one storage location. Drag-and-drop reordering; inventory counts respect `sortOrder`.
- **Number Input Fields**: Spinner controls (up/down arrows) are removed from ALL number inputs throughout the application.
- **Password Fields**: All password inputs have Eye/EyeOff show/hide toggles.
- **Recipe `canBeIngredient`**: Recipes include a `canBeIngredient` checkbox field (0/1 in DB) to mark if they can be used as ingredients in other recipes.
- **Recipe Name Capitalization**: Recipe names display with first letter capitalized in all UI presentations; original DB values are preserved.
- **User Accountability Tracking**: Receipts, transfers, waste logs, and count applies track the acting user. Dates show "Action by Username" tooltip on hover.
- **Case Price Entry**: Vendor items use case price as primary entry field. Unit price auto-calculates: `unitPrice = casePrice ÷ (caseSize × innerPackSize)`. `lastCasePrice` stores case price; `lastPrice` stores derived unit price. Unit prices display with 4 decimal precision.

---

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

---

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
