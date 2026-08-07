# FnB Cost Pro Navigation Audit

**Audience:** Product Management, Design, Engineering  
**Scope:** Current web application, Expo mobile companion, embedded web paths, authentication/onboarding, platform administration, legacy redirects, and the public marketing entry points.  
**Purpose:** Provide a complete, source-backed map of the navigation as it exists today and identify consolidation decisions for review. This document does **not** recommend an implementation order or change the product.

---

## 1. Executive summary

The product currently has three overlapping navigation layers:

1. **Web application:** a nine-item primary rail, a large role-sensitive **More** landing page, a global-admin utility header, top-bar utilities, global search, and contextual links inside feature landing pages.
2. **Expo mobile companion:** six persistent tabs, a small native **More** menu, native count/scan flows, and embedded web pages that can continue navigating within the main web application.
3. **Marketing/public shell:** website header, mobile menu, footer, and entry points into login, signup, contact, and the authenticated app.

The recent rail overhaul made the primary experience clearer, but **More now mixes configuration, product areas already available in the rail, platform administration, and mobile substitutes for absent tabs.** Its content also varies materially by role. Several routes are reachable only through contextual actions, global search, direct URL, or WebView continuation.

### Key observations for PM review

| Finding | Why it matters |
| --- | --- |
| **More duplicates primary navigation.** | Web exposes both **Analyze** and **Menus** in the rail and again in More. The More entry calls the first one “Analyze & Reports,” while Reports itself remains a separate rail item. |
| **More carries multiple information architectures.** | It is simultaneously setup, team/admin, integrations, company configuration, and a fallback feature browser. This makes its purpose difficult to explain and scale. |
| **Web and mobile do not expose the same product map.** | Mobile uses embedded web pages for Home, Counts, Recipes, Reports, Waste, and More items, while native ownership is used for scanning and portions of counting/settings. |
| **Route metadata is incomplete and slightly inconsistent.** | Several registered routes are absent from the route catalog, and the `/inventory-count` legacy redirect points to different destinations in metadata and in the live app registration. |
| **Transition-era mobile duplicates remain.** | There are duplicate settings and inventory/session wrappers plus a native scan route without a confirmed caller. These are intentionally deferred from removal pending real-device validation. |
| **Some admin utilities are visible only in the global-admin header.** | POS Sync Jobs is registered and searchable in metadata but absent from the More landing, unlike most other platform-admin tools. |

---

## 2. Reading guide

### Navigation classifications

| Label | Meaning |
| --- | --- |
| **Primary** | Persistent first-level rail or tab destination. |
| **More** | Listed on the web More landing or mobile More screen. |
| **Header / utility** | Available from the global-admin header, top bar, footer, or global search. |
| **Contextual** | Reached from an action, list row, feature landing page, or workflow step. |
| **Programmatic** | Reached with parameters or a router action; unsuitable as a standalone menu item. |
| **Direct / discoverable** | Registered route with no confirmed persistent navigation entry; may be reachable through search, a direct URL, or another page not enumerated here. |
| **Legacy redirect** | Old URL that should forward to a current destination. |
| **Transition duplicate** | A retained parallel implementation during the mobile consolidation. |
| **Fallback** | Authentication, error, or not-found destination rather than normal product navigation. |

### Access shorthand

| Shorthand | Who can see it in navigation |
| --- | --- |
| **All signed-in users** | Any authenticated app user, unless an individual page adds further enforcement. |
| **Manager+** | Store manager, company admin, or global admin. |
| **Admin+** | Company admin or global admin. |
| **Global admin** | Platform-wide administrator only. |
| **Prep feature** | Visible only when `prep_chart` is available. |

> **Important:** The navigation checks documented here determine visibility. Route registration itself does not uniformly enforce every permission; page/API authorization remains a separate concern.

---

## 3. Web application: visible primary navigation

### 3.1 Primary rail

The web rail is also the navigation shown inside the web hamburger/sheet on narrow screens.

