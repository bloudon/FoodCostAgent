// @vitest-environment jsdom
/**
 * Component tests for the confidence filter chips in ResolutionPreviewStep.
 *
 * Verifies:
 *   - All confidence chips render for each level present in the batch
 *   - Clicking a chip updates the "Showing X of Y matching rows" counter
 *   - Clicking the "All" chip resets the counter to the full unfiltered count
 *   - An impossible category + confidence combination shows the empty-result state
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

// Shadcn UI component stubs — thin pass-throughs so the test focuses on logic

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
  Button: ({ children, onClick, disabled, size, variant, className }: any) =>
    React.createElement("button", { onClick, disabled }, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className, variant }: any) =>
    React.createElement("span", { "data-testid": "badge" }, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => React.createElement("input", props),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: any) => React.createElement("label", null, children),
}));

vi.mock("@/components/ui/progress", () => ({
  Progress: ({ value }: any) => React.createElement("div", { "data-testid": "progress", "data-value": value }),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange }: any) =>
    React.createElement("input", { type: "checkbox", checked, onChange: (e: any) => onCheckedChange?.(e.target.checked) }),
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
  TableCell: ({ children, colSpan, className }: any) =>
    React.createElement("td", { colSpan }, children),
  TableHead: ({ children }: any) => React.createElement("th", null, children),
  TableHeader: ({ children }: any) => React.createElement("thead", null, children),
  TableRow: ({ children }: any) => React.createElement("tr", null, children),
}));

// Lucide icons — stub to empty spans so SVG doesn't trip up jsdom
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
  itemMatch: { strategy: string; confidence: string; matchedId: string | null; candidateIds: string[]; requiresReview: boolean };
  vendorMatch: { vendorId: string | null; isNew: boolean; confidence: string; requiresReview: boolean };
  locationMatch: { locationId: string | null; isNew: boolean; normalizedName: string };
}

function makePreviewRow(
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
      requiresReview: strategy === "fuzzy",
    },
    vendorMatch: { vendorId: "vendor-1", isNew: false, confidence: "high", requiresReview: false },
    locationMatch: { locationId: "loc-1", isNew: false, normalizedName: "Dry Storage" },
  };
}

/**
 * 5-row fixture:
 *   Confidence breakdown — high: 2, medium: 1, low: 1, new: 1
 *   Category breakdown  — Dairy: 2, Meat: 2, Produce: 1
 *
 *   Impossible combination: "New" confidence + "Dairy" category → 0 rows
 */
const MOCK_ROWS: RowPreview[] = [
  makePreviewRow(1, "Dairy",   "item_code", "high"),    // high
  makePreviewRow(2, "Meat",    "name_pack", "medium"),  // medium
  makePreviewRow(3, "Dairy",   "fuzzy",     "low"),     // low (fuzzy)
  makePreviewRow(4, "Meat",    "none",      "none"),    // new
  makePreviewRow(5, "Produce", "item_code", "high"),    // high
];

