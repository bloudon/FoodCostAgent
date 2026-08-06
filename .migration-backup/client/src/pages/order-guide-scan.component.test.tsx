// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";
vitestExpect.extend(matchers);

// ---------------------------------------------------------------------------
// Local interfaces for mock prop shapes (avoids `any`)
// ---------------------------------------------------------------------------

interface LinkProps {
  href: string;
  children: React.ReactNode;
}

interface ObjectUploaderProps {
  dataTestId?: string;
  buttonText?: string;
  onUploadComplete?: (path: string) => void;
}

interface QueryClientProviderProps {
  children: React.ReactNode;
}

interface UseQueryOpts {
  queryKey?: string[];
  queryFn?: () => Promise<unknown>;
  enabled?: boolean;
}

interface AppendResult {
  newLines: ScannedLine[];
  newItems: number;
  totalItems: number;
  pageNumber: number;
}

interface UseMutationOpts {
  onSuccess?: (data: AppendResult) => void;
}

interface ScannedLine {
  id: string;
  vendorSku: string | null;
  productName: string;
  packSize: string | null;
  uom: string | null;
  price: number | null;
  matchStatus: "matched" | "ambiguous" | "new";
  matchConfidence: number | null;
}

interface RehydrateData {
  guide: { rowCount: number; fileName: string | null };
  lines: { matched: ScannedLine[]; ambiguous: ScannedLine[]; new: ScannedLine[] };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
const mockSearch = { value: "" };

vi.mock("@/hooks/use-store-context", () => ({
  useStoreContext: () => ({
    selectedStoreId: "store-a",
    stores: [
      { id: "store-a", name: "Store A" },
      { id: "store-b", name: "Store B" },
    ],
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/order-guide-scan", mockNavigate],
  useSearch: () => mockSearch.value,
  Link: ({ href, children }: LinkProps) => React.createElement("a", { href }, children),
}));

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: UseQueryOpts) => mockUseQuery(opts),
  useMutation: (opts: UseMutationOpts) => mockUseMutation(opts),
  QueryClient: class { invalidateQueries = vi.fn(); },
  QueryClientProvider: ({ children }: QueryClientProviderProps) => children,
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/components/ObjectUploader", () => ({
  ObjectUploader: ({ dataTestId, buttonText, onUploadComplete }: ObjectUploaderProps) =>
    React.createElement(
      "button",
      {
        "data-testid": dataTestId,
        onClick: () => onUploadComplete && onUploadComplete("test/path.jpg"),
      },
      buttonText
    ),
}));

import OrderGuideScan from "./order-guide-scan";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MATCHED_LINE: ScannedLine = {
  id: "l1",
  vendorSku: "SKU1",
  productName: "Cheese Mozz",
  packSize: null,
  uom: null,
  price: 45.0,
  matchStatus: "matched",
  matchConfidence: 95,
};

