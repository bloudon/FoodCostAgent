// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

const scrollTo = vi.fn();

const countLines = [
  {
    id: "line-apple",
    inventoryItemId: "apple",
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
    inventoryItemId: "beef",
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
  {
    id: "line-wine",
    inventoryItemId: "wine",
    storageLocationId: "walk-in",
    qty: 10500,
    unitId: "ml-current",
    unitCost: 0.01,
    unitAbbreviation: "mL",
    caseQty: 1,
    containerQty: 2,
    looseUnits: 0,
    entries: [],
    inventoryItem: {
      id: "wine",
      name: "House Wine",
      category: "Beverages",
      categoryId: "beverages",
      storageLocationId: "walk-in",
      unitName: "mL",
      countMode: "package",
      casePkgCount: 12,
      containerSize: 750,
      containerLabel: "bottle",
      sourcePackSizeRaw: "1/3 GAL",
    },
  },
  {
    id: "line-milk",
    inventoryItemId: "milk",
    storageLocationId: "walk-in",
    qty: 0,
    unitCost: 0.01,
    unitAbbreviation: "mL",
    caseQty: null,
    containerQty: null,
    looseUnits: null,
    entries: [],
    inventoryItem: {
      id: "milk",
      name: "Oat Milk",
      category: "Beverages",
      categoryId: "beverages",
      storageLocationId: "walk-in",
      unitName: "mL",
      countMode: "package",
      casePkgCount: 6,
      containerSize: 946,
      containerLabel: "carton",
    },
  },
  {
    id: "line-whiskey",
    inventoryItemId: "whiskey",
    storageLocationId: "cellar",
    storageLocationName: "Cellar",
    qty: 0,
    unitCost: 0.02,
    unitAbbreviation: "mL",
    entries: [],
    inventoryItem: {
      id: "whiskey",
      name: "House Whiskey",
      category: "Spirits",
      categoryId: "spirits",
      storageLocationId: "cellar",
      storageLocationName: "Cellar",
      unitName: "mL",
    },
  },
];
let mobileLines = countLines.map((line) => ({ ...line }));
let previousWineUnitId = "ml-current";
let scheduledDelete: any;

vi.mock("wouter", () => ({
  useParams: () => ({ id: "count-1" }),
  useLocation: () => ["/count/count-1/mobile", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-undoable-delete", () => ({
  useUndoableDelete: () => (options: any) => {
    options.onOptimisticRemove?.();
    scheduledDelete = options;
  },
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: {
    getQueryData: vi.fn(() => mobileLines),
    setQueryData: vi.fn((_key, update) => {
      mobileLines = typeof update === "function" ? update(mobileLines) : update;
    }),
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
    if (key === "/api/inventory-count-lines/count-1/mobile-compact") {
      return { data: mobileLines, isLoading: false };
    }
    if (key === "/api/inventory-counts/count-1/previous-lines") {
      return {
        data: {
          previousCountId: "previous-count",
          previousCountDate: "2026-09-15T00:00:00.000Z",
          reconciliation: { locationUnmatchedLines: 1, ambiguousLocationLines: 0 },
          lines: [
            {
              id: "previous-apple",
              inventoryItemId: "apple",
              storageLocationId: "walk-in",
              qty: 3,
            },
            {
              id: "previous-beef",
              inventoryItemId: "beef",
              storageLocationId: "walk-in",
              qty: 0,
            },
            {
              id: "previous-wine",
              inventoryItemId: "wine",
              storageLocationId: "walk-in",
              qty: 10500,
               unitId: previousWineUnitId,
              unitAbbreviation: "mL",
              caseQty: 1,
              containerQty: 2,
              looseUnits: 0,
            },
            {
              id: "previous-whiskey",
              inventoryItemId: "whiskey",
              storageLocationId: "cellar",
              qty: 750,
            },
          ],
        },
        isLoading: false,
      };
    }
    if (key === "/api/inventory-counts/count-1/location-review") {
      return {
        data: {
          warnings: [{
            lineId: "line-milk", itemId: "milk", itemName: "Oat Milk",
            sourceItemCode: "M1", currentLocationName: "Walk In",
            supportedLocationName: null, qty: 0, caseQty: null,
            containerQty: null, looseUnits: null, entryCount: 0,
            reason: "Prior item history has no safe match for this current location.",
            eligibleForRemoval: false,
          }],
          canRemove: false, blockers: [],
        },
        isLoading: false,
      };
    }
    if (key === "/api/storage-locations") {
      return {
        data: [
          {
            id: "walk-in",
            name: "Walk In",
            sortOrder: 1,
            allowCaseCounting: 0,
          },
          {
            id: "cellar",
            name: "Cellar",
            sortOrder: 2,
            allowCaseCounting: 0,
          },
          {
            id: "dry-storage",
            name: "Dry Storage",
            sortOrder: 3,
            allowCaseCounting: 0,
          },
        ],
        isLoading: false,
      };
    }
    if (key === "/api/categories") {
      return {
        data: [
          { id: "produce" },
          { id: "meat" },
          { id: "beverages" },
          { id: "spirits" },
          { id: "bakery" },
        ],
        isLoading: false,
      };
    }
    return { data: undefined, isLoading: false };
  },
  useMutation: ({ mutationFn, onSuccess, onError }: any) => ({
    mutate: (data: any, options?: any) => {
      Promise.resolve().then(() => mutationFn(data))
        .then((result) => {
          onSuccess?.(result);
          options?.onSuccess?.(result);
        })
        .catch((error) => onError?.(error));
    },
    isPending: false,
  }),
}));

import { apiRequest, queryClient } from "@/lib/queryClient";
import CountSessionMobile from "./count-session-mobile";

describe("mobile count category navigation", () => {
  beforeEach(() => {
    mobileLines = countLines.map((line) => ({ ...line }));
    previousWineUnitId = "ml-current";
    scheduledDelete = null;
    vi.mocked(apiRequest).mockReset();
    vi.mocked(queryClient.setQueryData).mockClear();
    scrollTo.mockClear();
    Element.prototype.scrollTo = scrollTo;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(cleanup);

  it("opens a read-only location review from the mobile warning", async () => {
    render(<CountSessionMobile />);
    fireEvent.click(screen.getByTestId("alert-mobile-previous-location-unmatched"));
    expect(await screen.findByText("Location Review")).toBeInTheDocument();
    expect(screen.getByText("Prior item history has no safe match for this current location.")).toBeInTheDocument();
    expect(screen.queryByText("Remove two unsupported assignments")).not.toBeInTheDocument();
  });

  it.skip("uses non-sticky anchors for forward and backward category jumps", async () => {
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

  it("shows counted package items in cases and practical containers", async () => {
    render(<CountSessionMobile />);

     expect((await screen.findAllByText("1 case + 2 bottles")).length).toBeGreaterThan(0);
     expect(screen.getByText("1 case = 12 bottles")).toBeInTheDocument();
    expect(screen.queryByText("10500.00 milliliters")).not.toBeInTheDocument();
    expect(screen.getByTestId("text-mobile-previous-count-line-wine"))
      .toHaveTextContent("Same as last");
     fireEvent.click(screen.getByTestId("button-mobile-item-line-wine"));
     expect(screen.getByText("$7.50/bottle")).toBeInTheDocument();
     expect(screen.getAllByText("1 case + 2 bottles").length).toBeGreaterThan(0);
     expect(screen.queryByText(/750 mL/)).not.toBeInTheDocument();
     expect(screen.getByText("= 14 bottles")).toBeInTheDocument();
  });

  it("flags changed previous unit IDs rather than claiming the package total is comparable", async () => {
    previousWineUnitId = "ml-previous";
    render(<CountSessionMobile />);
    expect(await screen.findByTestId("text-mobile-previous-count-line-wine"))
      .toHaveTextContent("Historical: 10500.00");
    fireEvent.click(screen.getByTestId("button-mobile-item-line-wine"));
    expect(screen.getByRole("button", { name: "Same as last" })).toBeDisabled();
    expect(screen.getByText(/Prior count needs review; change unavailable/)).toBeInTheDocument();
  });

  it("leaves package inputs blank when a saved line has an older unit ID", async () => {
    const wineIndex = mobileLines.findIndex((line) => line.id === "line-wine");
    mobileLines[wineIndex] = {
      ...mobileLines[wineIndex],
      unitId: "ml-previous",
      inventoryItem: { ...mobileLines[wineIndex].inventoryItem, unitId: "ml-current" },
    };
    render(<CountSessionMobile />);
    expect(await screen.findByTestId("button-mobile-item-line-wine"))
      .toHaveTextContent("Historical: 10500.00 mL (review)");
    fireEvent.click(screen.getByTestId("button-mobile-item-line-wine"));
    expect(screen.getByRole("button", { name: /Save & next/ })).toBeDisabled();
    expect(screen.queryByText("= 14 bottles")).not.toBeInTheDocument();
  });

  it("uses a neutral physical unit without a configured label and blocks missing geometry", async () => {
    mobileLines[3] = {
      ...mobileLines[3],
      inventoryItem: { ...mobileLines[3].inventoryItem, containerLabel: null },
    };
    mobileLines[4] = {
      ...mobileLines[4],
      inventoryItem: { ...mobileLines[4].inventoryItem, countMode: "unconfigured", containerSize: null, casePkgCount: 6 },
    };
    render(<CountSessionMobile />);
    fireEvent.click(await screen.findByTestId("button-mobile-item-line-milk"));
    expect(screen.getByText("containers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close count entry" }));
    fireEvent.click(screen.getByTestId("button-mobile-location-cellar"));
    expect(screen.getByTestId("button-mobile-item-line-whiskey")).toHaveTextContent("Counting setup required");
    fireEvent.click(screen.getByTestId("button-mobile-item-line-whiskey"));
    expect(screen.queryByRole("button", { name: /Save & next/ })).not.toBeInTheDocument();
  });

  it("shows prior quantities and filters to lines that were nonzero last count", async () => {
    render(<CountSessionMobile />);

    expect(await screen.findByTestId("text-mobile-previous-count-line-apple"))
      .toHaveTextContent("last 3.00");
    expect(screen.getByTestId("text-mobile-previous-count-line-beef"))
      .toHaveTextContent("last 0.00");
    expect(screen.getByTestId("text-mobile-previous-count-line-milk"))
       .toHaveTextContent("No prior count");

    fireEvent.click(screen.getByTestId("button-mobile-filter-open"));
    fireEvent.click(screen.getByTestId("button-mobile-filter-previous-nonzero"));

    expect(screen.getByTestId("text-mobile-item-name-line-apple")).toBeInTheDocument();
    expect(screen.getByTestId("text-mobile-item-name-line-wine")).toBeInTheDocument();
    expect(screen.queryByTestId("text-mobile-item-name-line-beef")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-mobile-item-name-line-milk")).not.toBeInTheDocument();
    expect(screen.getByTestId("filter-chip-previous-nonzero")).toBeInTheDocument();
  });

  it("keeps Home on the left and exposes grouped active-session search results", async () => {
    render(<CountSessionMobile />);

    const toolbar = await screen.findByTestId("mobile-session-toolbar");
    const home = screen.getByTestId("button-mobile-home");
    const search = screen.getByTestId("input-mobile-item-search");

    expect(toolbar.firstElementChild).toBe(home);
    expect(search).toHaveAttribute("placeholder", "Search or scan…");

    fireEvent.change(search, { target: { value: "beef" } });

    expect(screen.getByText("Items in this session")).toBeInTheDocument();
    expect(screen.getByTestId("search-result-item-line-beef")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-clear-mobile-item-search"));
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });

  it("filters by location, category, and item results from the active session", async () => {
    render(<CountSessionMobile />);
    const search = await screen.findByTestId("input-mobile-item-search");

    fireEvent.change(search, { target: { value: "cell" } });
    fireEvent.click(screen.getByTestId("search-result-location-cellar"));
    expect(screen.getByTestId("text-mobile-item-name-line-whiskey")).toBeInTheDocument();
    expect(screen.queryByTestId("text-mobile-item-name-line-apple")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "spirit" } });
    fireEvent.click(screen.getByTestId("search-result-category-Spirits"));
    expect(screen.getByTestId("filter-chip-category")).toHaveTextContent("Spirits");

    fireEvent.change(search, { target: { value: "apple" } });
    fireEvent.click(screen.getByTestId("search-result-item-line-apple"));
    expect(screen.getByTestId("filter-chip-category")).toHaveTextContent("Produce");
    expect(screen.getByTestId("filter-chip-item")).toHaveTextContent("Apple");
    expect(screen.getByTestId("text-mobile-item-name-line-apple")).toBeInTheDocument();
    expect(screen.queryByTestId("text-mobile-item-name-line-beef")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("filter-chip-item"));
    expect(screen.getByTestId("text-mobile-item-name-line-apple")).toBeInTheDocument();
  });

  it("never surfaces locations or categories that are outside the active session", async () => {
    render(<CountSessionMobile />);
    const search = await screen.findByTestId("input-mobile-item-search");

    fireEvent.change(search, { target: { value: "dry storage" } });
    expect(screen.queryByTestId("search-result-location-dry-storage")).not.toBeInTheDocument();
    expect(screen.getByText(/No locations, categories, or items in this session/)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "bakery" } });
    expect(screen.queryByTestId("search-result-category-Bakery")).not.toBeInTheDocument();
    expect(screen.getByText(/No locations, categories, or items in this session/)).toBeInTheDocument();
  });

  it("keeps empty input unsaved, then saves an explicit zero after Clear and advances", async () => {
    mobileLines[0] = {
      ...mobileLines[0],
      qty: 4,
      entries: [{ id: "entry-apple", qty: 4, enteredAt: new Date().toISOString() }],
    };
    vi.mocked(apiRequest).mockResolvedValue({
      json: async () => ({
        id: "line-apple", qty: 0,
        entries: [{ id: "zero-apple", qty: 0, enteredAt: new Date().toISOString() }],
      }),
    } as Response);
    const view = render(<CountSessionMobile />);
    fireEvent.click(await screen.findByTestId("button-mobile-item-line-apple"));
    expect(screen.getByTestId("mobile-entry-row-entry-apple")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear", exact: true }));
    expect(screen.getByText(/No quantity entered/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save & next/ })).toBeDisabled();
    expect(apiRequest).not.toHaveBeenCalledWith("PATCH", expect.anything(), expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "0", exact: true }));
    expect(screen.getByRole("button", { name: /Save & next/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Save & next/ }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "PATCH", "/api/inventory-count-lines/line-apple",
      expect.objectContaining({ qty: 0, accumulate: false }),
    ));
    await waitFor(() => expect(queryClient.setQueryData).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Beef" })).toBeInTheDocument();
    expect(mobileLines[0].qty).toBe(0);
    expect(mobileLines[0].entries).toEqual([
      expect.objectContaining({ id: "zero-apple", qty: 0 }),
    ]);
    view.unmount();
    render(<CountSessionMobile />);
    expect(screen.getByText("2 of 5 counted")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-mobile-item-line-apple"));
    expect(screen.getByTestId("mobile-entry-row-zero-apple")).toBeInTheDocument();
  });

  it("removes saved entries without marking a cleared item as counted", async () => {
    mobileLines[0] = {
      ...mobileLines[0],
      qty: 4,
      entries: [{ id: "entry-apple", qty: 4, enteredAt: new Date().toISOString() }],
    };
    vi.mocked(apiRequest).mockResolvedValue({
      json: async () => ({
        id: "line-apple", qty: 0, caseQty: null, containerQty: null,
        looseUnits: null, entries: [],
      }),
    } as Response);
    const view = render(<CountSessionMobile />);
    fireEvent.click(screen.getByTestId("button-mobile-item-line-apple"));
    fireEvent.click(screen.getByTestId("button-mobile-clear-all-entries"));
    expect(screen.getByText(/leaves this item uncounted/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-mobile-confirm-clear"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "POST", "/api/inventory-count-lines/line-apple/clear",
    ));
    await waitFor(() => expect(mobileLines[0].entries).toEqual([]));
    view.unmount();
    render(<CountSessionMobile />);
    expect(screen.getByText("1 of 5 counted")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-mobile-item-line-apple"));
    expect(screen.queryByTestId("button-mobile-clear-all-entries")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save & next/ })).toBeDisabled();
  });

  it("updates the compact count cache immediately when an entry is removed", async () => {
    mobileLines[0] = {
      ...mobileLines[0],
      qty: 4,
      entries: [{ id: "entry-apple", qty: 4, enteredAt: new Date().toISOString() }],
    };
    const view = render(<CountSessionMobile />);
    fireEvent.click(screen.getByTestId("button-mobile-item-line-apple"));
    fireEvent.click(screen.getByTestId("button-mobile-delete-entry-entry-apple"));
    expect(mobileLines[0]).toMatchObject({ qty: 0, entries: [] });
    view.rerender(<CountSessionMobile />);
    expect(screen.queryByTestId("mobile-entry-row-entry-apple")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 5 counted")).toBeInTheDocument();
  });

  it("restores an optimistic entry removal if its server delete fails", async () => {
    mobileLines[0] = {
      ...mobileLines[0],
      qty: 4,
      entries: [{ id: "entry-apple", qty: 4, enteredAt: new Date().toISOString() }],
    };
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("Network unavailable"));
    const view = render(<CountSessionMobile />);
    fireEvent.click(screen.getByTestId("button-mobile-item-line-apple"));
    fireEvent.click(screen.getByTestId("button-mobile-delete-entry-entry-apple"));
    expect(mobileLines[0].qty).toBe(0);
    await expect(scheduledDelete.onCommit()).rejects.toThrow("Network unavailable");
    expect(mobileLines[0].qty).toBe(4);
    view.rerender(<CountSessionMobile />);
    expect(screen.getByTestId("mobile-entry-row-entry-apple")).toBeInTheDocument();
  });

  it("saves an explicit package zero as package quantities", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      json: async () => ({
        id: "line-wine", qty: 0, caseQty: 0, containerQty: 0, looseUnits: 0,
        entries: [{ id: "zero-wine", qty: 0, enteredAt: new Date().toISOString() }],
      }),
    } as Response);
    render(<CountSessionMobile />);
    fireEvent.click(screen.getByTestId("button-mobile-item-line-wine"));
    fireEvent.click(screen.getByRole("button", { name: "Clear", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Field →" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear", exact: true }));
    expect(screen.getByRole("button", { name: /Save & next/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "0", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: /Save & next/ }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "PATCH", "/api/inventory-count-lines/line-wine",
      expect.objectContaining({ qty: 0, caseQty: 0, containerQty: 0, looseUnits: 0 }),
    ));
  });

  it("replaces catch-weight entries only on explicit zero, never on blank", async () => {
    mobileLines[4] = {
      ...mobileLines[4],
      qty: 5,
      entries: [{ id: "weight-1", qty: 5, enteredAt: new Date().toISOString() }],
      inventoryItem: { ...mobileLines[4].inventoryItem, countMode: "catch" },
    };
    vi.mocked(apiRequest).mockResolvedValue({
      json: async () => ({
        id: "line-whiskey", qty: 0,
        entries: [{ id: "zero-whiskey", qty: 0, enteredAt: new Date().toISOString() }],
      }),
    } as Response);
    render(<CountSessionMobile />);
    fireEvent.click(screen.getByTestId("button-mobile-location-cellar"));
    fireEvent.click(screen.getByTestId("button-mobile-item-line-whiskey"));
    expect(screen.getByRole("button", { name: /Save & next/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "0", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: /Save & next/ }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "PATCH", "/api/inventory-count-lines/line-whiskey",
      expect.objectContaining({ qty: 0, accumulate: false }),
    ));
    expect(vi.mocked(apiRequest).mock.calls.some((call) =>
      call[2] && "addQty" in (call[2] as object) && (call[2] as any).addQty > 0,
    )).toBe(false);
  });
});