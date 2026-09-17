// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

const scrollTo = vi.fn();

const countLines = [
  {
    id: "line-apple",
    storageLocationId: "walk-in",
    qty: 0,
    unitCost: 2,
    unitAbbreviation: "lb",
    entries: [],
    inventoryItem: {
      id: "apple",
      name: "Apple",
      category: "Produce",
      categoryId: "produce",
      storageLocationId: "walk-in",
      unitName: "lb",
    },
  },
  {
    id: "line-beef",
    storageLocationId: "walk-in",
    qty: 0,
    unitCost: 5,
    unitAbbreviation: "lb",
    entries: [],
    inventoryItem: {
      id: "beef",
      name: "Beef",
      category: "Meat",
      categoryId: "meat",
      storageLocationId: "walk-in",
      unitName: "lb",
    },
  },
];

vi.mock("wouter", () => ({
  useParams: () => ({ id: "count-1" }),
  useLocation: () => ["/count/count-1/mobile", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-undoable-delete", () => ({
  useUndoableDelete: () => vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: {
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const key = queryKey.join("/");
    if (key === "/api/inventory-counts/count-1") {
      return {
        data: {
          id: "count-1",
          storeName: "Test Store",
          canEdit: true,
          applied: 0,
        },
        isLoading: false,
      };
    }
    if (key === "/api/inventory-count-lines/count-1") {
      return { data: countLines, isLoading: false };
    }
    if (key === "/api/storage-locations") {
      return {
        data: [{
          id: "walk-in",
          name: "Walk In",
          sortOrder: 1,
          allowCaseCounting: 0,
        }],
        isLoading: false,
      };
    }
    if (key === "/api/categories") {
      return {
        data: [{ id: "produce" }, { id: "meat" }],
        isLoading: false,
      };
    }
    return { data: undefined, isLoading: false };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

import CountSessionMobile from "./count-session-mobile";

describe("mobile count category navigation", () => {
  beforeEach(() => {
    scrollTo.mockClear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
  });

  afterEach(cleanup);

  it("uses non-sticky anchors for forward and backward category jumps", async () => {
    render(<CountSessionMobile />);

    const list = await screen.findByTestId("mobile-item-list");
    const meatHeading = screen.getByTestId("mobile-category-section-Meat");
    const meatAnchor = document.getElementById("mobile-category-Meat")!;
    const produceHeading = screen.getByTestId("mobile-category-section-Produce");
    const produceAnchor = document.getElementById("mobile-category-Produce")!;
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(list, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      top: 240,
    } as DOMRect);
    vi.spyOn(meatAnchor, "getBoundingClientRect").mockReturnValue({
      top: 540,
    } as DOMRect);

    fireEvent.click(screen.getByTestId("button-mobile-category-Meat"));

    expect(scrollTo).toHaveBeenCalledWith({ top: 420, behavior: "auto" });
    expect(meatHeading).toHaveFocus();

    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      value: 420,
    });
    vi.spyOn(produceAnchor, "getBoundingClientRect").mockReturnValue({
      top: -60,
    } as DOMRect);

    fireEvent.click(screen.getByTestId("button-mobile-category-Produce"));

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 120, behavior: "auto" });
    expect(produceHeading).toHaveFocus();
  });
});