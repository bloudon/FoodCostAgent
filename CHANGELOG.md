# Changelog

All notable changes to FNB Cost Pro are documented here.

## [1.14.5] — 2026-08-02

### Sales import

- **Relabeled Sales by Item importer** — UI and parser were mislabeled as "Northstar / Jones Lang LaSalle"; corrected to "Jonas Encore" which is the actual POS system the report format originates from

---

## [1.14.4] — 2026-08-02

### Marketing site

- **Privacy Policy and Terms of Service pages** — `/privacy` and `/terms` (and `/es/privacy`, `/es/terms`) now render real content pages inside the marketing layout instead of 404ing
- **Footer links fixed** — Privacy Policy and Terms of Service were `<span>` elements that looked like links but did nothing; both are now proper `<Link>` elements pointing to their respective pages
- **Removed Northstar POS callout from Orderly import** — the "seed outlet locations & menu items" card was hardcoded for Northstar/JLL accounts and shown to all users after every Orderly import; removed until a POS-type-gated version is built

---

## [1.14.3] — 2026-08-02

### Mobile

- **Fix: recipe detail pages no longer 404 in the app** — `/recipes/:id`, `/recipes/:id/edit`, and `/recipes/new` were missing from the embedded router whitelist. All three are now registered so tapping into a recipe from the list opens the detail view correctly.

---

## [1.14.2] — 2026-08-02

### Mobile

- **Unblocked Quick Access tiles** — `/inventory-items`, `/recipes`, `/shelf-scans`, `/tfc/variance`, `/stores`, and `/waste` are now registered in the embedded (`mobileToken`) router. All six Quick Access tiles on the mobile dashboard open their pages inside the app instead of rendering a 404. `/inventory-items/:id` is also included so tapping into item detail works without dropping back to NotFound.

---

## [1.14.1] — 2026-08-02

### Waste

- **Fix: menu items without a linked recipe can now be logged as waste** — previously the server returned "Menu item or recipe not found" for any menu item that existed but had no recipe attached. Waste is now accepted with a `$0` value for unlinked items instead of blocking the submission.

---

## [1.14.0] — 2026-08-02

### Waste

- **Voice waste entry** — kitchen staff can record spoken waste events directly from the Waste page. A mic button opens a recording modal (idle → recording → transcribing → resolving → results). Audio is transcribed via Whisper, structured entries extracted with GPT-4o, then resolved against the live inventory and menu catalog using weighted fuzzy matching (exact / prefix / substring / Levenshtein). Each entry gets a resolution status: *resolved*, *ambiguous*, *needs\_unit*, or *unresolved*. Tapping "Load into form" prefills the waste wizard to the appropriate step.
- **Voice draft queue** — after loading entries from the modal a persistent banner above the wizard tracks all voice drafts. Each chip shows item name, qty, and resolution status; "Load" prefills the next draft while "×" skips it. The queue survives React Query invalidations and persists until all entries are submitted or dismissed.
- **Unit-safe prefill** — when the spoken unit differs from the item's canonical unit (e.g. "cases" for an item tracked in lbs) the quantity field is cleared and an inline warning prompts the user to re-enter in the correct unit, preventing silently wrong waste quantities.
- **`POST /api/waste/interpret`** — new endpoint accepting either `multipart/form-data` (audio, 10 MB max) or `application/json` (pre-transcribed text). Returns structured, store-verified waste entries with candidates, match scores, and unit metadata. Accessible to mobile API consumers.

---

## [1.13.0] — 2026-08-02

### Admin Dashboard

- **QuickBooks in stats row** — QB connection count moved into the top stats row as a single "QB Connected" card. Clicking opens a full-detail modal (app credentials + per-company connection status). The old two-card layout is retired.
- **Admin dashboard layout pass 2** — search input left-aligned alongside the "All Companies" heading (matches the admin-users pattern); mobile user count folded into the Users stat card as a second subtitle line; AI Chat Logs card expanded to full width with an always-visible 3-question preview; "View all history" expands the full log inline.
- **Company tier filter** — admins can filter the company list by plan tier (Platform / Enterprise / etc.) to quickly view all accounts on a given plan.

### Data Import

