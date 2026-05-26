# FNB Cost Pro — Feature Specifications

Detailed reference for specific features and modules. For project overview, architecture, and global coding conventions see `replit.md` and `STANDARDS.md`.

---

## Inventory & Counting

**Count Entry Sub-History**: `inventoryCountEntries` table tracks discrete count additions per line (id, inventoryCountLineId, qty, userId, enteredAt). POST creates the first entry; PATCH with `accumulate: true` appends a new entry (used by the "+" button); direct PATCH replaces entries. `GET /api/inventory-count-lines/:countId` furnishes each line with `entries[]` (qty, enteredAt, userName). UI shows collapsible "Count history" inline on any card that has more than one entry.

---

## Categories

**Soft-Delete Protection**: Categories use soft-delete only (`isActive` column, integer 0/1). `DELETE` endpoint sets `isActive=0`; `POST /api/categories/:id/restore` reactivates. `GET /api/categories` returns only active; `?includeInactive=true` returns all. Database-level FK constraint (`inventory_items_category_id_fk`) with `ON DELETE SET NULL` prevents orphaned items if a hard delete ever reaches the DB. Default category set is 18 food-focused categories: Produce, Dairy, Proteins, Seafood, Cheese, Bread & Dough, Dry Goods & Pantry, Frozen, Oils & Condiments, Spices & Seasonings, Herbs & Garnish, Beer, Wine, Spirits & Liquor, Non-Alcoholic Beverages, Desserts & Pastry, Cleaning & Supplies, Paper & Smallwares. Item count shown as a badge on each category. Inactive categories collapsible section at bottom of page.

**Recipe Builder Filtering**: Categories include a `showAsIngredient` field (0/1 in DB) controlling whether items in that category appear in the recipe builder's ingredient selector.

**Onboarding Categories Step**: Shows a 2-column checkbox grid (all pre-checked) for the full food category list; categories already in DB show an "Added" badge; invoice-scan-created categories that aren't in the suggested list appear below for renaming; custom add field at bottom.

---

## Recipes

**Can Be Ingredient**: Recipes include a `canBeIngredient` checkbox field (0/1 in DB) to mark if they can be used as ingredients in other recipes.

**Cost Calculation**: Ingredient prices must be converted to base unit prices before multiplication.

**Company Isolation**: Comprehensive company-level isolation for recipes and recipe components.

**Cost Recalculation on Price Changes**: Automatically recalculate all affected recipes when an inventory item's price changes, including nested recipes, in dependency order.

**Yield Override**: Recipe ingredients can have a per-recipe yield override (`yieldOverride` on `recipe_components` table, nullable real 0–100) that supersedes the inventory item's default yield. Enables more accurate costing when the same ingredient has different waste factors in different preparations. A badge displays next to ingredients with custom yields.