```text
Web application
├─ Home [Primary • All signed-in users]
│  └─ /  Dashboard
│
├─ Inventory [Primary • All signed-in users]
│  └─ /count  Inventory landing
│     ├─ /inventory-sessions  Count/session list [Contextual / embedded]
│     │  ├─ /new-count  Create session [Contextual]
│     │  ├─ /count/:id  Count session [Programmatic]
│     │  ├─ /count/:id/mobile  Mobile count session [Programmatic / embedded]
│     │  └─ /item-count/:id  Item count [Programmatic / embedded]
│     ├─ /inventory-items  Inventory Items [More on mobile]
│     │  ├─ /inventory-items/new  Create item [Contextual]
│     │  ├─ /inventory-items/:id  Item detail [Programmatic]
│     │  ├─ /inventory-items/duplicates  Deduplication [Contextual / direct]
│     │  └─ /inventory-items/par-levels  Par levels [Contextual / direct]
│     ├─ /inventory-import  Import Inventory [Contextual / direct]
│     ├─ /orderly-import  Orderly import [Contextual / direct]
│     ├─ /orderly-report  Orderly report [Contextual / direct]
│     ├─ /shelf-scans  Shelf scans [More on mobile]
│     └─ /prep-chart/on-hand  Prep on-hand [Contextual; visually grouped with Inventory]
│
├─ Order [Primary • Manager+]
│  └─ /order  Order landing
│     ├─ /orders  Orders [Contextual]
│     │  └─ /purchase-orders/:id  Purchase order detail [Programmatic]
│     ├─ /receiving/:poId  Receive delivery [Programmatic]
│     ├─ /vendors  Vendors [Contextual]
│     │  └─ /vendors/:id  Vendor detail [Programmatic]
│     ├─ /transfer-orders  Transfer orders [Contextual]
│     │  └─ /transfer-orders/:id  Transfer detail [Programmatic]
│     ├─ /order-guide-scan  Update vendor prices [Contextual]
│     └─ /order-guides/:id/review  Order guide review [Programmatic]
│
├─ Prep [Primary • Prep feature]
│  └─ /prep  Prep landing
│     ├─ /prep-chart  Prep today [Contextual]
│     ├─ /prep-chart/items  Prep items [Contextual]
│     │  ├─ /prep-chart/items/new  Create prep item [Contextual]
│     │  └─ /prep-chart/items/:id  Edit prep item [Programmatic]
│     ├─ /prep-chart/stations  Stations [Contextual]
│     └─ /prep-chart/production  Production log [Contextual]
│
├─ Menus [Primary • All signed-in users]
│  └─ /menus  Menu portfolio
│     ├─ /menus/:id  Menu builder [Programmatic]
│     ├─ /menu-scan  Menu scan [Contextual]
│     ├─ /menu-items  Item library [Contextual / duplicated in More]
│     │  ├─ /menu-items/:id  Item detail/editor state [Programmatic]
│     │  └─ /recipes/:id  Linked recipe [Programmatic]
│     └─ /recipes  Recipes [Contextual / duplicated in More]
│        ├─ /recipes/new  Recipe builder [Contextual]
│        ├─ /recipes/:id  Recipe detail [Programmatic]
│        ├─ /recipes/:id/edit  Recipe editor [Programmatic]
│        ├─ /recipe-import  Scan/import recipe [Contextual]
│        └─ /menu-insights  Menu Insights [Contextual; active under Analyze]
│
├─ Analyze [Primary • Manager+]
│  └─ /analyze  Analyze landing
│     ├─ /tfc/variance  Theoretical food cost [Contextual]
│     │  └─ query-string period/item drill-downs [Programmatic]
│     ├─ /tfc/sales-import  Generic CSV sales import [Contextual; POS-import feature]
│     ├─ /sales-by-item-import  Jonas Encore sales import [Contextual; POS-import feature]
│     └─ /variance  Inventory variance [Contextual]
│
├─ Reports [Primary • Manager+]
│  └─ /reports  Reports hub
│     ├─ /reports/scheduled  Scheduled reports [Contextual / direct]
│     └─ /reports/view  Report viewer [Programmatic / direct]
│
├─ Waste [Primary • All signed-in users]
│  └─ /waste  Waste entry
│
└─ More [Primary • All signed-in users; contents role-sensitive]
   └─ See Section 4
```

