/**
 * Centralized route metadata for FNB Cost Pro.
 *
 * Every canonical application route lives here. Use this config for:
 *   - Active-section detection (see app-sidebar getActiveSection)
 *   - Navigation visibility / permission checks
 *   - Breadcrumb defaults
 *   - Redirect mapping
 *
 * Adding a new route: append an entry here, then register it in App.tsx.
 * Renaming a route: update `route`, add the old path to `legacyRoutes`.
 */

export type NavSection =
  | "home"
  | "count"
  | "order"
  | "prep"
  | "analyze"
  | "more";

export interface RouteConfig {
  /** Canonical URL path */
  route: string;
  /** Human-readable label used in nav, breadcrumbs, and page titles */
  label: string;
  /** Which rail section this route belongs to */
  section: NavSection;
  /** Minimum role required. Undefined = any authenticated user. */
  requiredRole?: "store_manager" | "company_admin" | "global_admin";
  /** Feature flag required. Undefined = no gate. */
  requiredFeature?: string;
  /** Old paths that should redirect to `route` */
  legacyRoutes?: string[];
  /**
   * Additional search keywords (space-separated) that supplement the label
   * for the global nav search. Use for common synonyms or alternate phrasings
   * that users might type when looking for this page.
   */
  keywords?: string;
}

export const ROUTE_CONFIG: RouteConfig[] = [
  // ── Home ────────────────────────────────────────────────────────────────
  { route: "/", label: "Home", section: "home" },

  // ── Count ────────────────────────────────────────────────────────────────
  { route: "/count", label: "Inventory", section: "count" },
  {
    route: "/inventory-sessions",
    label: "Counts",
    section: "count",
    legacyRoutes: ["/inventory-count"],
  },
  { route: "/new-count", label: "New Count", section: "count" },
  { route: "/count/:id", label: "Count Session", section: "count" },
  { route: "/count/:id/mobile", label: "Count Session", section: "count" },
  { route: "/item-count/:id", label: "Item Count", section: "count" },
  { route: "/inventory-items", label: "Inventory Items", section: "count" },
  { route: "/inventory-items/par-levels", label: "Par Levels", section: "count" },
  { route: "/inventory-items/new", label: "New Item", section: "count" },
  { route: "/inventory-items/:id", label: "Item Detail", section: "count" },
  { route: "/inventory-import", label: "Import Inventory", section: "count", keywords: "upload import csv items" },
  { route: "/orderly-import", label: "Orderly Import", section: "count", keywords: "orderly upload import sync" },
  { route: "/orderly-report", label: "Orderly Report", section: "count" },
  { route: "/shelf-scans", label: "Shelf Scans", section: "count" },
  { route: "/waste", label: "Waste", section: "count", keywords: "waste loss spoilage" },

  // ── Order ────────────────────────────────────────────────────────────────
  { route: "/order", label: "Order", section: "order", requiredRole: "store_manager" },
  {
    route: "/orders",
    label: "Orders",
    section: "order",
    requiredRole: "store_manager",
    legacyRoutes: ["/purchase-orders"],
  },
  { route: "/purchase-orders/:id", label: "Order Detail", section: "order", requiredRole: "store_manager" },
  { route: "/receiving/:poId", label: "Receive Delivery", section: "order", requiredRole: "store_manager" },
  { route: "/vendors", label: "Vendors", section: "order", requiredRole: "store_manager", keywords: "supplier distributor purchasing" },
  { route: "/transfer-orders", label: "Transfer Orders", section: "order", requiredRole: "store_manager" },
  { route: "/transfer-orders/:id", label: "Transfer Detail", section: "order", requiredRole: "store_manager" },
  { route: "/order-guide-scan", label: "Update Vendor Prices", section: "order", requiredRole: "store_manager" },
  { route: "/order-guides/:id/review", label: "Order Guide Review", section: "order", requiredRole: "store_manager" },

  // ── Prep ────────────────────────────────────────────────────────────────
  { route: "/prep", label: "Prep", section: "prep", requiredFeature: "prep_chart" },
  { route: "/prep-chart", label: "Prep Today", section: "prep", requiredFeature: "prep_chart" },
  { route: "/prep-chart/items", label: "Prep Items", section: "prep", requiredFeature: "prep_chart" },
  { route: "/prep-chart/items/new", label: "New Prep Item", section: "prep", requiredFeature: "prep_chart" },
  { route: "/prep-chart/items/:id", label: "Edit Prep Item", section: "prep", requiredFeature: "prep_chart" },
  { route: "/prep-chart/stations", label: "Stations", section: "prep", requiredFeature: "prep_chart" },
  { route: "/prep-chart/on-hand", label: "On Hand", section: "count" },
  { route: "/prep-chart/production", label: "Production Log", section: "prep", requiredFeature: "prep_chart" },

  // ── Analyze ──────────────────────────────────────────────────────────────
  { route: "/analyze", label: "Analyze", section: "analyze", requiredRole: "store_manager" },
  { route: "/tfc/variance", label: "Food Cost", section: "analyze", requiredRole: "store_manager", keywords: "theoretical food cost tfc" },
  { route: "/tfc/sales-import", label: "Import Sales", section: "analyze", requiredRole: "store_manager" },
  { route: "/variance", label: "Inventory Variance", section: "analyze", requiredRole: "store_manager" },
  { route: "/menu-insights", label: "Menu Insights", section: "analyze" },

  // ── More ─────────────────────────────────────────────────────────────────
  { route: "/more", label: "More", section: "more" },
  { route: "/menu-items", label: "Menu Items", section: "more" },
  { route: "/menus", label: "Menus", section: "more" },
  { route: "/menu-scan", label: "Menu Scan", section: "more", legacyRoutes: ["/menu-import"], keywords: "scan import menu photo camera" },
  { route: "/recipes", label: "Recipes", section: "more", keywords: "recipe builder" },
  { route: "/recipe-import", label: "Import Recipes", section: "more" },
  { route: "/categories", label: "Categories", section: "more", requiredRole: "store_manager" },
  { route: "/unit-conversions", label: "Unit Conversions", section: "more", requiredRole: "store_manager" },
  { route: "/storage-locations", label: "Storage Locations", section: "more", requiredRole: "store_manager" },
  { route: "/stores", label: "Store Locations", section: "more", requiredRole: "store_manager" },
  { route: "/users", label: "Users", section: "more", requiredRole: "company_admin" },
  { route: "/api-credentials", label: "API Credentials", section: "more", requiredRole: "company_admin" },
  { route: "/settings", label: "Settings", section: "more", requiredRole: "company_admin", keywords: "company configuration pos integrations" },

  // ── Platform Admin ───────────────────────────────────────────────────────
  { route: "/companies", label: "Companies", section: "more", requiredRole: "global_admin" },
  { route: "/companies/:id", label: "Company Detail", section: "more", requiredRole: "global_admin" },
  { route: "/admin/users", label: "Admin Users", section: "more", requiredRole: "global_admin" },
  { route: "/admin/vendor-registry", label: "Vendor Registry", section: "more", requiredRole: "global_admin" },
  { route: "/admin/backgrounds", label: "Backgrounds", section: "more", requiredRole: "global_admin" },
  { route: "/admin/pos-sync-jobs", label: "POS Sync Jobs", section: "more", requiredRole: "global_admin", keywords: "pos sync square jobs" },
];

