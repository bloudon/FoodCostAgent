import { describe, it, expect } from "vitest";
import { getLabelForPath, ROUTE_CONFIG } from "./route-config";

describe("getLabelForPath", () => {
  // Home — should return undefined (no label shown)
  it("returns undefined for '/'", () => {
    expect(getLabelForPath("/")).toBeUndefined();
  });

  // Static top-level routes
  it("returns label for exact static route", () => {
    expect(getLabelForPath("/recipes")).toBe("Recipes");
    expect(getLabelForPath("/inventory-items")).toBe("Inventory Items");
    expect(getLabelForPath("/settings")).toBe("Settings");
  });

  // Dynamic param at end
  it("returns label for route with trailing :id param", () => {
    expect(getLabelForPath("/inventory-items/42")).toBe("Item Detail");
    expect(getLabelForPath("/purchase-orders/99")).toBe("Order Detail");
    expect(getLabelForPath("/count/7")).toBe("Count Session");
  });

  // Dynamic param in the middle of the path
  it("returns correct label for route with mid-path :id param", () => {
    expect(getLabelForPath("/order-guides/123/review")).toBe("Order Guide Review");
  });

  // Two-segment dynamic routes
  it("returns label for /count/:id/mobile", () => {
    expect(getLabelForPath("/count/5/mobile")).toBe("Count Session");
  });

  // Receiving route: /receiving/:poId
  it("returns label for /receiving/:poId", () => {
    expect(getLabelForPath("/receiving/77")).toBe("Receive Delivery");
  });

  // Prefers longer (more specific) pattern over shorter prefix
  it("prefers /inventory-items/new over /inventory-items/:id", () => {
    expect(getLabelForPath("/inventory-items/new")).toBe("New Item");
  });

  it("prefers /inventory-items/par-levels over /inventory-items/:id", () => {
    expect(getLabelForPath("/inventory-items/par-levels")).toBe("Par Levels");
  });

  // Unmatched path
  it("returns undefined for an unrecognised path", () => {
    expect(getLabelForPath("/this/does/not/exist")).toBeUndefined();
  });
});

describe("role-gate enforcement", () => {
  const ROLE_ORDER: Record<string, number> = {
    store_manager: 1,
    company_admin: 2,
    global_admin: 3,
  };

  /** Returns true when `actual` satisfies `minimum` or higher. */
  function meetsMinimum(
    actual: string | undefined,
    minimum: "company_admin" | "global_admin"
  ): boolean {
    if (!actual) return false;
    return (ROLE_ORDER[actual] ?? 0) >= ROLE_ORDER[minimum];
  }

  it("every /admin/* route requires global_admin", () => {
    const adminRoutes = ROUTE_CONFIG.filter((r) =>
      r.route.startsWith("/admin/")
    );

    // Sanity-check: there must be at least one /admin/* route in the config.
    expect(adminRoutes.length).toBeGreaterThan(0);

    for (const r of adminRoutes) {
      expect(
        r.requiredRole,
        `Route "${r.route}" is under /admin/* but is missing requiredRole: "global_admin"`
      ).toBe("global_admin");
    }
  });

  it("every /companies* route requires at least company_admin", () => {
    const companyRoutes = ROUTE_CONFIG.filter((r) =>
      r.route === "/companies" || r.route.startsWith("/companies/")
    );

    // Sanity-check: there must be at least one /companies route in the config.
    expect(companyRoutes.length).toBeGreaterThan(0);

    for (const r of companyRoutes) {
      expect(
        meetsMinimum(r.requiredRole, "company_admin"),
        `Route "${r.route}" is under /companies* but requiredRole "${r.requiredRole ?? "undefined"}" does not meet minimum "company_admin"`
      ).toBe(true);
    }
  });
});