### 3.2 Rail behavior and exceptions

- A global administrator **without a selected company** sees only **Home** and **More** in the rail.
- **Order**, **Analyze**, and **Reports** require Manager+.
- **Prep** is hidden when the `prep_chart` feature is unavailable.
- The active-section helper treats:
  - Inventory/counting, inventory items, shelf scans, and Prep On Hand as **Inventory**;
  - Recipes, menus, menu items, and recipe import as **Menus**;
  - Menu Insights as **Analyze**;
  - Waste as a distinct **Waste** rail section.
- Labels in the rail and More are currently hard-coded in English even though the app wraps navigation in a language provider.

---

## 4. Web More: complete depth map

More is titled “Configuration, team management, and platform tools,” but currently includes feature entry points as well as administrative configuration.

```text
More [Primary rail destination]
├─ Insights [Manager+]
│  └─ Analyze & Reports → /analyze
│     ├─ Theoretical Food Cost → /tfc/variance
│     ├─ Import Sales (CSV) → /tfc/sales-import [POS-import feature]
│     ├─ Import Sales (Jonas Encore) → /sales-by-item-import [POS-import feature]
│     └─ Inventory Variance → /variance
│
├─ Menu & Recipes [All signed-in users]
│  ├─ Menus → /menus  [DUPLICATES primary Menus rail item]
│  │  ├─ Menu Builder → /menus/:id
│  │  └─ Menu Scan → /menu-scan
│  ├─ Item Library → /menu-items
│  │  ├─ Item-specific recipe → /recipes/:id
│  │  └─ Create linked recipe → /recipes/new?name=...
│  └─ Recipes → /recipes
│     ├─ Create → /recipes/new
│     ├─ View → /recipes/:id
│     ├─ Edit / complete → /recipes/:id/edit
│     ├─ Scan Recipe → /recipe-import [recipe-costing feature]
│     └─ Menu Insights → /menu-insights
│
├─ Inventory Setup [All signed-in users in this menu]
│  ├─ Categories → /categories
│  └─ Unit Conversions → /unit-conversions
│
├─ Locations
│  ├─ Storage Locations → /storage-locations [Manager+]
│  ├─ Operating Units → /operating-units [Manager+]
│  └─ Store Locations → /stores [Admin+ in More]
│
├─ Team [Admin+]
│  └─ Users → /users
│
├─ Integrations [Admin+]
│  └─ API Credentials → /api-credentials
│
├─ Company [Admin+]
│  └─ Settings → /settings
│     └─ QuickBooks configuration subsection [QuickBooks feature]
│
└─ Platform Administration [Global admin]
   ├─ Companies → /companies
   │  └─ Company Detail → /companies/:id
   ├─ Admin Users → /admin/users
   ├─ Vendor Registry → /admin/vendor-registry
   └─ Backgrounds → /admin/backgrounds
```

### Web functions not listed in More

These routes are registered and may be contextually reachable, but do not have a card in More:

| Area | Route(s) | Current access path |
| --- | --- | --- |
| Inventory utilities | `/inventory-items/duplicates`, `/inventory-items/par-levels`, `/inventory-import`, `/orderly-import`, `/orderly-report` | Contextual actions, search, or direct URL. |
| Ordering utilities | `/vendors`, `/order-guide-scan`, `/order-guides/:id/review`, `/transfer-orders` | Order landing and workflows. |
| POS setup | `/pos-recipe-linking`, `/pos/location-mapping/:connectionId`, `/pos/item-mapping/:connectionId` | Settings/integration workflows or direct URL. |
| Prep utilities | `/prep-chart/*` | Prep landing. |
| Reports utilities | `/reports/scheduled`, `/reports/view` | Reports hub/workflow or direct URL. |
| Platform utility | `/admin/pos-sync-jobs` | Global-admin header only. |
| Mobile dashboard route | `/dashboard/mobile` | Embedded/mobile entry point. |
| Developer utility | `/extension-pilot` | Development builds only. |

