// @vitest-environment jsdom
/**
 * vendor-detail.tsx — Inventory Items table layout & sorting
 *
 * Covers the standard list-page conventions this page adopts:
 *   - Heading shows the FULL item count in parentheses (not the filtered count)
 *   - Search box renders above the table and filters by name/SKU
 *   - Every column header is a click-to-toggle sort control
 *   - Numeric columns sort numerically, text columns alphabetically
 *   - Search + sort compose (sort applies to the filtered rows)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";

vitestExpect.extend(matchers);

const mockUseQuery = vi.fn();

vi.mock("wouter", () => ({
  useRoute: () => [true, { id: "vendor-1" }],
  useLocation: () => ["/vendors/vendor-1", vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
}));

vi.mock("@/components/setup-progress-banner", () => ({
  SetupProgressBanner: () => React.createElement("div", { "data-testid": "setup-banner" }),
}));

import VendorDetail from "./vendor-detail";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VENDOR = { id: "vendor-1", name: "Harvill's Produce Co., Inc.", accountNumber: "HP-42" };

/** Deliberately out of alphabetical order, with numeric values whose string
 *  ordering differs from their numeric ordering (9 vs 10 vs 100). */
const ITEMS = [
  {
    id: "i-celery",
    vendorId: "vendor-1",
    inventoryItemId: "inv-celery",
    vendorSku: "cel36",
    purchaseUnitId: "u1",
    caseSize: 10,
    innerPackSize: null,
    lastPrice: 9,
    lastCasePrice: 90,
    displayCasePrice: 100,
    inventoryUnitName: "each",
    active: 1,
    inventoryItem: {
      id: "inv-celery", name: "Celery", categoryId: null, storageLocationId: "s1",
      pricePerUnit: 9, caseSize: 10, innerPackSize: null,
    },
    unit: { id: "u1", name: "each" },
  },
  {
    id: "i-apple",
    vendorId: "vendor-1",
    inventoryItemId: "inv-apple",
    vendorSku: "zap01",
    purchaseUnitId: "u2",
    caseSize: 100,
    innerPackSize: null,
    lastPrice: 100,
    lastCasePrice: 900,
    displayCasePrice: 9,
    inventoryUnitName: "case",
    active: 0,
    inventoryItem: {
      id: "inv-apple", name: "Apple", categoryId: null, storageLocationId: "s1",
      pricePerUnit: 100, caseSize: 100, innerPackSize: null,
    },
    unit: { id: "u2", name: "case" },
  },
  {
    id: "i-beet",
    vendorId: "vendor-1",
    inventoryItemId: "inv-beet",
    vendorSku: "mbe10",
    purchaseUnitId: "u3",
    caseSize: 9,
    innerPackSize: null,
    lastPrice: 10,
    lastCasePrice: 20,
    displayCasePrice: 20,
    inventoryUnitName: "lb",
    active: 1,
    inventoryItem: {
      id: "inv-beet", name: "Beet", categoryId: null, storageLocationId: "s1",
      pricePerUnit: 10, caseSize: 9, innerPackSize: null,
    },
    unit: { id: "u3", name: "lb" },
  },
];

function mockQueries({ items = ITEMS }: { items?: unknown[] } = {}) {
  mockUseQuery.mockImplementation((opts: any) => {
    const key = String(opts?.queryKey?.[0] ?? "");
    if (key.startsWith("/api/vendors/")) return { data: VENDOR, isLoading: false };
    if (key.startsWith("/api/vendor-items")) return { data: items, isLoading: false };
    if (key.includes("deposit-ledger")) return { data: undefined, isLoading: false };
    return { data: undefined, isLoading: false };
  });
}

/** Item-name cell text of each body row, in render order. */
function renderedNames(): string[] {
  const table = screen.getAllByRole("table")[0];
  const rows = within(table).getAllByRole("row").slice(1); // drop header row
  return rows.map((r) => within(r).getAllByRole("cell")[0].textContent?.trim() ?? "");
}

beforeEach(() => {
  cleanup();
  mockUseQuery.mockReset();
});

