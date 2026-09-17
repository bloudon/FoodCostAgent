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
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const key = queryKey.join("/");
    if (key === "/api/inventory-counts/count-1") {
      return { data: { id: "count-1", countedAt: "2026-09-16T12:00:00Z", canEdit: true, applied: 0 }, isLoading: false };
    }
    if (key === "/api/inventory-count-lines/count-1") return { data: countLines, isLoading: false };
    if (key === "/api/inventory-counts/count-1/previous-lines") return { data: { previousCountId: null, lines: [] } };
    if (key === "/api/storage-locations") {
      return { data: [
        { id: "walk-in", name: "Walk In", sortOrder: 1, allowCaseCounting: 0 },
        { id: "freezer", name: "Freezer", sortOrder: 2, allowCaseCounting: 0 },
      ] };
    }
    if (key === "/api/categories") return { data: [{ id: "produce" }, { id: "meat" }] };
    if (key === "/api/inventory-items") return { data: countLines.map(line => line.inventoryItem) };
    if (key === "/api/units") return { data: [] };
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
  });

  afterEach(cleanup);

  it("renders each location item title and quantity editor in the same compact row", async () => {
    render(<CountSession />);
    const row = await screen.findByTestId("compact-count-row-line-apple");
    expect(row).toContainElement(screen.getByTestId("button-edit-item-item-apple"));
    expect(row).toContainElement(screen.getByTestId("input-qty-line-apple"));
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
    expect(scrollIntoView).toHaveBeenCalled();
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
});