---

## 5. Web header, search, account, and supporting navigation

```text
Web shell utilities
├─ Global Admin Header [Global admin]
│  ├─ Backgrounds → /admin/backgrounds [Duplicates More]
│  ├─ Vendor Registry → /admin/vendor-registry [Duplicates More]
│  ├─ Stuck Syncs → /admin/pos-sync-jobs [Header-only; has stuck-job badge]
│  └─ All Companies → /companies [Duplicates More]
│
├─ Top bar
│  ├─ Mobile hamburger → same primary rail in a sheet
│  ├─ Global search → route catalog entries and search keywords
│  ├─ Store selector → changes active store context; not a route
│  ├─ Language toggle → changes language; not a route
│  ├─ Theme toggle → changes theme; not a route
│  └─ Avatar / account menu → account actions and sign-out
│
├─ Footer
│  └─ Version → What’s New modal; not a route
│
└─ Chat panel
   └─ Fixed application overlay; not a route
```

---

## 6. Web routes outside normal application navigation

### 6.1 Auth, onboarding, plans, and status

These render without the normal application shell.

```text
Public / full-screen application routes
├─ /login  Sign in [Fallback / entry]
├─ /signup  Lead signup [Fallback / entry]
├─ /activate  Activate account [Fallback]
├─ /accept-invitation/:token  Accept invitation [Programmatic]
├─ /forgot-password  Password recovery [Fallback]
├─ /reset-password  Password reset [Fallback]
├─ /pending-approval  Approval status [Fallback]
├─ /sso-access-denied  SSO access status [Fallback]
├─ /onboarding/setup  Onboarding setup [Programmatic]
├─ /onboarding-wizard  Global-admin-only onboarding [Programmatic]
├─ /choose-plan  Plan choice [Programmatic]
├─ /enterprise-inquiry  Enterprise lead path [Fallback]
└─ /enterprise-onboarding  Enterprise onboarding [Programmatic]
```

`/onboarding` is a legacy redirect to `/signup`.

### 6.2 Embedded web mode

When launched in embedded mode, the web application removes its normal rail/top bar and supports this restricted set of initial routes:

```text
Embedded web mode
├─ /  Dashboard
├─ /dashboard/mobile  Mobile dashboard
├─ /inventory-sessions
├─ /new-count
├─ /inventory-count
├─ /count/:id
├─ /count/:id/mobile
├─ /item-count/:id
├─ /purchase-orders/:id
├─ /inventory-items
├─ /inventory-items/:id
├─ /recipes
├─ /recipes/new
├─ /recipes/:id
├─ /recipes/:id/edit
├─ /shelf-scans
├─ /tfc/variance
├─ /stores
└─ /waste
```

The mobile wrapper preserves same-origin WebView navigation, so an embedded page can reach more of the web app than its initial path alone implies. A WebView attempt to reach `/login` is treated as an authentication failure rather than a user-visible login destination.

### 6.3 Legacy and redirect routes

| Legacy route | Current live behavior | Metadata expectation | Audit note |
| --- | --- | --- | --- |
| `/menu-import` | Redirects to `/menu-scan` | `/menu-scan` | Aligned. |
| `/purchase-orders` | Redirects to `/orders` | `/orders` | Aligned; detail route `/purchase-orders/:id` remains current. |
| `/onboarding` | Redirects to `/signup` | Not cataloged | Expected application redirect. |
| `/inventory-count` | Redirects to `/count` in normal app mode | Declared as legacy for `/inventory-sessions` | **Conflict:** route catalog and live registration disagree. Embedded mode mounts a page at this path rather than redirecting. |

---

## 7. Mobile companion: complete navigation map

### 7.1 Authentication and root behavior

```text
Mobile root
├─ /login [Fallback / entry]
│  └─ Successful login → /
├─ Auth gate
│  ├─ Unauthenticated request for any protected path → /login
│  └─ Authenticated request for /login → /
└─ /(tabs) [Authenticated tab container]
```

### 7.2 Persistent tab navigation