- **Orderly import write fix** — approval-time upsert now correctly populates `store_inventory_items`. Store is resolved and bound at upload time (`targetStoreId` on the batch); legacy batches with a null `targetStoreId` now persist the correct store before calling the domain service, preventing a "multiple stores" error for scoped multi-store users.

### Item Catalog

- **Duplicate-item finder and merge tool** — new catalog tool surfaces items that share a name, barcode, or vendor code. Managers can review flagged pairs side-by-side and merge them: recipe links, order guide entries, and transaction history are re-pointed to the surviving item before the duplicate is removed.

### Reports

- **Scheduled reporting hub** — new Reports section (manager+ roles) with a landing hub, a `ReportViewer` for on-demand runs, and a `ScheduledReportsPage` for managing subscriptions. Three report types ship at launch: **Recipe Cost** (ingredient cost per portion across all recipes), **Inventory Value** (on-hand quantity × unit cost by store and category), and **Purchase Activity** (completed receipts aggregated by PO). All reports export to `.xlsx`.
- **Email delivery** — scheduled subscriptions deliver reports as `.xlsx` attachments via the existing SMTP2GO transport. Recipient lists, cadence (daily/weekly/monthly), and store scope are configurable per subscription. The scheduler runs on startup with catch-up logic and hot-reloads after any CRUD write.
- **Store-scope enforcement** — `store_manager` users can only create subscriptions and run reports for their assigned locations. Accessible store IDs are persisted in the subscription record so the scheduler enforces scope at execution time without a live user session.
- **Run-now button** — managers can trigger any scheduled subscription to send immediately from the `ScheduledReportsPage` without waiting for the next scheduled run. A delivery confirmation toast confirms the send completed.
- **Email misconfiguration guard** — report delivery now validates the SMTP transport is reachable before attempting to send. Misconfigured or unreachable mail service surfaces a clear error in the subscription run log instead of silently dropping recipients.

---

## [1.12.1] — 2026-08-01

### Billing & Account

- **Account & Locations overview** — `/choose-plan` replaced with a purpose-built account dashboard. Active subscribers see plan name, live status badge (Trial · N days left / Active / Past Due), billing interval, renewal date, licensed vs. active location count, and a full capabilities checklist. New users see the 14-day Opportunity Review trial signup with monthly/annual toggle. Fetch failures surface a blocking error instead of silently showing a checkout form to existing subscribers.
- **`GET /api/billing/subscription`** — new endpoint returning plan, subscription status, billing interval, current-period-end, licensed location count, and active location count (inactive and closed stores excluded from the count).
- **Plan catalog** (`shared/plan-catalog.ts`) — single source of truth for `PLAN_CATALOG`, `ADDITIONAL_LOCATION_PRICING`, `CORE_PLATFORM_CAPABILITIES`, `MULTI_LOCATION_CAPABILITIES`, `ENTERPRISE_CAPABILITIES`, `getOperatingMode`, `PRICING`, and `MARKETING_PRICING`. Retires the legacy basic/pro tier keys.
- **Stripe billing alignment** — checkout sessions and webhook handling updated to the platform + additional-location seat model.
- **Feature gate refactor** — all entitlement checks now driven by plan-catalog operating mode rather than raw tier strings.

### Recipe Builder

- **Compact metadata layout** — photo thumbnail (80 × 80 px) sits inline with name, yield, and cost in the metadata card so the fold is useful on first load. Yield accordion is collapsed by default.
- **Click-to-expand photo** — clicking the thumbnail toggles it between 80 px and 240 px in-card; a separate lightbox button still opens the full image. Expanded state persists to `localStorage`.
- **Collapsible ingredient panel** — desktop ingredient list has a collapse toggle; open/closed state is persisted to `localStorage` under `desktopIngredientPanelOpen`.

### Onboarding

- **Get Operational card streamlined** — reduced to 3 required steps (menu scan, storage locations, first invoice). Orderly moved to an optional "Other import options" row so it no longer blocks the checklist for non-Orderly operators.
- **Getting Started milestone** — "Review Your Account" step now links directly to `/choose-plan` (account overview) instead of routing through the guided wizard.

### Security

- **28 Replit proxy URLs scrubbed from `package-lock.json`** — removed internal CDN references that were leaking into the lockfile.

