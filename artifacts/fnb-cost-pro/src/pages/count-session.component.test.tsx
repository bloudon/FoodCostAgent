// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

const scrollIntoView = vi.fn();
const mutate = vi.fn();

const countLines = [
  {
    id: "line-zebra",
    inventoryItemId: "item-zebra",
    storageLocationId: "walk-in",
    storageLocationName: "Walk In",
    qty: 2,
    unitCost: 3,
    unitAbbreviation: "lb",
    entries: [],
    inventoryItem: { id: "item-zebra", name: "Zebra Squash", category: "Produce", categoryId: "produce", storageLocationId: "walk-in", unitName: "lb" },
  },
  {
    id: "line-apple",
    inventoryItemId: "item-apple",
    storageLocationId: "walk-in",
    storageLocationName: "Walk In",
    qty: 1,
    unitCost: 2,
    unitAbbreviation: "lb",
    entries: [],
    inventoryItem: { id: "item-apple", name: "Apple", category: "Produce", categoryId: "produce", storageLocationId: "walk-in", unitName: "lb" },
  },
  {
    id: "line-beef",
    inventoryItemId: "item-beef",
    storageLocationId: "freezer",
    storageLocationName: "Freezer",
    qty: 4,
    unitCost: 5,
    unitAbbreviation: "lb",
    entries: [],
    inventoryItem: { id: "item-beef", name: "Beef", category: "Meat", categoryId: "meat", storageLocationId: "freezer", unitName: "lb" },
  },
];
let extraPreviousLines: any[] = [];

vi.mock("wouter", () => ({
  useParams: () => ({ id: "count-1" }),
  useLocation: () => ["/count/count-1", vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { role: "manager" } }) }));
