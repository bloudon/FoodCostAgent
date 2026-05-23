# Changelog

All notable changes to FNB Cost Pro are documented here.

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
