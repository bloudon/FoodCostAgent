// @vitest-environment jsdom
/**
 * Pagination-reset tests for ResolutionPreviewStep.
 *
 * Verifies that switching category or confidence filters always resets the
 * page counter back to 1 so users never land on a stale or empty page.
 *
 * Requires a fixture with more than PAGE_SIZE (100) rows so pagination controls
 * actually appear and page-2 navigation can be confirmed.
 *
 * Covered scenarios:
 *   1. Activating a category filter resets to page 1
 *   2. Activating a confidence filter resets to page 1
 *   3. Clicking "All" on the category filter resets to page 1
 *   4. Clicking "All" on the confidence filter resets to page 1
 *   5. "Showing X–Y of Z" status line reflects the current page correctly
 *      across unfiltered, filtered, and post-reset states
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";

vitestExpect.extend(matchers);

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports that pull in the component
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/orderly-import", vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));

const mockUseQuery = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: any) => mockUseQuery(opts),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  QueryClient: class {
    invalidateQueries = vi.fn();
  },
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Shadcn UI component stubs

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => React.createElement("div", null, children),
  CardContent: ({ children }: any) => React.createElement("div", null, children),
  CardDescription: ({ children }: any) => React.createElement("p", null, children),
  CardHeader: ({ children }: any) => React.createElement("div", null, children),
  CardTitle: ({ children }: any) => React.createElement("span", null, children),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: any) => React.createElement("div", { role: "alert" }, children),
  AlertDescription: ({ children }: any) =>
    React.createElement("span", { "data-testid": "alert-description" }, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: any) =>
    React.createElement("button", { onClick, disabled }, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) =>
    React.createElement("span", { "data-testid": "badge" }, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => React.createElement("input", props),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: any) => React.createElement("label", null, children),
}));

vi.mock("@/components/ui/progress", () => ({
  Progress: ({ value }: any) =>
    React.createElement("div", { "data-testid": "progress", "data-value": value }),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange }: any) =>
    React.createElement("input", {
      type: "checkbox",
      checked,
      onChange: (e: any) => onCheckedChange?.(e.target.checked),
    }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => React.createElement("div", null, children),
  SelectContent: ({ children }: any) => React.createElement("div", null, children),
  SelectItem: ({ children, value }: any) => React.createElement("option", { value }, children),
  SelectTrigger: ({ children }: any) => React.createElement("div", null, children),
  SelectValue: ({ placeholder }: any) => React.createElement("span", null, placeholder),
}));

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: any) => React.createElement("table", null, children),
  TableBody: ({ children }: any) => React.createElement("tbody", null, children),
  TableCell: ({ children, colSpan }: any) =>
    React.createElement("td", { colSpan }, children),
  TableHead: ({ children }: any) => React.createElement("th", null, children),
  TableHeader: ({ children }: any) => React.createElement("thead", null, children),
  TableRow: ({ children }: any) => React.createElement("tr", null, children),
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  const Icon = () => React.createElement("span", null);
  const stubs: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    stubs[key] = Icon;
  }
  return stubs;
});

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are in place
// ---------------------------------------------------------------------------

import { ResolutionPreviewStep } from "./orderly-import";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface RowPreview {
  rowIndex: number;
  storageLocation: string | null;
  sourceItemCode: string | null;
  itemCodeStatus: string | null;
  cleanedDescription: string | null;
  supplierRaw: string | null;
  sourceCategory: string | null;
  caseQuantity: number | null;
  packagePrice: number | null;
  totalCost: number | null;
  itemMatch: {
    strategy: string;
    confidence: string;
    matchedId: string | null;
    candidateIds: string[];
    requiresReview: boolean;
  };
  vendorMatch: { vendorId: string | null; isNew: boolean; confidence: string; requiresReview: boolean };
  locationMatch: { locationId: string | null; isNew: boolean; normalizedName: string };
}

function makeRow(
  rowIndex: number,
  sourceCategory: string | null,
  strategy: string,
  confidence: string,
): RowPreview {
  return {
    rowIndex,
    storageLocation: "Dry Storage",
    sourceItemCode: `CODE-${rowIndex}`,
    itemCodeStatus: null,
    cleanedDescription: `Item ${rowIndex}`,
    supplierRaw: "Test Vendor",
    sourceCategory,
    caseQuantity: 1,
    packagePrice: 10,
    totalCost: 10,
    itemMatch: {
      strategy,
      confidence,
      matchedId: strategy === "none" ? null : `item-${rowIndex}`,
      candidateIds: [],
      requiresReview: false,
    },
    vendorMatch: { vendorId: "vendor-1", isNew: false, confidence: "high", requiresReview: false },
    locationMatch: { locationId: "loc-1", isNew: false, normalizedName: "Dry Storage" },
  };
}

/**
 * 150-row fixture:
 *   - Rows 1–110:  category "Dairy",  strategy "item_code", confidence "high"
 *   - Rows 111–150: category "Meat",  strategy "name_pack", confidence "medium"
 *
 * This gives:
 *   - Unfiltered: 150 rows → 2 pages (page 1: rows 1–100, page 2: rows 101–150)
 *   - Dairy filter: 110 rows → 2 pages (page 1: rows 1–100, page 2: rows 101–110)
 *   - Meat filter: 40 rows → 1 page
 *   - "high" confidence filter: 110 rows → 2 pages
 *   - "medium" confidence filter: 40 rows → 1 page
 */
