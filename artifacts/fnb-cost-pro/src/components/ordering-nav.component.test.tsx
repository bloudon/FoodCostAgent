// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";

vitestExpect.extend(matchers);

const state = vi.hoisted(() => ({
  location: "/order",
  role: "store_manager",
  stores: [{ id: "store-1" }, { id: "store-2" }],
  hasFeature: true,
}));

vi.mock("wouter", () => ({
  useLocation: () => [state.location, vi.fn()],
  Link: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { role: state.role } }),
}));

vi.mock("@/hooks/use-store-context", () => ({
  useStoreContext: () => ({ stores: state.stores }),
}));

vi.mock("@/hooks/use-tier", () => ({
  useTier: () => ({ hasFeature: () => state.hasFeature }),
}));

import { isOrderingRoute, OrderingSectionNav } from "./ordering-nav";

afterEach(() => {
  cleanup();
  state.location = "/order";
  state.role = "store_manager";
  state.stores = [{ id: "store-1" }, { id: "store-2" }];
  state.hasFeature = true;
});

describe("isOrderingRoute", () => {
  it.each([
    "/order",
    "/orders",
    "/purchase-orders/po-1",
    "/imported-invoices/invoice-1?from=orders",
    "/vendors/vendor-1",
    "/receiving",
    "/receiving/po-1",
    "/order-guide-scan?step=2",
    "/order-guides/guide-1/review",
    "/transfer-orders/transfer-1",
  ])("recognizes %s as Ordering-owned", (path) => {
    expect(isOrderingRoute(path)).toBe(true);
  });

  it.each(["/", "/settings", "/inventory-items", "/orderly-import"])(
    "does not claim %s for Ordering",
    (path) => {
      expect(isOrderingRoute(path)).toBe(false);
    }
  );
});

describe("OrderingSectionNav", () => {
  it("keeps the destination links and active state in sync", () => {
    state.location = "/receiving/po-1";
    render(<OrderingSectionNav />);

    const nav = screen.getByTestId("order-secondary-tabs");
    expect(within(nav).getByTestId("tab-order-receiving")).toHaveAttribute(
      "href",
      "/receiving"
    );
    expect(within(nav).getByTestId("tab-order-receiving")).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(nav).getByTestId("tab-order-orders")).not.toHaveAttribute(
      "aria-current"
    );
    expect(within(nav).getByTestId("tab-order-update-vendor-prices")).toHaveAttribute(
      "href",
      "/order-guide-scan"
    );
  });

  it.each([
    ["/order", "tab-order-overview"],
    ["/purchase-orders/po-1", "tab-order-orders"],
    ["/imported-invoices/invoice-1?from=orders", "tab-order-orders"],
    ["/vendors/vendor-1", "tab-order-vendors"],
    ["/order-guides/guide-1/review", "tab-order-update-vendor-prices"],
    ["/transfer-orders/transfer-1", "tab-order-transfers"],
  ])("marks %s with the correct active tab", (path, activeTestId) => {
    state.location = path;
    render(<OrderingSectionNav />);

    expect(screen.getByTestId(activeTestId)).toHaveAttribute("aria-current", "page");
  });

  it("applies manager-only Receiving and feature-gated Transfers visibility", () => {
    render(<OrderingSectionNav />);

    expect(screen.getByTestId("tab-order-receiving")).toBeInTheDocument();
    expect(screen.getByTestId("tab-order-transfers")).toBeInTheDocument();
  });

  it("hides Receiving and Transfers when access is unavailable", () => {
    state.role = "store_user";
    state.stores = [{ id: "store-1" }];
    state.hasFeature = false;
    render(<OrderingSectionNav />);

    expect(screen.queryByTestId("tab-order-receiving")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-order-transfers")).not.toBeInTheDocument();
  });

  it("wraps tabs instead of creating a navigation scrollbar", () => {
    render(<OrderingSectionNav />);

    const nav = screen.getByTestId("order-secondary-tabs");
    expect(nav).toHaveAttribute("data-ordering-nav", "true");
    expect(nav).toHaveAttribute("aria-label", "Ordering");
    expect(nav.firstElementChild).toHaveClass("flex-wrap", "min-w-0");
    expect(nav).toHaveClass("bg-muted/20", "border-b");
  });
});