```text
Mobile tabs
├─ Home → / [Primary]
│  └─ Embedded web: /dashboard/mobile
│
├─ Counts → /counts [Primary]
│  └─ Embedded web: /inventory-sessions
│
├─ Recipes → /recipes [Primary]
│  └─ Embedded web: /recipes
│
├─ Reports → /reports [Primary]
│  └─ Embedded web: /tfc/variance
│
├─ Waste → /waste [Primary]
│  ├─ Embedded web: /waste
│  └─ Voice Waste → /voice-waste [Native contextual action]
│     └─ Waste Entry → /waste-web [Native-to-WebView handoff]
│
└─ More → /more [Primary]
   └─ See Section 7.3
```

There is a legacy `/(tabs)/settings` screen registered with `href: null`; it is hidden from the tab bar. The active mobile settings destination is the root `/settings` route.

### 7.3 Mobile More

```text
Mobile More
├─ Inventory Items → /web-section?path=/inventory-items [More → embedded web]
├─ Shelf Scans → /web-section?path=/shelf-scans [More → embedded web]
├─ Stores → /web-section?path=/stores [More → embedded web]
├─ Scan Inventory → /camera [More → native scan]
└─ Settings → /settings [More → native]
```

The generic `/web-section` wrapper permits only same-app relative initial paths, defaults invalid paths to `/dashboard/mobile`, and then lets the embedded web page continue within the main application.

### 7.4 Native counting and scan workflow

```text
Counts / inventory session workflow
├─ /counts
│  └─ Embedded inventory-sessions page
│
├─ /session/[id] [Programmatic native session summary]
│  ├─ Count Items / Start Counting → /session/count-web?sessionId=...
│  │  └─ Embedded count page
│  ├─ Scan / Scan Shelves / Invoice → /camera
│  │  └─ /results [Native single-item scan result]
│  │     ├─ Apply an addition or direct-set count
│  │     └─ Return to camera or session
│  └─ Category or location → /session/items?sessionId=...&group...
│     └─ /session/count/[id] [Native group list]
│        ├─ Item → /session/item?sessionId=...&item...
│        │  ├─ Manual increment/decrement and direct input
│        │  └─ Scan → /camera
│        └─ Scan catch-weight item → /camera
│
├─ /scan [Transition / likely orphan]
│  └─ Native sweep-scan review and apply workflow
│
└─ /inventory-web [Transition duplicate]
   └─ Specialized embedded inventory/session wrapper
```

### 7.5 Other mobile stack routes

| Route | Classification | Purpose |
| --- | --- | --- |
| `/camera` | Programmatic / More | Native inventory scan entry. |
| `/results` | Programmatic | Native scan result/apply screen. |
| `/web-section` | Programmatic | Generic same-origin embedded web wrapper. |
| `/settings` | More | Active native settings screen. |
| `/voice-waste` | Contextual | Native voice capture for waste reporting. |
| `/waste-web` | Programmatic | Embedded waste submission page. |
| `/session/count-web` | Programmatic | Embedded count page for a selected session. |
| `/inventory-web` | Transition duplicate | Older specialized embedded inventory/session page. |
| `/+not-found` | Fallback | Unknown mobile route; link to Home. |

---

## 8. Public marketing navigation

The marketing site is a separate public navigation system. It feeds into the application but is not displayed inside the authenticated product shell.

```text
Marketing website
├─ Brand / Home
├─ For Chefs
├─ For F&B Leaders
├─ Pricing
├─ About
├─ Contact
├─ Language-specific Spanish equivalents
├─ Footer links
│  ├─ Privacy
│  ├─ Terms
│  ├─ Contact
│  └─ Login
└─ Application entry points
   ├─ Dashboard → authenticated app /
   ├─ Login → /login
   └─ Contact / signup routes
```

Marketing navigation has responsive desktop and mobile variants. It also exposes language paths in English and Spanish. The app-mode location of login is intentionally different from public-site routing, so this boundary should remain explicit in any future information-architecture work.

---

## 9. Visibility and access matrix

