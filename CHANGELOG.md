# Changelog

All notable changes to FNB Cost Pro are documented here.

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