---

## [1.12.0] — 2026-07-30

### Search & Analytics

- **Global search** — unified search across 10 entity types (inventory items, recipes, menu items, vendors, purchase orders, waste logs, categories, storage locations, staff, and count sessions). Keyboard shortcut `⌘K` / `Ctrl+K` opens the command palette from anywhere in the app.
- **GA4 analytics integration** — page views and key user actions tracked via Google Analytics 4 for product insight.

### Internationalisation

- **Spanish translations** — full UI translation for navigation, onboarding wizard, marketing pages (Platform, About, Industries), and all new-page copy. Language toggle (EN / ES) in the top nav.

### Import & Data

- **Orderly snapshot → count session import** (Task #679) — paste an Orderly inventory snapshot export and the app creates a matching count session with quantities pre-filled, preserving item names and storage location mapping.
- **Vendor pack geometry normalisation** (Task #724) — 7 new columns on `vendor_items` (`canonical_qty_per_purchase_unit`, `normalized_price_per_canonical_unit`, `pack_geometry_status`, `pack_geometry_source`, `pack_geometry_updated_at`, `pricing_basis`, `is_variable_weight`) to standardise how mixed-unit distributor packs are costed.

---

## [1.11.0] — 2026-07-24

### Dashboard & Alerts

- **Operating console layout** — home dashboard rebuilt as a two-column console: left column surfaces exceptions (overdue orders, cost warnings), right column shows flow (recent activity, upcoming orders).
- **Overdue purchase order alerts** — any PO past its expected delivery date now surfaces automatically on the web dashboard so nothing slips through unnoticed.
- **Stale vendor price warnings** — flags items with no price refresh in 90+ days, helping catch pricing drift before it hits food cost. Distinct from the 14-day cross-shopping eligibility threshold (M3 purchasing rules).
- **Mobile overdue PO alerts** — same overdue-order alerts extended to the Expo mobile app, with tap-through to full order detail.

### Navigation & Routing

- **Route consolidation** — `/purchase-orders` (list) redirects to the canonical `/orders` page; `/inventory-count` redirects to `/count` landing hub. Legacy paths still resolve cleanly without breaking browser Back.
- **Terminology** — count sessions list heading updated to "Counts"; waste log heading updated to "Waste".
- **Order landing tabs** — consolidated duplicate "Build Order" and "Purchase Orders" tabs into a single "Orders" tab.
- **Centralized route config** — new `client/src/lib/route-config.ts` defines every canonical route with section, label, role requirements, and legacy redirect mappings as a single source of truth.

### Price Threshold Clarity

- **`PRICE_MAINTENANCE_ALERT_DAYS = 90`** — dashboard cleanup warning constant, named explicitly to prevent consolidation with cross-shopping rules.
- **`CROSS_SHOP_PRICE_STALE_DAYS = 14`** — M3 purchasing eligibility threshold, now a named export in `vendorPriceService.ts` alongside `CROSS_SHOP_PRICE_CURRENT_DAYS = 7`.

---

## [1.10.0] — 2026-07-10

### Procurement Connector Framework — PFS & SOFO

Adds two new vendor CSV connectors and closes a correctness bug in batch pricing queries.

- **Performance Food Service (PFS) connector** — auto-detected when a PFS order guide CSV is uploaded. Maps PFS column headers (`ITEM NUMBER`, `BRAND`, `DESCRIPTION`, `PACK`, `PRICE`) to the internal product model. Handles PFS-style pack strings (e.g. "6/5 LB", "CS/24 EA") and extracts case size, inner pack, and UOM correctly.
- **SOFO connector** — auto-detected for Southern Foods order guides. Maps SOFO column headers and pack formats with the same precision as PFS.
- **`detectConnectorFromVendorName` updated** — both connectors are now returned when the vendor name contains "Performance Food", "PFS", "Southern Foods", or "SOFO", so the correct parser is selected automatically without any manual configuration.
- **Bug fix: batch case-price query** — `getVendorCasePricesBatch` was passing a JavaScript array directly to a Drizzle `ANY()` call, which Drizzle serialises as a PostgreSQL record type rather than an array literal. Rewrote using an `IN (...)` clause built with `sql.join` so the query executes correctly when loading case prices for a set of inventory items.
- **15 new unit tests** — cover PFS and SOFO column detection, pack-string parsing, price extraction, and `detectConnectorFromVendorName` routing for both connectors (597 total passing).

---

## [1.9.0] — 2026-05-28

### Pack-Size Accuracy — Name-Count Hint System

A new detection layer catches cases where the count embedded in a vendor's product name (e.g. "Cheesecake Strawberry Swirl **16 Slices**") disagrees with the pack-size column in the order guide CSV (e.g. "80 EA"). Left uncorrected these mismatches produce a unit price that is off by a factor of 5 or more.

- **Amber inline hint on the review screen** — when a product name contains a recognisable count that differs from the CSV case-size, an amber "Name says 16 — use that?" link appears in the Unit Price column. One click re-calculates the displayed unit price and flags that count for storage at commit time. The fix is written to the vendor item's `caseSize` field so every downstream cost calculation is correct from the moment of import.
- **Extended pattern recognition** — the count extractor understands weight suffixes (oz, lb, g, fl oz), count words (slices, CT, count, pcs, pks, pieces, portions, servings), and "Box/Pack/Bag/Tray of N" phrasings in addition to plain numbers.
- **Suspicious ratio banner** — when the name-count and the CSV case-size differ by more than 5×, an amber banner appears at the top of each review tab (Matched / Needs Review / New Items) showing how many rows are flagged. Clicking the banner scrolls to and briefly highlights the first offending row, mirroring the existing pack-size change banner UX.
- **Dismiss per hint** — reviewers can dismiss individual hints they've already checked (e.g. "yes, 80 EA is correct here"). Dismissed hints are remembered for the session so they don't reappear on page refresh.
- **Manual count input** — a small hash-icon button in the Unit Price column (on ambiguous and new rows) reveals a compact numeric field. Reviewers can type any count to override the CSV value, even when the product name contains no hint. Changing the value live-recalculates the price; clearing it reverts to the CSV default.
- **Pack-size warning badge on the vendor list** — vendors with a pending order guide containing suspicious pack-size ratios now show an amber "N warning(s)" badge in the Order Guide column. Clicking navigates directly to the review page.
- **Post-import summary email** — after a guide is committed, the approving user receives an email listing any rows where the name-embedded count differed from the CSV pack-size by more than 5×, so the data quality issue is flagged even if the reviewer missed it during import.

### Test Infrastructure

- 60 new unit tests covering `extractNameCount()` (all keyword families, edge cases, null inputs) and `hasNameCountSuspiciousRatio()`.
- 22 new Playwright browser tests covering banner visibility, row markers, dismissal behaviour, and all three review tabs.
- Playwright test suite now runs with Firefox in the Replit dev environment (avoids Chromium SIGSEGV) and with up to 4 parallel workers locally, cutting local wall-clock time from ~7 minutes to under 2 minutes. CI behaviour is unchanged.
- Shared `mockReviewPageShell` helper consolidated into `tests/test-helpers.ts` — no more copy-pasted setup between spec files.

---

## [1.8.0] — 2026-05-27

### Order Guide & Pricing Accuracy

- **Unit-aware case price math** — order guide import now correctly derives the per-unit cost based on each item's inventory unit. "Each" items (pretzels, portions) divide by outer count only; weight-based items convert oz packs to lbs before dividing. Fixes cases where a 12-count pretzel case at $40.53 was being priced at $0.34/oz instead of $3.38/ea.
- **Unit override selector on the review screen** — new and ambiguous rows now include a compact unit selector (Auto / ea / lb / oz / gal / qt / liter / fl oz) directly in the Unit Price column. Changing it live-recalculates the price and the selected unit is applied when the import is committed.
- **Case price column corrected** — the old "Est. Case Price" column (which incorrectly multiplied price × caseSize × innerPack) is replaced with a "Case Price" column showing the raw CSV price and a "Unit Price" column showing the correctly derived per-unit cost with an amber flag when the value looks unusual.
- **Vendor detail page** — unit price column now shows the inventory base unit label (e.g. "$3.3775 / ea") instead of the purchase unit name ("/ Case"), and uses 4-decimal precision to match the import review screen.
- **Receipt entry** — applying a receipt now uses the same `deriveUnitPrice` logic as the order guide processor, so each-based and weight-based items get the correct unit price written back to their vendor item record.
- **Manual vendor item form** — the unit price preview shown while adding or editing a vendor item now includes the inventory item's base unit label so it matches what's displayed after saving.

---

## [1.7.0] — 2026-05-24

### Vendor & Order Guide Importing
- Compound pack-size strings parsed correctly — "6/5 LB" now stores case qty (6) and inner-pack size (5) as separate fields instead of merging them, so unit price math is accurate.
- EA portioning auto-derivation — when a vendor CSV has both a count column (EA/each/unit) and a weight column (LB), the system automatically calculates per-each weight and seeds it as a Recipe Unit on the inventory item. No manual entry required.
- Admin backfill tool (`POST /api/admin/backfill-vendor-pack-sizes`) repairs any existing vendor items that were imported with merged pack sizes before this fix.
- Per-each weight is now visible and editable on the vendor item detail panel.

### QuickBooks Integration
- OAuth Connect / Disconnect moved back to **Settings → Integrations** where each company manages their own connection.
- Global Admin (`/companies`) gains a **QB App Configuration** card showing whether the platform-level `QUICKBOOKS_CLIENT_ID` and `QUICKBOOKS_CLIENT_SECRET` credentials are set, and which environment (sandbox / production) is active.
- QuickBooks integration is now a **Pro plan feature**. Starter plan users see an upgrade prompt in Settings → Integrations instead of the connection UI.

---

## [1.6.0] — 2025-05-23

### Menu Item Variant Costing
- Prep-style links on menu items — attach one or more recipes per menu item with a custom label (e.g. "Bone-In", "Boneless"), each showing recipe cost and gross margin percentage color-coded green/amber/red.
- Size variant parent/child linking — menu items with the same dish name at different sizes (Small / Medium / Large) can be linked as a variant group in one click from Menu Insights.
- Menu scan wizard now automatically groups size variants on import and lets operators confirm or opt out of each group before finalizing.
- Variant group preferences (checked/unchecked) persist across browser refreshes mid-import.
- Recipe builder gains a "Preparation Style Label" field so each recipe can identify its serving format.

### Versioning & What's New
- Formal x.x.x version scheme starting at 1.6.0.
- "What's New" panel accessible from the version label in the footer.
- Update banner shown to users after each new release — dismissed per-user and remembered server-side.

---

## [1.5.0] — 2025-04-01

### Inventory & Counting
- Sub-entry count history per count line — each tap of "+" is stored discretely. Lines with multiple entries show a collapsible count history inline.
- Storage-location sort order respected in count entry display.
- "Clear all entries" action per count line.
- Location cost totals exportable to spreadsheet.

### Recipe Builder
- Per-ingredient yield override — set a custom waste factor for an ingredient without changing its global yield, stored per recipe component.
- Nested recipe costing: recipes marked "Can be ingredient" calculate cost through all dependency levels automatically.
- Recipe cost recalculates across all affected recipes when an ingredient price changes.
- Recipe instructions can be extracted from a photo via AI (Basic plan and above).

### Prep Chart
- Prep items can be linked to a recipe; the recipe's components appear as inherited ingredients.
- Pull List view aggregates all required ingredients across all chart lines.

### Menu
- Managed menu departments with drag-to-reorder, inline rename, and add/delete.
- Department filter dropdown on the menu items page.
- Menu item hierarchy view groups items under their section header.

### Vendors & Receiving
- Case price as primary entry field — unit price auto-calculated from case size.
- Vendor-level "Receive by unit" flag for misc/grocery-style vendors.
- Receipt-level receive-by-unit override.

### General
- Onboarding menu scan wizard: 4-step guided first-run experience (menu photo → store name → recipe approval → location count).
- Location count tile picker routes to correct plan recommendation at choose-plan.
- Setup milestone tracker on dashboard with inline store creation and progress encouragement.
- Password show/hide toggle on all password fields.
- User accountability tracking on receipts, transfers, and waste logs (hover tooltip shows "Action by Username").
- AI chat corrections system — global admins author ideal answers that are injected as few-shot examples.