| Area | Store user | Store manager | Company admin | Global admin | Feature/tier notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Home, Inventory, Menus, Waste, More rail | Yes | Yes | Yes | Yes* | *Without selected company, global admin only sees Home and More. |
| Order rail and routes in navigation | No | Yes | Yes | Yes | Route metadata says Manager+. |
| Analyze and Reports rail | No | Yes | Yes | Yes | More repeats Analyze as “Analyze & Reports.” |
| Prep rail | Feature required | Feature required | Feature required | Yes | `prep_chart` controls rail visibility; global admin receives all features. |
| More: Categories / Unit Conversions | Shown | Shown | Shown | Shown | More itself does not add a local visibility gate; catalog metadata says Manager+. |
| More: Storage Locations / Operating Units | No | Yes | Yes | Yes | Manager+. |
| More: Store Locations | No | No | Yes | Yes | More uses Admin+; catalog metadata uses Manager+, creating a visibility mismatch. |
| More: Users, API Credentials, Settings | No | No | Yes | Yes | Admin+. |
| More: Platform Administration | No | No | No | Yes | Companies, admin users, vendor registry, backgrounds. |
| Reports / analysis specifics | Depends | Depends | Depends | Depends | Food-cost and POS-import cards have their own feature availability. |
| Recipe scan/import | Depends | Depends | Depends | Depends | Exposed within Recipes behind recipe-costing feature. |
| QuickBooks settings | Depends | Depends | Depends | Depends | Subsection depends on QuickBooks integration feature. |

### Language behavior

- The app wraps routing in a language provider, and the top bar offers a language control.
- Primary rail and More labels are currently written in English rather than being sourced from the language catalog.
- Mobile tab labels and mobile More labels are likewise written directly in English.
- Marketing navigation has explicit English and Spanish paths.

---

## 10. Consolidation and cleanup candidates

This section identifies decisions to review. It does **not** prescribe a change.

### P0 — Confirm the source of truth for legacy/metadata behavior

| Candidate | Evidence | PM / engineering decision needed |
| --- | --- | --- |
| Align `/inventory-count` behavior. | Route metadata defines it as a legacy route for `/inventory-sessions`; the normal web app redirects it to `/count`; embedded mode serves a page on it. | Decide the canonical destination and whether embedded behavior requires an exception. |
| Complete the route catalog. | Registered routes are absent from metadata, including Operating Units, sales-by-item import, inventory duplicates, POS mapping/linking, reports subpages, dashboard/mobile, and admin utility routes. | Decide whether the route catalog is the authoritative map for search, breadcrumbs, active sections, and redirects; if so, enumerate all current routes. |
| Align section vocabulary. | The rail has `reports` and `waste`, but the route-section type does not; Waste is cataloged under Count while visually separate. | Confirm the intended analytic/reporting/waste hierarchy before normalizing metadata. |

### P1 — Simplify what More means

| Candidate | Current state | Decision needed |
| --- | --- | --- |
| Remove or reposition Analyze duplicate. | Analyze is a rail item and is repeated in More as “Analyze & Reports.” Reports has its own rail item. | Keep a mobile-oriented fallback, rename it, or remove it from web More. |
| Remove or reposition Menus duplicate. | Menus is a rail item and the first item in More’s Menu & Recipes section. | Confirm whether More is intended as a secondary map or configuration-only space. |
| Separate product areas from setup/admin. | More includes Menu & Recipes beside Categories, Team, Integrations, Settings, and Platform Administration. | Choose whether More should be “Setup & Administration,” a broader app directory, or segmented by user jobs. |
| Make missing admin utility discoverable consistently. | POS Sync Jobs appears in the global-admin header but not in More. | Include it in platform administration, retain header-only access, or move it to an operations dashboard. |
| Reconcile Store Locations access labeling. | More shows it only to Admin+, while metadata describes Manager+ access. | Confirm intended role policy and make UI/catalog/page policy agree. |

### P2 — Reduce mobile transition complexity after device validation