const NEW_LINE: ScannedLine = {
  id: "l3",
  vendorSku: "SKU3",
  productName: "Basil Fresh",
  packSize: null,
  uom: null,
  price: null,
  matchStatus: "new",
  matchConfidence: null,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeQueryImpl(
  ogLines: RehydrateData["lines"] | null,
  vendors: { id: string; name: string }[] = []
) {
  return (opts: UseQueryOpts) => {
    const key = opts?.queryKey?.[0];
    if (key === "/api/order-guides" && ogLines) {
      const data: RehydrateData = {
        guide: { rowCount: ogLines.matched.length + ogLines.new.length, fileName: null },
        lines: ogLines,
      };
      return { data, isLoading: false };
    }
    if (key === "/api/vendors") {
      return { data: vendors, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  };
}

function makeMutationResult() {
  return { mutate: vi.fn(), isPending: false };
}

function setup(search = "") {
  mockSearch.value = search;
  mockNavigate.mockClear();
  mockUseQuery.mockImplementation(makeQueryImpl(null));
  mockUseMutation.mockReturnValue(makeMutationResult());
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrderGuideScan page — Step 1 configuration UI", () => {
  beforeEach(() => setup(""));

  it("renders the page heading", () => {
    render(React.createElement(OrderGuideScan));
    expect(screen.getByText("Import Order Guide")).toBeInTheDocument();
  });

  it("shows the vendor selector on step 1", () => {
    render(React.createElement(OrderGuideScan));
    expect(screen.getByTestId("select-vendor")).toBeInTheDocument();
  });

  it("shows the invoice upload button on step 1", () => {
    render(React.createElement(OrderGuideScan));
    expect(screen.getByTestId("button-upload-invoice")).toBeInTheDocument();
  });

  it("shows the step indicator with 'Configure' and 'Review' labels", () => {
    render(React.createElement(OrderGuideScan));
    expect(screen.getByText("Configure")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("shows the back button", () => {
    render(React.createElement(OrderGuideScan));
    expect(screen.getByTestId("button-back")).toBeInTheDocument();
  });

  it("shows the 'Vendor (Optional)' card heading", () => {
    render(React.createElement(OrderGuideScan));
    expect(screen.getByText("Vendor (Optional)")).toBeInTheDocument();
  });

  it("shows the 'Upload Invoice or Catalog' section", () => {
    render(React.createElement(OrderGuideScan));
    expect(screen.getByText("Upload Invoice or Catalog")).toBeInTheDocument();
  });

  it("does not show 'Review & Commit' button on step 1", () => {
    render(React.createElement(OrderGuideScan));
    expect(screen.queryByTestId("button-review-commit")).not.toBeInTheDocument();
  });

  it("shows store checkboxes for each store when multiple stores exist", () => {
    render(React.createElement(OrderGuideScan));
    expect(screen.getByTestId("checkbox-store-store-a")).toBeInTheDocument();
    expect(screen.getByTestId("checkbox-store-store-b")).toBeInTheDocument();
  });
});

describe("OrderGuideScan page — Step 2 results UI (loaded via ogId param)", () => {
  const OG_ID = "test-og-id-123";

  beforeEach(() => {
    setup(`ogId=${OG_ID}`);
    mockUseQuery.mockImplementation(
      makeQueryImpl({ matched: [MATCHED_LINE], ambiguous: [], new: [NEW_LINE] })
    );
  });

  it("shows the 'Review & Commit' button in step 2", async () => {
    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("button-review-commit")).toBeInTheDocument());
  });

  it("shows the 'Add Another Page' button in step 2", async () => {
    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("button-add-page")).toBeInTheDocument());
  });

  it("shows the 'Start Over' button in step 2", async () => {
    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("button-back-step1")).toBeInTheDocument());
  });

  it("renders line item rows in the table", async () => {
    render(React.createElement(OrderGuideScan));
    await waitFor(() => {
      expect(screen.getByTestId("row-line-0")).toBeInTheDocument();
      expect(screen.getByTestId("row-line-1")).toBeInTheDocument();
    });
  });

  it("does not show the invoice upload button (step 1 UI) in step 2", async () => {
    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("button-review-commit")).toBeInTheDocument());
    expect(screen.queryByTestId("button-upload-invoice")).not.toBeInTheDocument();
  });
});

describe("OrderGuideScan page — 'Add Another Page' expand/collapse cycle", () => {
  const OG_ID = "test-og-id-456";

  beforeEach(() => {
    setup(`ogId=${OG_ID}`);
    mockUseQuery.mockImplementation(
      makeQueryImpl({ matched: [MATCHED_LINE], ambiguous: [], new: [] })
    );
  });

  it("clicking 'Add Another Page' reveals the scan-next-page panel", async () => {
    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("button-add-page")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("button-add-page"));

    expect(screen.getByText("Scan another page")).toBeInTheDocument();
    expect(screen.getByTestId("button-upload-next-page")).toBeInTheDocument();
    expect(screen.getByTestId("button-cancel-add-page")).toBeInTheDocument();
  });

  it("clicking 'Add Another Page' hides the button itself", async () => {
    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("button-add-page")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("button-add-page"));

    expect(screen.queryByTestId("button-add-page")).not.toBeInTheDocument();
  });

  it("clicking 'Cancel' collapses the panel and restores 'Add Another Page'", async () => {
    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("button-add-page")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("button-add-page"));
    expect(screen.getByText("Scan another page")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-cancel-add-page"));

    expect(screen.queryByText("Scan another page")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-add-page")).toBeInTheDocument();
  });
});