function makePaginationFixture(): RowPreview[] {
  const rows: RowPreview[] = [];
  for (let i = 1; i <= 110; i++) {
    rows.push(makeRow(i, "Dairy", "item_code", "high"));
  }
  for (let i = 111; i <= 150; i++) {
    rows.push(makeRow(i, "Meat", "name_pack", "medium"));
  }
  return rows;
}

const FIXTURE_ROWS = makePaginationFixture();

const MOCK_PREVIEW = {
  batchId: "batch-pagination-test",
  inventoryDate: "2026-07-01",
  totalRows: FIXTURE_ROWS.length,
  summary: {
    totalRows: FIXTURE_ROWS.length,
    itemsMatchedHigh: 110,
    itemsMatchedMedium: 40,
    itemsAmbiguous: 0,
    itemsNew: 0,
    itemsFuzzy: 0,
    vendorsMatched: 5,
    vendorsNew: 0,
    locationsMatched: 3,
    locationsNew: 0,
    rowsRequiringReview: 0,
  },
  rows: FIXTURE_ROWS,
  newLocations: [],
  newVendors: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderStep() {
  return render(
    React.createElement(ResolutionPreviewStep, {
      batchId: "batch-pagination-test",
      onApproved: vi.fn(),
      onBack: vi.fn(),
    }),
  );
}

function setupQueryMocks() {
  mockUseQuery.mockImplementation((opts: any) => {
    const key = Array.isArray(opts.queryKey) ? opts.queryKey[0] : opts.queryKey;
    if (typeof key === "string" && key.includes("resolution-preview")) {
      return { data: MOCK_PREVIEW, isLoading: false, isError: false };
    }
    return { data: undefined, isLoading: false, isError: false };
  });
}

/** Returns all "All" chip buttons (one per filter row). */
function getAllChips() {
  return screen.getAllByRole("button", { name: "All" });
}

/** Returns the "Next →" pagination button. */
function getNextButton() {
  return screen.getByRole("button", { name: /Next →/ });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupQueryMocks();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("ResolutionPreviewStep — pagination resets when filters change", () => {

  // ── Baseline: multi-page navigation works ──────────────────────────────────

  it("shows 'Showing 1–100 of 150 rows' on the first page by default", async () => {
    renderStep();
    await waitFor(() => {
      expect(
        screen.getByText((text) =>
          text.includes("Showing 1") && text.includes("100") && text.includes("of 150 rows"),
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows 'Page 1 of 2' pagination indicator when fixture has 150 rows", async () => {
    renderStep();
    await waitFor(() => {
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    });
  });

  it("navigating to page 2 updates the status line to 'Showing 101–150 of 150 rows'", async () => {
    renderStep();
    await waitFor(() => expect(getNextButton()).toBeInTheDocument());
    fireEvent.click(getNextButton());

    await waitFor(() => {
      expect(
        screen.getByText((text) =>
          text.includes("Showing 101") && text.includes("150") && text.includes("of 150 rows"),
        ),
      ).toBeInTheDocument();
    });
  });

  // ── Category filter resets page to 1 ──────────────────────────────────────

  it("activating a category filter resets the page counter to 1", async () => {
    renderStep();

    // Navigate to page 2 first
    await waitFor(() => expect(getNextButton()).toBeInTheDocument());
    fireEvent.click(getNextButton());
    await waitFor(() => {
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    });

    // Click the "Dairy" category chip → should reset to page 1
    const dairyChip = screen.getByRole("button", { name: "Dairy" });
    fireEvent.click(dairyChip);

    await waitFor(() => {
      // Page resets to 1; Dairy has 110 rows so page 1 of 2
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    });
  });

  it("status line shows page-1 range after category filter is activated", async () => {
    renderStep();

    // Navigate to page 2 first
    await waitFor(() => expect(getNextButton()).toBeInTheDocument());
    fireEvent.click(getNextButton());
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());

    // Activate "Dairy" filter
    const dairyChip = screen.getByRole("button", { name: "Dairy" });
    fireEvent.click(dairyChip);

    await waitFor(() => {
      // Dairy: 110 matching rows, page 1 → Showing 1–100 of 110
      expect(
        screen.getByText((text) =>
          text.includes("Showing 1") && text.includes("100") && text.includes("of 110 matching rows"),
        ),
      ).toBeInTheDocument();
    });
  });

  it("activating the 'Meat' category filter while on page 2 resets to page 1 with a single page", async () => {
    renderStep();

    // Navigate to page 2
    await waitFor(() => expect(getNextButton()).toBeInTheDocument());
    fireEvent.click(getNextButton());
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());

    // Activate "Meat" filter (40 rows → 1 page, so no pagination controls appear)
    const meatChip = screen.getByRole("button", { name: "Meat" });
    fireEvent.click(meatChip);

    await waitFor(() => {
      // Meat: 40 rows → single page, status shows full range
      expect(
        screen.getByText((text) =>
          text.includes("Showing 1") && text.includes("40") && text.includes("of 40 matching rows"),
        ),
      ).toBeInTheDocument();
    });

    // Pagination "Next →" button should be absent (only 1 page)
    expect(screen.queryByRole("button", { name: /Next →/ })).not.toBeInTheDocument();
  });

  // ── Confidence filter resets page to 1 ────────────────────────────────────

  it("activating a confidence filter resets the page counter to 1", async () => {
    renderStep();

    // Navigate to page 2 first
    await waitFor(() => expect(getNextButton()).toBeInTheDocument());
    fireEvent.click(getNextButton());
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());

    // Click the "Matched" (high) confidence chip → resets to page 1
    const matchedChip = screen.getByRole("button", { name: "Matched" });
    fireEvent.click(matchedChip);

    await waitFor(() => {
      // "high" confidence: 110 rows → page 1 of 2
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    });
  });

  it("status line shows page-1 range after confidence filter is activated", async () => {
    renderStep();

    // Navigate to page 2
    await waitFor(() => expect(getNextButton()).toBeInTheDocument());
    fireEvent.click(getNextButton());
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());

    // Activate "Matched" (high confidence) filter
    const matchedChip = screen.getByRole("button", { name: "Matched" });
    fireEvent.click(matchedChip);

    await waitFor(() => {
      // high: 110 matching rows, page 1 → Showing 1–100 of 110
      expect(
        screen.getByText((text) =>
          text.includes("Showing 1") && text.includes("100") && text.includes("of 110 matching rows"),
        ),
      ).toBeInTheDocument();
    });
  });

  it("activating 'Likely' confidence filter while on page 2 resets to page 1 (single page)", async () => {
    renderStep();

    // Navigate to page 2
    await waitFor(() => expect(getNextButton()).toBeInTheDocument());
    fireEvent.click(getNextButton());
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());

    // "Likely" (medium) = 40 rows → resets to page 1, single page
    const likelyChip = screen.getByRole("button", { name: "Likely" });
    fireEvent.click(likelyChip);

    await waitFor(() => {
      expect(
        screen.getByText((text) =>
          text.includes("Showing 1") && text.includes("40") && text.includes("of 40 matching rows"),
        ),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Next →/ })).not.toBeInTheDocument();
  });

  // ── "All" chip resets page to 1 ───────────────────────────────────────────

  it("clicking 'All' on the category filter resets page to 1", async () => {
    renderStep();

    // Apply "Dairy" filter first, navigate to page 2
    await waitFor(() => expect(screen.getByRole("button", { name: "Dairy" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Dairy" }));
    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Next →/ }));
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());

    // Click the category "All" chip (first "All" button)
    const allChips = getAllChips();
    fireEvent.click(allChips[0]);

    await waitFor(() => {
      // Unfiltered: 150 rows, resets to page 1
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getByText((text) =>
          text.includes("Showing 1") && text.includes("100") && text.includes("of 150 rows"),
        ),
      ).toBeInTheDocument();
    });
  });

  it("clicking 'All' on the confidence filter resets page to 1", async () => {
    renderStep();

    // Apply "Matched" confidence filter, navigate to page 2
    await waitFor(() => expect(screen.getByRole("button", { name: "Matched" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Matched" }));
    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Next →/ }));
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());

    // Click the confidence "All" chip — it is the second "All" button
    const allChips = getAllChips();
    fireEvent.click(allChips[allChips.length - 1]);

    await waitFor(() => {
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getByText((text) =>
          text.includes("Showing 1") && text.includes("100") && text.includes("of 150 rows"),
        ),
      ).toBeInTheDocument();
    });
  });

  // ── Status line correctness across pages ──────────────────────────────────

  it("status line on page 2 of Dairy filter shows '101–110 of 110 matching rows'", async () => {
    renderStep();

    // Activate "Dairy" filter
    await waitFor(() => expect(screen.getByRole("button", { name: "Dairy" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Dairy" }));

    // Confirm on page 1 of the filtered view
    await waitFor(() => {
      expect(
        screen.getByText((text) =>
          text.includes("Showing 1") && text.includes("100") && text.includes("of 110 matching rows"),
        ),
      ).toBeInTheDocument();
    });

    // Navigate to page 2
    fireEvent.click(screen.getByRole("button", { name: /Next →/ }));

    await waitFor(() => {
      // Page 2 of Dairy (110 rows): rows 101–110
      expect(
        screen.getByText((text) =>
          text.includes("Showing 101") && text.includes("110") && text.includes("of 110 matching rows"),
        ),
      ).toBeInTheDocument();
    });
  });

  it("status line on page 2 of unfiltered view shows '101–150 of 150 rows'", async () => {
    renderStep();

    await waitFor(() => expect(getNextButton()).toBeInTheDocument());
    fireEvent.click(getNextButton());

    await waitFor(() => {
      expect(
        screen.getByText((text) =>
          text.includes("Showing 101") && text.includes("150") && text.includes("of 150 rows"),
        ),
      ).toBeInTheDocument();
    });
  });

  it("switching from one category to another while on page 2 resets back to page 1", async () => {
    renderStep();

    // Apply "Dairy" filter (110 rows, 2 pages), navigate to page 2
    await waitFor(() => expect(screen.getByRole("button", { name: "Dairy" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Dairy" }));
    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Next →/ }));
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeInTheDocument());

    // Switch to "Meat" filter — should reset to page 1
    fireEvent.click(screen.getByRole("button", { name: "Meat" }));

    await waitFor(() => {
      // Dairy is deselected when Meat is toggled in; Meat alone: 40 rows
      // The combined set (Dairy + Meat) = 150 rows → page 1
      // OR if "Dairy" was already deselected, just "Meat" = 40 rows
      // Either way, we should be on page 1
      expect(screen.queryByText("Page 2 of 2")).not.toBeInTheDocument();
    });
  });
});