| Candidate | Current state | Decision needed |
| --- | --- | --- |
| Retire duplicate settings implementation. | Root `/settings` is the active native path; hidden `/(tabs)/settings` remains from earlier work. | Remove after physical-device regression confirms no deep link or workflow depends on it. |
| Retire duplicate inventory wrapper. | Counts tab uses generic `WebSection`; `/inventory-web` is a specialized retained wrapper with no confirmed caller. | Remove after physical-device regression confirms coverage. |
| Resolve `/scan` route ownership. | Native sweep-scan review route exists; no confirmed in-app router caller was found. | Keep and add a visible entry, wire it to camera workflow, or remove it after validation. |
| Clarify mobile More scope. | Mobile More has five items, while web More has a large role-sensitive catalog; embedded pages may allow much deeper navigation. | Decide whether mobile More is intentionally curated or should mirror role-sensitive web More. |

### P3 — Improve discoverability and consistency

| Candidate | Current state | Decision needed |
| --- | --- | --- |
| Make direct/context-only utilities intentionally discoverable. | Imports, POS mapping, inventory tools, reporting utilities, and prep subpages have no persistent entry. | Confirm which are intentionally workflow-only versus candidates for feature landing pages, More, or search. |
| Localize navigation labels. | Web rail, web More, mobile tabs, and mobile More use English strings directly. | Confirm localization as a navigation-quality requirement. |
| Define the canonical owner for mobile capabilities. | Mobile combines native counts/scans/voice/settings with embedded web recipes, reports, vendors, and other linked pages. | Preserve the existing bridge model or publish a future ownership roadmap by capability. |

---

## 11. Suggested PM review questions

1. Is **More** meant to be a configuration/admin destination, a complete feature directory, or a mobile fallback for features without a tab?
2. Should **Analyze**, **Reports**, and **Menus** appear in both the rail and More, or should every primary product area have one persistent home?
3. Which direct/context-only pages are intentional expert workflows, and which should have a visible parent destination?
4. Should **Store Locations** be manager-accessible or admin-only?
5. Should **POS Sync Jobs** be a first-class Platform Administration card, remain a header utility, or move into a broader operational health surface?
6. When the mobile consolidation validation completes, which legacy mobile routes can be removed rather than hidden?
7. Is route metadata expected to be the authoritative map for search, breadcrumbs, active states, permissions, and redirects? If so, what governance should keep it synchronized with registered routes?
8. Is navigation localization part of the current multilingual product standard?

---

## 12. Source evidence

### Web

- `artifacts/fnb-cost-pro/src/App.tsx`
- `artifacts/fnb-cost-pro/src/components/app-sidebar.tsx`
- `artifacts/fnb-cost-pro/src/components/global-admin-header.tsx`
- `artifacts/fnb-cost-pro/src/components/website/marketing-layout.tsx`
- `artifacts/fnb-cost-pro/src/lib/route-config.ts`
- `artifacts/fnb-cost-pro/src/pages/more-landing.tsx`
- `artifacts/fnb-cost-pro/src/pages/analyze-landing.tsx`
- `artifacts/fnb-cost-pro/src/pages/recipes.tsx`
- `artifacts/fnb-cost-pro/src/pages/recipe-import.tsx`
- `artifacts/fnb-cost-pro/src/hooks/use-tier.ts`

### Mobile

- `artifacts/fnb-cost-pro-mobile/app/_layout.tsx`
- `artifacts/fnb-cost-pro-mobile/app/(tabs)/_layout.tsx`
- `artifacts/fnb-cost-pro-mobile/app/(tabs)/more.tsx`
- `artifacts/fnb-cost-pro-mobile/app/(tabs)/waste.tsx`
- `artifacts/fnb-cost-pro-mobile/app/session/[id].tsx`
- `artifacts/fnb-cost-pro-mobile/app/session/items.tsx`
- `artifacts/fnb-cost-pro-mobile/app/session/count/[id].tsx`
- `artifacts/fnb-cost-pro-mobile/app/session/item.tsx`
- `artifacts/fnb-cost-pro-mobile/app/web-section.tsx`
- `artifacts/fnb-cost-pro-mobile/components/WebSection.tsx`
- `artifacts/fnb-cost-pro-mobile/app/inventory-web.tsx`