**Missing Item Name**: `recipe_components` table has a `missingItemName` (text, nullable) column. Used by the recipe scan wizard to persist unmatched-but-included ingredients as placeholder components (with a random UUID as `componentId` that won't exist in inventory). `GET /api/recipe-components` returns these as `missingItem: true` with the stored name as display label. The `/api/recipes/missing-ingredients` endpoint uses this name in its response.

**Instructions & Photo**: `recipes` table has `instructions` (text, nullable) and `imagePath` (text, nullable, maps to `image_path`). Recipe builder shows a collapsible "Preparation Instructions" card (Accordion) with a Textarea and "Scan from Photo" button (gated at Basic/ai_assistant tier) that calls `POST /api/recipes/extract-instructions` with an objectPath to extract steps via GPT-4o Vision. A "Recipe Photo" card shows an ObjectUploader (or thumbnail + remove button). Both saved via the main Save Recipe button; photo changes also immediately PATCH via `/api/recipes/:id`.

---

## Prep Chart

**Recipe Linkage & Pull List**: When a prep item is linked to a `canBeIngredient` recipe, the recipe's components show as read-only inherited ingredients in the Prep Item Builder. The Prep Chart generate endpoint enriches each chart line with `requiredIngredients` (ingredient qty × recommendedBatches, sourced from the linked recipe's components or the prep item's own ingredients). The Prep Chart UI shows a "Requires" column per line and a "Pull List" toggle view that aggregates all required ingredients across all chart lines, grouped by ingredient.

---

## Vendor Order Guides

**Pack Size Format**: Vendor items display pack size as a combined "outer × inner unit" column (e.g. "6 × 5 lb") on the vendor detail page and the order guide import review screen. `caseSize` = outer count; `innerPackSize` = inner units per pack; UOM comes from the linked purchase unit. Falls back gracefully when only one dimension is present.

**Pack Size Mismatch Warning**: On the order guide import review screen, lines where the imported pack size differs from the same vendor's previously recorded pack size show an amber warning icon with a tooltip ("Pack size changed — was X, now Y"). Comparison is dimension-by-dimension (not total units). A summary banner at the top of each tab counts total mismatches and scrolls to the first flagged row when clicked. Only compares against the same vendor's prior record — no cross-vendor false positives.

**CSV Adapter Support**: Custom adapters for Sysco, GFS, and US Foods. Compound pack sizes (e.g. "6/5 LB") are parsed into `caseSize` + `innerPackSize`. EA portioning is auto-derived for weight-based units (LB, OZ, KG, G). Per-each weight is visible and editable on the inventory item detail page.

---

## Onboarding & Signup

**Self-Service Flow**:
1. `/signup` (`client/src/pages/lead-signup.tsx`) — collects first name, last name, email, phone, company name, zip code → `POST /api/leads/signup`
2. `/activate` (`client/src/pages/activate-account.tsx`) — enter 6-digit OTP then set password → `POST /api/leads/activate` → redirects to `/onboarding/setup`
3. `/onboarding/setup` (`client/src/pages/onboarding-setup.tsx`) — 9-step guided wizard (see below)

The legacy admin-only wizard at `/onboarding-wizard` is restricted to global admins only (accessible via Admin Dashboard "Launch Onboarding Wizard" button).

**Onboarding Setup Wizard** (`/onboarding/setup`): Nine steps with a progress stepper:
1. Menu — upload a menu photo, GPT-4o Vision extracts recipe names; skip available
2. Plan — tier selection (Starter / Pro / Enterprise)
3. Store — set store name and details
4. Storage — configure storage locations
5. Invoice — optional invoice scan to seed inventory items
6. Categories — review and confirm food categories
7. Recipes — review AI-extracted recipes from menu scan
8. Review — summary before going live
9. Count #1 — optional first inventory count

Wizard state persists in localStorage per company (`onboarding_wizard_<companyId>`). Each step advance posts a milestone update to `POST /api/onboarding/milestones/review-step`.

**Admin Wizard** (`/onboarding-wizard`): Global admin only — non-admins are redirected to `/`. Four steps: Account → Verify Email → Company → Store (repeats per location count) → navigates to `/choose-plan?welcome=true`. Used to manually onboard a new company on behalf of a client.

**Choose-Plan Location Recommendation**: When a user arrives at `/choose-plan` with `?locations=2` or higher, a callout banner appears above the tier cards recommending the Pro plan. The Pro card's banner label switches from "Most Popular" to "Recommended for You". The Basic plan remains fully selectable — soft recommendation only.

**API Endpoints**: `POST /api/leads/signup` (creates inactive account), `POST /api/leads/activate` (sets password, activates), `POST /api/onboarding/store` (creates first store), `GET /api/onboarding/milestones`, `POST /api/onboarding/milestones/dismiss`, `POST /api/onboarding/milestones/undismiss`, `POST /api/onboarding/milestones/review-step`.

---

## Setup & Milestone Tracking

**Setup Milestone Tracker**: Dashboard shows a "Getting Started" checklist (Store, Categories, Vendors, Inventory, Recipes, Menu) with dismiss/undismiss capability. Auto-hides when all milestones complete. Expanded by default on login, collapsible during session (session-only state), re-expands on next login. Shows X/Y progress count and encouragement message. Store creation is inline within the tracker. Default store name is "%companyName%'s Store". Store form auto-expands on initial load when store hasn't been created yet.

**Setup Progress Banner**: `SetupProgressBanner` component (`client/src/components/setup-progress-banner.tsx`) — a fixed bottom bar shown on milestone-related pages (categories, vendors, inventory-items, recipes, menu-items). Shows "Step X of Y" while working, then "Done! → Next: ..." with a Continue button after completing the current milestone. Skip button on the bottom right. Pages include `pb-16` for content clearance.

---

## Navigation & Layout

**Header**: Compact header with Logo (links to dashboard) | Store Selector | spacer | Hamburger menu (main nav dropdown) | Gear icon (settings dropdown with Locations submenu) | Avatar circle (account dropdown with theme toggle and logout). No separate Home/Dashboard icon in header. Mobile uses Sheet slide-out for main nav.

---

## Admin Dashboard (`/companies`)

Global admins see:
- Live stats row (total companies, pending signups, active users, active now — refreshed every 30s)
- Collapsible "Incomplete Signups" panel — accounts created but never activated, with per-row Resend Code and Delete actions
- Collapsible "AI Chat Logs" panel — Q&A pairs with company filter and a corrections sub-section for authoring ideal answers
- Full company list with inline tier management
- "Launch Onboarding Wizard" button → `/onboarding-wizard` (global admin only)
- "New Company" button — creates company directly via dialog

**AI Chat Logging & Corrections**: Every AI assistant exchange logged to `chat_logs` table (companyId, userId, userMessage, assistantResponse, tier). Global admins can add corrections to `chat_corrections` table; toggle/delete them. Active corrections (`is_active=1`) are injected as few-shot examples into the system prompt before every AI chat response. Admin endpoints: `GET /api/admin/chat-logs`, `GET/POST /api/admin/chat-corrections`, `PATCH/DELETE /api/admin/chat-corrections/:id`.

---

## Menu Departments

`menuDepartments` table (id UUID, companyId, name, sortOrder) provides top-level menu sections (Appetizers, Entrees, etc.) per company. `menuItems.menuDepartmentId` nullable FK. Full CRUD at `GET/POST /api/menu-departments`, `PATCH/DELETE /api/menu-departments/:id`, `POST /api/menu-departments/reorder`. "Manage Sections" button on menu-items page opens a dialog with drag-to-reorder, inline rename, delete, and add. Department filter dropdown uses managed dept IDs. Add/edit dialogs use a Select for section assignment. Hierarchy view shows section header rows when departments exist. Legacy `department` text field synced to dept name on save.

---

## QuickBooks Integration

OAuth Connect/Disconnect lives in Settings → Integrations (per-company). Gated at Pro tier (`quickbooks_integration` in tier-config) — Starter users see a Lock icon and upgrade prompt. Global admin (`/companies`) has a QB App Configuration card showing CLIENT_ID/SECRET presence and environment, plus an admin-level Disconnect override per company. Endpoints: `GET /api/quickbooks/connect` (initiates OAuth), `POST /api/quickbooks/disconnect` (company-level), `GET /api/admin/quickbooks/connections`, `POST /api/admin/quickbooks/disconnect/:companyId`, `GET /api/admin/quickbooks/app-status`.