vi.mock("@/hooks/use-undoable-delete", () => ({
  useUndoableDelete: () => ({ deleteWithUndo: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const key = queryKey.join("/");
    if (key === "/api/inventory-counts/count-1") {
      return { data: { id: "count-1", countedAt: "2026-09-16T12:00:00Z", canEdit: true, applied: 0 }, isLoading: false };
    }
    if (key === "/api/inventory-count-lines/count-1") return { data: countLines, isLoading: false };
    if (key === "/api/inventory-counts/count-1/location-review") return {
      data: {
        warnings: [{
          lineId: "line-zebra",
          itemId: "item-zebra",
          itemName: "Zebra Squash",
          sourceItemCode: "ZS1",
          currentLocationName: "Walk In",
          supportedLocationName: null,
          qty: "2.00",
          caseQty: null,
          containerQty: null,
          looseUnits: null,
          entryCount: 1,
          reason: "Not configured for this location",
          eligibleForRemoval: true,
        }],
        canRemove: true,
        blockers: [],
      },
      isLoading: false
    };
    if (key === "/api/inventory-counts/count-1/previous-lines") {
      return {
        data: {
          previousCountId: "previous-count",
          previousCountDate: "2026-09-15T00:00:00.000Z",
          reconciliation: {
            locationUnmatchedLines: 1,
            ambiguousLocationLines: 0,
          },
          lines: [
            {
              id: "previous-zebra",
              inventoryItemId: "item-zebra",
              storageLocationId: "walk-in",
              qty: 0,
            },
            {
              id: "previous-apple",
              inventoryItemId: "item-apple",
              storageLocationId: "walk-in",
              qty: 5,
            },
             ...extraPreviousLines,
          ],
        },
      };
    }
    if (key === "/api/storage-locations") {
      return { data: [
        { id: "walk-in", name: "Walk In", sortOrder: 1, allowCaseCounting: 0 },
        { id: "freezer", name: "Freezer", sortOrder: 2, allowCaseCounting: 0 },
      ] };
    }
    if (key === "/api/categories") return { data: [{ id: "produce" }, { id: "meat" }] };
    if (key === "/api/inventory-items") return { data: countLines.map(line => line.inventoryItem) };
    if (key === "/api/units") return { data: [
      { id: "u-oz", name: "ounce", abbreviation: "oz", kind: "weight", toBaseRatio: 28.3495 },
      { id: "u-lb", name: "pound", abbreviation: "lb", kind: "weight", toBaseRatio: 453.592 },
    ] };
    return { data: undefined, isLoading: false };
  },
  useMutation: () => ({ mutate, isPending: false }),
}));

import CountSession from "./count-session";
import { generateCountSectionAnchor } from "@/lib/count-session-layout";

function namesInDocumentOrder() {
  return screen.getAllByTestId(/^button-edit-item-/).map(node => node.textContent?.trim());
}

describe("count session grouped entry layout", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/count/count-1");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    scrollIntoView.mockClear();
    mutate.mockClear();
    extraPreviousLines = [];
  });

  afterEach(cleanup);

  it("labels an unconfigured item's canonical unit and lets staff describe a 1.5-lb physical case", async () => {
    countLines.push({
      id: "line-arugula", inventoryItemId: "item-arugula", storageLocationId: "walk-in",
      storageLocationName: "Walk In", qty: 0, unitCost: 0.5,
      unitAbbreviation: "oz", entries: [],
      inventoryItem: {
        id: "item-arugula", name: "Arugula", category: "Produce", categoryId: "produce",
        unitId: "u-oz", unitName: "ounce", unitAbbreviation: "oz",
        countMode: "unconfigured", caseSize: 48, pricePerUnit: 0.5,
      },
    });
    try {
      render(<CountSession />);
      fireEvent.click(await screen.findByTestId("button-edit-item-item-arugula"));
      expect(screen.getByTestId("item-edit-unit-context")).toHaveTextContent("Stored inventory unit: oz");
      expect(screen.getByText("Catalog case size (oz) *")).toBeInTheDocument();
      expect(screen.getByTestId("input-item-case-size")).toHaveValue(48);
      fireEvent.click(screen.getByTestId("select-item-case-size-unit"));
      fireEvent.click(await screen.findByRole("option", { name: "lb" }));
      expect(screen.getByTestId("input-item-case-size")).toHaveValue(3);
      expect(screen.getByText("Catalog case size (lb) *")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("button-save-item"));
      expect(mutate.mock.calls[0][0]).toEqual(expect.objectContaining({ caseSize: 48 }));
      expect(mutate.mock.calls[0][0]).not.toHaveProperty("pricePerUnit");
      mutate.mockClear();
      fireEvent.click(screen.getByTestId("button-configure-count-package"));
      fireEvent.change(screen.getByTestId("input-item-package-size"), { target: { value: "48" } });
      fireEvent.click(screen.getByTestId("select-item-package-unit"));
      fireEvent.click(await screen.findByRole("option", { name: "lb" }));
      expect(screen.getByTestId("input-item-package-size")).toHaveValue(3);
      fireEvent.change(screen.getByTestId("input-item-package-size"), { target: { value: "1.5" } });
      fireEvent.change(screen.getByTestId("input-item-containers-per-case"), { target: { value: "1" } });
      expect(screen.getByTestId("item-case-conversion")).toHaveTextContent("One case = 1 × 1.5 lb = 24 oz");
      fireEvent.click(screen.getByTestId("button-save-item"));
      expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
        containerSize: 24, containerUnitId: "u-lb", casePkgCount: 1, caseSize: 24,
        containerLabel: "package",
      }));
      expect(mutate.mock.calls[0][0]).not.toHaveProperty("pricePerUnit");
    } finally {
      cleanup();
      countLines.pop();
    }
  });

  it("renders each location item title and quantity editor in the same compact row", async () => {
    render(<CountSession />);
    const row = await screen.findByTestId("compact-count-row-line-apple");
    expect(row).toContainElement(screen.getByTestId("button-edit-item-item-apple"));
    expect(row).toContainElement(screen.getByTestId("input-qty-line-apple"));
  });

  it("opens matching location and category accordions on search, then restores manual accordion state", async () => {
    render(<CountSession />);
    const search = screen.getByTestId("input-search-count-lines");
    const walkIn = screen.getByTestId("accordion-group-walk-in");
    fireEvent.click(walkIn);
    expect(walkIn).toHaveAttribute("data-state", "closed");

    fireEvent.change(search, { target: { value: "Apple" } });
    expect(screen.getByTestId("accordion-group-walk-in")).toHaveAttribute("data-state", "open");
    expect(screen.getByTestId("compact-count-row-line-apple")).toBeVisible();
    fireEvent.click(screen.getByTestId("accordion-group-walk-in"));
    expect(screen.getByTestId("accordion-group-walk-in")).toHaveAttribute("data-state", "closed");
    fireEvent.change(search, { target: { value: "Zebra" } });
    expect(screen.getByTestId("accordion-group-walk-in")).toHaveAttribute("data-state", "open");
    expect(screen.getByTestId("compact-count-row-line-zebra")).toBeVisible();

    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByTestId("accordion-group-walk-in")).toHaveAttribute("data-state", "closed");
    fireEvent.change(search, { target: { value: "Apple" } });
    expect(screen.getByTestId("accordion-group-walk-in")).toHaveAttribute("data-state", "open");
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByTestId("accordion-group-walk-in")).toHaveAttribute("data-state", "closed");
    fireEvent.click(screen.getByTestId("button-group-category"));
    const produce = screen.getByTestId("accordion-group-Produce");
    fireEvent.click(produce);
    expect(produce).toHaveAttribute("data-state", "closed");
    fireEvent.change(search, { target: { value: "Apple" } });
    expect(screen.getByTestId("accordion-group-Produce")).toHaveAttribute("data-state", "open");
    expect(screen.getByTestId("item-group-item-apple")).toBeVisible();
  });

  it("shows physical totals and converted prices throughout desktop views without changing valuation", async () => {
    const packageLines = [
      {
        id: "line-wine", inventoryItemId: "item-wine", storageLocationId: "walk-in",
        storageLocationName: "Walk In", qty: 10500, unitCost: 0.01,
        unitAbbreviation: "mL", caseQty: 1, containerQty: 2, looseUnits: 0,
        entries: [], inventoryItem: {
          id: "item-wine", name: "House Wine", category: "Beverages", categoryId: "beverages",
          countMode: "package", containerSize: 750, casePkgCount: 12, containerLabel: "bottle",
          unitName: "mL",
        },
      },
      {
        id: "line-oat", inventoryItemId: "item-oat", storageLocationId: "walk-in",
        storageLocationName: "Walk In", qty: 64, unitCost: 0.25,
        unitAbbreviation: "oz", caseQty: 0, containerQty: 2, looseUnits: 0,
        entries: [], inventoryItem: {
          id: "item-oat", name: "Oat Cartons", category: "Beverages", categoryId: "beverages",
          countMode: "package", containerSize: 32, casePkgCount: 6, containerLabel: "carton",
          unitName: "oz",
        },
      },
    ];
    countLines.push(...packageLines);
    extraPreviousLines = [{
      id: "previous-wine", inventoryItemId: "item-wine",
      storageLocationId: "walk-in", qty: 750, unitAbbreviation: "mL",
      caseQty: null, containerQty: null, looseUnits: null,
    }];
    try {
      render(<CountSession />);
      const wine = await screen.findByTestId("compact-count-row-line-wine");
      expect(wine).toHaveTextContent("1 case = 12 bottles");
      expect(wine).toHaveTextContent("$7.50/bottle");
      expect(screen.getByTestId("link-previous-line-wine")).toHaveTextContent("Historical: 750.00 mL (review)");
      expect(screen.queryByTestId("button-add-more-line-wine")).not.toBeInTheDocument();
      expect(screen.getByTestId("compact-count-row-line-oat")).toHaveTextContent("$8.00/carton");

      fireEvent.click(screen.getByTestId("button-group-category"));
      expect(screen.getByTestId("text-item-total-qty-item-wine")).toHaveTextContent("14 bottles");
      expect(screen.getByTestId("text-item-unit-price-item-wine")).toHaveTextContent("$7.50/bottle");
      expect(screen.getByTestId("text-item-total-value-item-wine")).toHaveTextContent("$105.00");
      expect(screen.getByTestId("text-category-previous-line-wine")).toHaveTextContent("Historical: 750.00 mL (review)");

      fireEvent.click(screen.getByTestId("button-group-all-entries"));
      expect(screen.getByTestId("text-entry-qty-line-wine")).toHaveTextContent("1 case + 2 bottles");
      expect(screen.getByTestId("text-entry-qty-line-oat")).toHaveTextContent("2 cartons");
      expect(screen.getByTestId("text-entry-value-line-wine")).toHaveTextContent("$105.00");
    } finally {
      countLines.splice(-packageLines.length);
    }
  });

  it("sorts item names ascending and descending without changing location section order", async () => {
    render(<CountSession />);
    await screen.findByTestId("compact-count-row-line-apple");
    expect(namesInDocumentOrder()).toEqual(["Apple", "Zebra Squash", "Beef"]);

    fireEvent.click(screen.getByTestId("button-sort-grouped-items"));
    expect(namesInDocumentOrder()).toEqual(["Zebra Squash", "Apple", "Beef"]);

    const sectionNames = screen.getAllByTestId(/^accordion-group-/).map(node => node.textContent);
    expect(sectionNames[0]).toContain("Walk In");
    expect(sectionNames[1]).toContain("Freezer");
  });

  it("keeps quantity entry and Enter-to-advance working in sorted compact rows", async () => {
    render(<CountSession />);
    const appleInput = await screen.findByTestId("input-qty-line-apple");
    const zebraInput = screen.getByTestId("input-qty-line-zebra");

    fireEvent.focus(appleInput);
    fireEvent.change(appleInput, { target: { value: "7.5" } });
    fireEvent.keyDown(appleInput, { key: "Enter" });

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ id: "line-apple", qty: 7.5 }));
    await waitFor(() => expect(zebraInput).toHaveFocus());
  });

  it("loads a supported direct category anchor after data renders", async () => {
    const anchor = generateCountSectionAnchor("category", "Meat");
    window.history.replaceState(null, "", `/count/count-1#${anchor}`);
    render(<CountSession />);

    await waitFor(() => expect(document.getElementById(anchor)).toBeInTheDocument());
    expect(screen.getByTestId("item-group-item-beef")).toBeInTheDocument();
    expect(screen.queryByTestId("item-group-item-apple")).not.toBeInTheDocument();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("updates the named anchor and grouping when a location summary is selected", async () => {
    render(<CountSession />);
    fireEvent.click(screen.getByText("Locations"));
    const locationCard = await screen.findByTestId("card-location-freezer");
    fireEvent.click(locationCard);

    const anchor = generateCountSectionAnchor("location", "freezer");
    await waitFor(() => expect(window.location.hash).toBe(`#${anchor}`));
    expect(document.getElementById(anchor)).toBeInTheDocument();
    expect(screen.getByTestId("compact-count-row-line-beef")).toBeInTheDocument();
    expect(screen.queryByTestId("compact-count-row-line-apple")).not.toBeInTheDocument();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("does not restore a consumed anchor after deselecting, clearing, or switching views", async () => {
    render(<CountSession />);
    fireEvent.click(screen.getByText("Locations"));
    const locationCard = await screen.findByTestId("card-location-freezer");
    fireEvent.click(locationCard);
    await screen.findByTestId("compact-count-row-line-beef");

    fireEvent.click(locationCard);
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(screen.getByTestId("compact-count-row-line-apple")).toBeInTheDocument();

    fireEvent.click(locationCard);
    await waitFor(() => expect(window.location.hash).not.toBe(""));
    fireEvent.click(screen.getByTestId("button-clear-filters"));
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(screen.getByTestId("compact-count-row-line-apple")).toBeInTheDocument();

    fireEvent.click(locationCard);
    await waitFor(() => expect(window.location.hash).not.toBe(""));
    fireEvent.click(screen.getByTestId("button-group-all-entries"));
    await waitFor(() => expect(screen.getByTestId("table-all-entries")).toBeInTheDocument());
    expect(window.location.hash).toBe("");
  });

  it("shows the prior quantity and filters every desktop grouping to prior nonzero lines", async () => {
    render(<CountSession />);

    expect(await screen.findByTestId("text-previous-count-date"))
      .toHaveTextContent(`From ${new Date(2026, 8, 15).toLocaleDateString()}`);
    expect(await screen.findByTestId("link-previous-line-apple"))
      .toHaveTextContent("Last count: 5.00 lb");
    expect(screen.getByTestId("link-previous-line-zebra"))
      .toHaveTextContent("Last count: 0.00 lb");
    expect(screen.getByTestId("text-location-previous-line-beef"))
      .toHaveTextContent("Last count: No prior count");

    fireEvent.click(screen.getByTestId("button-filter-previous-nonzero"));
    expect(screen.getByTestId("compact-count-row-line-apple")).toBeInTheDocument();
    expect(screen.queryByTestId("compact-count-row-line-zebra")).not.toBeInTheDocument();
    expect(screen.queryByTestId("compact-count-row-line-beef")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-group-all-entries"));
    expect(screen.getByTestId("text-entry-previous-line-apple"))
      .toHaveTextContent("5.00 lb");
    expect(screen.queryByTestId("row-entry-line-zebra")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-group-category"));
    expect(screen.getByTestId("text-category-previous-line-apple"))
      .toHaveTextContent("Last count: 5.00 lb");
    expect(screen.queryByTestId("location-input-line-zebra")).not.toBeInTheDocument();
  });

  it("opens location review dialog when warning banner is clicked", async () => {
    render(<CountSession />);

    // Warning banner should be present due to locationUnmatchedLines = 1
    const banner = screen.getByTestId("alert-previous-location-unmatched");
    expect(banner).toBeInTheDocument();

    // Click review button
    const reviewBtn = screen.getByText("Review Locations");
    fireEvent.click(reviewBtn);

    // Check that dialog opens and shows warning content
    await waitFor(() => {
      expect(screen.getByText("Location Review")).toBeInTheDocument();
      expect(screen.getAllByText("Zebra Squash").length).toBeGreaterThan(0);
      expect(screen.getByText("Eligible for removal")).toBeInTheDocument();
      expect(screen.getByText("Not configured for this location")).toBeInTheDocument();
    });
  });
});