/**
 * Convert a route pattern like "/foo/:id/bar" into a RegExp that matches
 * exact pathnames with dynamic segments. Each `:param` matches one path
 * segment (no slashes). The match must consume the entire pathname.
 */
function routePatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/\//g, "\\/")           // escape slashes
    .replace(/:[^/]+/g, "[^/]+");    // :param → one segment
  return new RegExp(`^${escaped}$`);
}

/**
 * Look up a route's human-readable label by its current pathname.
 * Returns undefined for "/" (Home) and unmatched paths.
 * Uses segment-aware pattern matching so mid-path params (e.g.
 * /order-guides/:id/review) are resolved correctly.
 */
export function getLabelForPath(pathname: string): string | undefined {
  if (pathname === "/") return undefined;

  // Find all routes whose pattern matches the pathname, then pick the
  // longest pattern (most specific) to break ties.
  const matches = ROUTE_CONFIG
    .filter((r) => routePatternToRegex(r.route).test(pathname))
    .sort((a, b) => b.route.length - a.route.length);

  return matches[0]?.label;
}

/**
 * Look up a route's section by its current pathname.
 * Mirrors the logic in app-sidebar getActiveSection but driven by ROUTE_CONFIG.
 * Use for breadcrumbs, page-level section tagging, or tests.
 */
export function getSectionForPath(pathname: string): NavSection {
  // Exact match first
  const exact = ROUTE_CONFIG.find((r) => r.route === pathname);
  if (exact) return exact.section;

  // Prefix match — longest match wins
  const prefixMatches = ROUTE_CONFIG
    .filter((r) => {
      const prefix = r.route.replace(/\/:[^/]+/g, "");
      return prefix !== "/" && pathname.startsWith(prefix);
    })
    .sort((a, b) => b.route.length - a.route.length);

  return prefixMatches[0]?.section ?? "more";
}

/**
 * Flat map of legacy → canonical redirects, derived from ROUTE_CONFIG.
 * Import this in the redirect layer rather than hardcoding paths in components.
 *
 * @example
 * const canonical = LEGACY_REDIRECT_MAP["/purchase-orders"]; // "/orders"
 */
export const LEGACY_REDIRECT_MAP: Record<string, string> = Object.fromEntries(
  ROUTE_CONFIG.flatMap((r) =>
    (r.legacyRoutes ?? []).map((legacy) => [legacy, r.route])
  )
);
