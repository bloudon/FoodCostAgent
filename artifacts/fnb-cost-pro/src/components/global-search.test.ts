/**
 * Unit tests for the nav-search permission filtering logic in GlobalSearch.
 *
 * These tests exercise the same pipeline that `global-search.tsx` uses:
 *   1. userMeetsRole  — role-rank comparison
 *   2. hasFeature     — tier-based feature flag
 *   3. dynamic-route  — `:param` exclusion
 *
 * Because the helpers are private to the component, we replicate the
 * minimal logic here so the tests remain pure (no React / DOM required).
 */

import { describe, it, expect } from "vitest";
import { ROUTE_CONFIG } from "@/lib/route-config";
import { hasFeature } from "@shared/tier-config";
import type { DbTier } from "@shared/tier-config";

// ── Replicated permission helpers (mirrors global-search.tsx) ──────────────

const ROLE_RANK: Record<string, number> = {
  store_manager: 1,
  company_admin: 2,
  global_admin: 3,
};

function userMeetsRole(
  userRole: string | undefined | null,
  requiredRole: string | undefined,
): boolean {
  if (!requiredRole) return true;
  if (!userRole) return false;
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[requiredRole] ?? 0);
}

/** Simulates the navRoutes filter from GlobalSearch. */
function filterRoutes(
  userRole: string | undefined | null,
  tier: DbTier | null,
  isGlobalAdmin = false,
) {
  return ROUTE_CONFIG.filter((r) => {
    // Dynamic routes (contain ":") are always excluded
    if (r.route.includes(":")) return false;
    // Mobile utility route excluded
    if (r.route === "/dashboard/mobile") return false;
    // Role check
    if (!userMeetsRole(userRole, r.requiredRole)) return false;
    // Feature flag check — global admins bypass feature gates
    if (r.requiredFeature) {
      const allowed = isGlobalAdmin || hasFeature(tier, r.requiredFeature as any);
      if (!allowed) return false;
    }
    return true;
  });
}

// ── Helper: collect visible routes for a given context ─────────────────────

function visibleRoutes(
  userRole: string | undefined | null,
  tier: DbTier | null = "basic",
) {
  const isGlobalAdmin = userRole === "global_admin";
  return filterRoutes(userRole, tier, isGlobalAdmin).map((r) => r.route);
}

// ── userMeetsRole unit tests ───────────────────────────────────────────────

describe("userMeetsRole", () => {
  it("returns true when no role is required", () => {
    expect(userMeetsRole(undefined, undefined)).toBe(true);
    expect(userMeetsRole(null, undefined)).toBe(true);
    expect(userMeetsRole("store_manager", undefined)).toBe(true);
  });

  it("returns false when role is required but user has none", () => {
    expect(userMeetsRole(undefined, "store_manager")).toBe(false);
    expect(userMeetsRole(null, "company_admin")).toBe(false);
  });

  it("staff (no role) cannot meet any requiredRole", () => {
    expect(userMeetsRole(undefined, "store_manager")).toBe(false);
    expect(userMeetsRole(undefined, "company_admin")).toBe(false);
    expect(userMeetsRole(undefined, "global_admin")).toBe(false);
  });

  it("store_manager meets store_manager requirement", () => {
    expect(userMeetsRole("store_manager", "store_manager")).toBe(true);
  });

  it("store_manager cannot meet company_admin or global_admin requirement", () => {
    expect(userMeetsRole("store_manager", "company_admin")).toBe(false);
    expect(userMeetsRole("store_manager", "global_admin")).toBe(false);
  });

  it("company_admin meets store_manager and company_admin requirements", () => {
    expect(userMeetsRole("company_admin", "store_manager")).toBe(true);
    expect(userMeetsRole("company_admin", "company_admin")).toBe(true);
  });

  it("company_admin cannot meet global_admin requirement", () => {
    expect(userMeetsRole("company_admin", "global_admin")).toBe(false);
  });

  it("global_admin meets all role requirements", () => {
    expect(userMeetsRole("global_admin", "store_manager")).toBe(true);
    expect(userMeetsRole("global_admin", "company_admin")).toBe(true);
    expect(userMeetsRole("global_admin", "global_admin")).toBe(true);
  });
});

// ── Dynamic ":param" route exclusion ──────────────────────────────────────