const MOCK_PREVIEW = {
  batchId: "batch-test-1",
  inventoryDate: "2026-07-01",
  totalRows: MOCK_ROWS.length,
  summary: {
    totalRows: MOCK_ROWS.length,
    itemsMatchedHigh: 2,
    itemsMatchedMedium: 1,
    itemsAmbiguous: 0,
    itemsNew: 1,
    itemsFuzzy: 1,
    vendorsMatched: 3,
    vendorsNew: 1,
    locationsMatched: 2,
    locationsNew: 0,
    rowsRequiringReview: 1,
  },
  rows: MOCK_ROWS,
  newLocations: [],
  newVendors: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderStep() {
  return render(
    React.createElement(ResolutionPreviewStep, {
      batchId: "batch-test-1",
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

// ---------------------------------------------------------------------------
// Helpers: chip finders
// ---------------------------------------------------------------------------

/**
 * Returns the filter chip <button> for a confidence level label.
 * Using getByRole("button") avoids false-positive matches against same-text
 * badge <span> elements rendered in the table rows.
 */
function getConfidenceChip(label: string) {
  // There may be multiple buttons with the same label if category chips share
  // the name — but confidence labels (Matched / Likely / Fuzzy / New) are
  // not used as category names in our fixture, so a single button match is safe.
  return screen.getByRole("button", { name: label });
}

/** Returns the category chip <button> for a given category label. */
function getCategoryChip(label: string) {
  return screen.getByRole("button", { name: label });
}

/**
 * Returns all buttons whose accessible name is "All".
 * The component renders one "All" button per filter row (category + confidence).
 */
function getAllChips() {
  return screen.getAllByRole("button", { name: "All" });
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("ResolutionPreviewStep — confidence filter chips", () => {
  it("renders a chip for each confidence level present in the batch", async () => {
    renderStep();
    // All 4 confidence levels from our fixture should appear as chip buttons
    await waitFor(() => {
      expect(getConfidenceChip("Matched")).toBeInTheDocument();
      expect(getConfidenceChip("Likely")).toBeInTheDocument();
      expect(getConfidenceChip("Fuzzy")).toBeInTheDocument();
      expect(getConfidenceChip("New")).toBeInTheDocument();
    });
  });

  it("shows the full unfiltered row count by default", async () => {
    renderStep();
    await waitFor(() => {
      // Unfiltered: "Showing 1–5 of 5 rows"
      expect(
        screen.getByText((text) => text.includes("of 5 rows")),
      ).toBeInTheDocument();
    });
  });

  it("clicking the 'Matched' chip filters to high-confidence rows only", async () => {
    renderStep();
    // Wait for chip then click
    await waitFor(() => expect(getConfidenceChip("Matched")).toBeInTheDocument());
    fireEvent.click(getConfidenceChip("Matched"));

    await waitFor(() => {
      // 2 high-confidence rows → "Showing 1–2 of 2 matching rows (5 total)"
      expect(
        screen.getByText((text) =>
          text.includes("of 2 matching rows") && text.includes("5 total"),
        ),
      ).toBeInTheDocument();
    });
  });

  it("clicking the 'All' chip after a confidence filter resets to the full count", async () => {
    renderStep();
    // Apply filter first
    await waitFor(() => expect(getConfidenceChip("Matched")).toBeInTheDocument());
    fireEvent.click(getConfidenceChip("Matched"));

    await waitFor(() => {
      expect(
        screen.getByText((text) => text.includes("of 2 matching rows")),
      ).toBeInTheDocument();
    });

    // The component renders two "All" chip-buttons: one for Category, one for
    // Confidence. After filtering by confidence the confidence "All" is the last
    // one rendered, so we click the last item in the list.
    const allChips = getAllChips();
    fireEvent.click(allChips[allChips.length - 1]);

    await waitFor(() => {
      expect(
        screen.getByText((text) => text.includes("of 5 rows")),
      ).toBeInTheDocument();
    });
  });

  it("shows empty-result state when an impossible filter combination is selected", async () => {
    renderStep();

    // Select "New" confidence (only Meat row has strategy=none)
    await waitFor(() => expect(getConfidenceChip("New")).toBeInTheDocument());
    fireEvent.click(getConfidenceChip("New"));

    // Then select "Dairy" category — no Dairy+New row exists in the fixture
    await waitFor(() => expect(getCategoryChip("Dairy")).toBeInTheDocument());
    fireEvent.click(getCategoryChip("Dairy"));

    await waitFor(() => {
      // Counter text above the table
      expect(screen.getByText("No matching rows")).toBeInTheDocument();
      // Empty-state cell inside the table body
      expect(
        screen.getByText("No rows match the selected filters."),
      ).toBeInTheDocument();
    });
  });

  it("clicking the 'Likely' chip filters to medium-confidence rows only", async () => {
    renderStep();
    await waitFor(() => expect(getConfidenceChip("Likely")).toBeInTheDocument());
    fireEvent.click(getConfidenceChip("Likely"));

    await waitFor(() => {
      // 1 medium-confidence row → "Showing 1–1 of 1 matching rows (5 total)"
      expect(
        screen.getByText((text) =>
          text.includes("of 1 matching rows") && text.includes("5 total"),
        ),
      ).toBeInTheDocument();
    });
  });

  it("clicking the 'New' chip shows only new (unmatched) rows", async () => {
    renderStep();
    await waitFor(() => expect(getConfidenceChip("New")).toBeInTheDocument());
    fireEvent.click(getConfidenceChip("New"));

    await waitFor(() => {
      // 1 new row in fixture
      expect(
        screen.getByText((text) =>
          text.includes("of 1 matching rows") && text.includes("5 total"),
        ),
      ).toBeInTheDocument();
    });
  });
});