describe("vendor detail — Inventory Items section", () => {
  it("shows the full item count in the heading, in parentheses", () => {
    mockQueries();
    render(<VendorDetail />);
    expect(screen.getByTestId("text-inventory-items-title")).toHaveTextContent("Inventory Items (3)");
  });

  it("keeps the heading count at the full total while a search filters rows", () => {
    mockQueries();
    render(<VendorDetail />);
    fireEvent.change(screen.getByTestId("input-search-items"), { target: { value: "celery" } });

    expect(screen.getByTestId("text-inventory-items-title")).toHaveTextContent("Inventory Items (3)");
    expect(renderedNames()).toEqual(["Celery"]);
  });

  it("renders the search box above the table", () => {
    mockQueries();
    render(<VendorDetail />);
    const search = screen.getByTestId("input-search-items");
    const table = screen.getAllByRole("table")[0];
    // DOCUMENT_POSITION_FOLLOWING === the table comes after the search box.
    expect(search.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no longer duplicates the item count in the vendor header", () => {
    mockQueries();
    render(<VendorDetail />);
    expect(screen.queryByTestId("text-vendor-item-count")).toBeNull();
    expect(screen.getByTestId("text-vendor-account")).toHaveTextContent("HP-42");
  });

  it("sorts by item name ascending by default and toggles to descending on click", () => {
    mockQueries();
    render(<VendorDetail />);
    expect(renderedNames()).toEqual(["Apple", "Beet", "Celery"]);

    fireEvent.click(screen.getByTestId("sort-header-name"));
    expect(renderedNames()).toEqual(["Celery", "Beet", "Apple"]);

    fireEvent.click(screen.getByTestId("sort-header-name"));
    expect(renderedNames()).toEqual(["Apple", "Beet", "Celery"]);
  });

  it("exposes every column header as a sort toggle", () => {
    mockQueries();
    render(<VendorDetail />);
    for (const field of ["name", "sku", "price", "packSize", "status", "unit", "casePrice"]) {
      expect(screen.getByTestId(`sort-header-${field}`)).toBeInTheDocument();
    }
  });

  it("sorts text columns alphabetically", () => {
    mockQueries();
    render(<VendorDetail />);
    // SKUs: cel36 / zap01 / mbe10 → ascending c, m, z
    fireEvent.click(screen.getByTestId("sort-header-sku"));
    expect(renderedNames()).toEqual(["Celery", "Beet", "Apple"]);

    // Status: Active (Celery, Beet) before Inactive (Apple)
    fireEvent.click(screen.getByTestId("sort-header-status"));
    expect(renderedNames()[2]).toBe("Apple");
  });

  it("sorts numeric columns numerically, not as strings", () => {
    mockQueries();
    render(<VendorDetail />);

    // Price: 9 (Celery) < 10 (Beet) < 100 (Apple). A string sort would put
    // "10" and "100" before "9".
    fireEvent.click(screen.getByTestId("sort-header-price"));
    expect(renderedNames()).toEqual(["Celery", "Beet", "Apple"]);

    // Case price: 9 (Apple) < 20 (Beet) < 100 (Celery)
    fireEvent.click(screen.getByTestId("sort-header-casePrice"));
    expect(renderedNames()).toEqual(["Apple", "Beet", "Celery"]);

    // Pack size: 9 (Beet) < 10 (Celery) < 100 (Apple)
    fireEvent.click(screen.getByTestId("sort-header-packSize"));
    expect(renderedNames()).toEqual(["Beet", "Celery", "Apple"]);
  });

  it("applies sorting to the filtered rows so search and sort compose", () => {
    mockQueries();
    render(<VendorDetail />);
    // "e" matches Celery, Apple (zap01 has no 'e'... names: Celery, Apple, Beet)
    fireEvent.change(screen.getByTestId("input-search-items"), { target: { value: "e" } });
    expect(renderedNames()).toEqual(["Apple", "Beet", "Celery"]);

    fireEvent.click(screen.getByTestId("sort-header-price")); // 9, 10, 100
    expect(renderedNames()).toEqual(["Celery", "Beet", "Apple"]);

    fireEvent.click(screen.getByTestId("sort-header-price")); // descending
    expect(renderedNames()).toEqual(["Apple", "Beet", "Celery"]);
  });

  it("still shows the empty state when the vendor has no items", () => {
    mockQueries({ items: [] });
    render(<VendorDetail />);
    expect(screen.getByTestId("text-inventory-items-title")).toHaveTextContent("Inventory Items (0)");
    expect(screen.getByText("No inventory items found for this vendor.")).toBeInTheDocument();
    expect(screen.queryByTestId("input-search-items")).toBeNull();
  });
});