describe("dynamic route exclusion", () => {
  it("never includes routes with a colon regardless of role", () => {
    // These are dynamic routes that exist in ROUTE_CONFIG
    const dynamicRoutes = [
      "/count/:id",
      "/count/:id/mobile",
      "/item-count/:id",
      "/inventory-items/:id",
      "/purchase-orders/:id",
      "/receiving/:poId",
      "/transfer-orders/:id",
      "/order-guides/:id/review",
      "/prep-chart/items/:id",
      "/companies/:id",
    ];

    for (const role of [undefined, "store_manager", "company_admin", "global_admin"] as const) {
      const routes = visibleRoutes(role);
      for (const dr of dynamicRoutes) {
        expect(routes).not.toContain(dr);
      }
    }
  });
});

// ── Staff (no role) visibility ─────────────────────────────────────────────

describe("staff user (no role)", () => {
  it("can see unrestricted routes", () => {
    const routes = visibleRoutes(undefined);
    expect(routes).toContain("/");
    expect(routes).toContain("/count");
    expect(routes).toContain("/inventory-items");
    expect(routes).toContain("/recipes");
    expect(routes).toContain("/menu-items");
  });

  it("cannot see store_manager-gated routes", () => {
    const routes = visibleRoutes(undefined);
    const managerRoutes = ROUTE_CONFIG
      .filter((r) => r.requiredRole === "store_manager")
      .map((r) => r.route);
    for (const r of managerRoutes) {
      expect(routes).not.toContain(r);
    }
  });

  it("cannot see company_admin-gated routes", () => {
    const routes = visibleRoutes(undefined);
    expect(routes).not.toContain("/users");
    expect(routes).not.toContain("/api-credentials");
    expect(routes).not.toContain("/settings");
  });

  it("cannot see global_admin-gated routes", () => {
    const routes = visibleRoutes(undefined);
    expect(routes).not.toContain("/companies");
    expect(routes).not.toContain("/admin/users");
    expect(routes).not.toContain("/admin/vendor-registry");
    expect(routes).not.toContain("/admin/backgrounds");
    expect(routes).not.toContain("/admin/pos-sync-jobs");
  });
});

// ── store_manager visibility ───────────────────────────────────────────────

describe("store_manager", () => {
  it("can see unrestricted and store_manager-gated routes", () => {
    const routes = visibleRoutes("store_manager");
    expect(routes).toContain("/order");
    expect(routes).toContain("/orders");
    expect(routes).toContain("/vendors");
    expect(routes).toContain("/analyze");
    expect(routes).toContain("/variance");
    expect(routes).toContain("/categories");
    expect(routes).toContain("/storage-locations");
  });

  it("cannot see company_admin-gated routes", () => {
    const routes = visibleRoutes("store_manager");
    expect(routes).not.toContain("/users");
    expect(routes).not.toContain("/api-credentials");
    expect(routes).not.toContain("/settings");
  });

  it("cannot see global_admin-gated routes", () => {
    const routes = visibleRoutes("store_manager");
    expect(routes).not.toContain("/companies");
    expect(routes).not.toContain("/admin/users");
    expect(routes).not.toContain("/admin/vendor-registry");
    expect(routes).not.toContain("/admin/backgrounds");
    expect(routes).not.toContain("/admin/pos-sync-jobs");
  });
});

// ── company_admin visibility ───────────────────────────────────────────────

describe("company_admin", () => {
  it("can see company_admin-gated routes", () => {
    const routes = visibleRoutes("company_admin");
    expect(routes).toContain("/users");
    expect(routes).toContain("/api-credentials");
    expect(routes).toContain("/settings");
  });

  it("can see store_manager-gated routes (hierarchical)", () => {
    const routes = visibleRoutes("company_admin");
    expect(routes).toContain("/order");
    expect(routes).toContain("/vendors");
    expect(routes).toContain("/analyze");
    expect(routes).toContain("/variance");
  });

  it("cannot see global_admin-gated routes", () => {
    const routes = visibleRoutes("company_admin");
    expect(routes).not.toContain("/companies");
    expect(routes).not.toContain("/admin/users");
    expect(routes).not.toContain("/admin/vendor-registry");
    expect(routes).not.toContain("/admin/backgrounds");
    expect(routes).not.toContain("/admin/pos-sync-jobs");
  });
});

// ── global_admin visibility ────────────────────────────────────────────────

