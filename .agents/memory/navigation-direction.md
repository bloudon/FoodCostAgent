---
name: Approved navigation direction
description: PM-approved primary navigation and settings information architecture after the navigation audit
---

Preserve the current icon-only rail, hover labels, and direct-click landing-page behavior. The primary destinations are Home, Inventory, Order, Prep, Menus, Analyze, Waste, and Settings. Reports is not a separate rail destination; report routes remain functional and discoverable through Analyze. Recipes remain under Menus, and Vendors remain under Order.

Settings replaces More and is a structured setup/administration landing page, grouped by Inventory Setup, Locations, Team, Integrations, Company, and Global-admin-only Platform Administration. Show only items allowed by existing permissions; route metadata must not replace authorization.

**Why:** The PM approved the smallest navigation correction supported by the audit, explicitly rejecting a rail interaction redesign, new top-level domains, mobile navigation redesign, and unrelated page redesigns.

**How to apply:** When changing navigation, preserve the interaction model and mobile model. Reconcile `/inventory-count`, align route metadata for labels/breadcrumbs/active ownership/search/discoverability/grouping, and resolve the Store Locations Manager+ versus Admin+ mismatch or return it as a specific PM decision rather than choosing silently.