describe("OrderGuideScan page — 'Review & Commit' routing", () => {
  const OG_ID = "test-og-id-789";

  beforeEach(() => {
    setup(`ogId=${OG_ID}`);
    mockUseQuery.mockImplementation(
      makeQueryImpl({ matched: [MATCHED_LINE], ambiguous: [], new: [] })
    );
  });

  it("clicking 'Review & Commit' navigates to /order-guides/:id/review", async () => {
    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("button-review-commit")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("button-review-commit"));

    expect(mockNavigate).toHaveBeenCalledWith(`/order-guides/${OG_ID}/review`);
  });
});

describe("OrderGuideScan page — page-break rows", () => {
  const OG_ID = "test-og-id-pb";

  it("renders no page-break rows for a single-page scan", async () => {
    setup(`ogId=${OG_ID}`);
    const line2: ScannedLine = { ...MATCHED_LINE, id: "l2", vendorSku: "SKU2", productName: "Product 2" };
    mockUseQuery.mockImplementation(
      makeQueryImpl({ matched: [MATCHED_LINE, line2], ambiguous: [], new: [] })
    );

    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("row-line-0")).toBeInTheDocument());

    const pageBreakRows = document.querySelectorAll('[data-testid^="page-break-"]');
    expect(pageBreakRows.length).toBe(0);
  });

  it("renders a page-break row with '— Page 2 —' after appending a second page via the mutation", async () => {
    setup(`ogId=${OG_ID}`);
    mockUseQuery.mockImplementation(
      makeQueryImpl({ matched: [MATCHED_LINE], ambiguous: [], new: [] })
    );

    let capturedOnSuccess: ((data: AppendResult) => void) | null = null;
    mockUseMutation.mockImplementation((opts: UseMutationOpts) => {
      if (opts.onSuccess) capturedOnSuccess = opts.onSuccess;
      return makeMutationResult();
    });

    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("button-add-page")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("button-add-page"));
    await waitFor(() => expect(screen.getByTestId("button-upload-next-page")).toBeInTheDocument());

    expect(capturedOnSuccess).not.toBeNull();

    act(() => {
      capturedOnSuccess!({
        newLines: [
          {
            id: "l2",
            vendorSku: "SKU2",
            productName: "Page 2 Item",
            packSize: null,
            uom: null,
            price: 25.0,
            matchStatus: "new",
            matchConfidence: null,
          },
        ],
        newItems: 1,
        totalItems: 2,
        pageNumber: 2,
      });
    });

    await waitFor(() => {
      const pageBreakRows = document.querySelectorAll('[data-testid^="page-break-"]');
      expect(pageBreakRows.length).toBeGreaterThan(0);
    });

    expect(screen.getByText("— Page 2 —")).toBeInTheDocument();
    expect(screen.getByTestId("row-line-0")).toBeInTheDocument();
    expect(screen.getByTestId("row-line-1")).toBeInTheDocument();
  });
});

describe("OrderGuideScan page — 'Start Over' reset", () => {
  const OG_ID = "test-og-id-reset";

  it("clicking 'Start Over' navigates to /order-guide-scan without ogId", async () => {
    setup(`ogId=${OG_ID}`);
    mockUseQuery.mockImplementation(
      makeQueryImpl({ matched: [MATCHED_LINE], ambiguous: [], new: [] })
    );

    render(React.createElement(OrderGuideScan));
    await waitFor(() => expect(screen.getByTestId("button-back-step1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("button-back-step1"));

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("/order-guide-scan"),
      expect.objectContaining({ replace: true })
    );
    const lastCall = mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1];
    expect(lastCall[0]).not.toContain("ogId=");
  });

  it("shows step 1 UI when the URL search has no ogId", () => {
    setup("");
    mockUseQuery.mockImplementation(makeQueryImpl(null));

    render(React.createElement(OrderGuideScan));

    expect(screen.getByTestId("select-vendor")).toBeInTheDocument();
    expect(screen.getByTestId("button-upload-invoice")).toBeInTheDocument();
    expect(screen.queryByTestId("button-review-commit")).not.toBeInTheDocument();
  });
});