describe("global_admin", () => {
  it("can see all role-gated routes including global_admin ones", () => {
    const routes = visibleRoutes("global_admin");
    // company_admin routes
    expect(routes).toContain("/users");
    expect(routes).toContain("/settings");
    // global_admin routes (no dynamic segments)
    expect(routes).toContain("/companies");
    expect(routes).toContain("/admin/users");
    expect(routes).toContain("/admin/vendor-registry");
    expect(routes).toContain("/admin/backgrounds");
    expect(routes).toContain("/admin/pos-sync-jobs");
  });

  it("still excludes dynamic :param routes", () => {
    const routes = visibleRoutes("global_admin");
    expect(routes).not.toContain("/companies/:id");
    expect(routes).not.toContain("/count/:id");
  });
});

// ── Feature-gated routes ───────────────────────────────────────────────────

describe("feature-gated routes (prep_chart requires platform tier)", () => {
  const prepRoutes = ROUTE_CONFIG
    .filter((r) => r.requiredFeature === "prep_chart" && !r.route.includes(":"))
    .map((r) => r.route);

  it("prep routes exist in ROUTE_CONFIG with requiredFeature=prep_chart", () => {
    expect(prepRoutes.length).toBeGreaterThan(0);
    expect(prepRoutes).toContain("/prep");
    expect(prepRoutes).toContain("/prep-chart");
  });

  it("shows prep routes when tier is 'platform'", () => {
    const routes = visibleRoutes(undefined, "platform");
    for (const r of prepRoutes) {
      const rc = ROUTE_CONFIG.find((c) => c.route === r);
      if (rc?.requiredFeature === "prep_chart") {
        expect(routes).toContain(r);
      }
    }
  });

  it("hides prep routes when tier is 'free' (legacy, rank 0)", () => {
    const routes = visibleRoutes(undefined, "free");
    for (const r of prepRoutes) {
      expect(routes).not.toContain(r);
    }
  });

  it("hides prep routes when tier is null (no subscription)", () => {
    const routes = visibleRoutes(undefined, null);
    for (const r of prepRoutes) {
      expect(routes).not.toContain(r);
    }
  });

  it("shows prep routes when tier is 'enterprise'", () => {
    const routes = visibleRoutes(undefined, "enterprise");
    for (const r of prepRoutes) {
      const rc = ROUTE_CONFIG.find((c) => c.route === r);
      if (rc?.requiredFeature === "prep_chart") {
        expect(routes).toContain(r);
      }
    }
  });

  it("global_admin always sees prep routes regardless of tier (isGlobalAdmin bypasses feature gate)", () => {
    // global_admin is treated as enterprise, so this is doubly true
    const routes = visibleRoutes("global_admin", "free");
    for (const r of prepRoutes) {
      expect(routes).toContain(r);
    }
  });
});

// ── Snapshot: exact set of routes visible to each role at basic tier ───────

describe("role boundary snapshots (basic tier)", () => {
  it("routes visible to staff but hidden from no-role user are empty set", () => {
    // All routes visible to staff (no role) should have no requiredRole
    const staffRoutes = visibleRoutes(undefined, "basic");
    for (const route of staffRoutes) {
      const rc = ROUTE_CONFIG.find((c) => c.route === route);
      expect(rc?.requiredRole).toBeUndefined();
    }
  });

  it("routes visible to store_manager but not staff are all requiredRole=store_manager", () => {
    const staffRoutes = new Set(visibleRoutes(undefined, "basic"));
    const managerRoutes = visibleRoutes("store_manager", "basic");
    const managerOnly = managerRoutes.filter((r) => !staffRoutes.has(r));
    for (const route of managerOnly) {
      const rc = ROUTE_CONFIG.find((c) => c.route === route);
      expect(rc?.requiredRole).toBe("store_manager");
    }
  });

  it("routes visible to company_admin but not store_manager are all requiredRole=company_admin", () => {
    const managerRoutes = new Set(visibleRoutes("store_manager", "basic"));
    const adminRoutes = visibleRoutes("company_admin", "basic");
    const adminOnly = adminRoutes.filter((r) => !managerRoutes.has(r));
    for (const route of adminOnly) {
      const rc = ROUTE_CONFIG.find((c) => c.route === route);
      expect(rc?.requiredRole).toBe("company_admin");
    }
  });

  it("routes visible to global_admin but not company_admin are all requiredRole=global_admin", () => {
    const companyAdminRoutes = new Set(visibleRoutes("company_admin", "enterprise"));
    const globalAdminRoutes = visibleRoutes("global_admin", "enterprise");
    const globalOnly = globalAdminRoutes.filter((r) => !companyAdminRoutes.has(r));
    for (const route of globalOnly) {
      const rc = ROUTE_CONFIG.find((c) => c.route === route);
      expect(rc?.requiredRole).toBe("global_admin");
    }
  });
});
