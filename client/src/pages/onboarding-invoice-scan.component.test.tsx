// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";
vitestExpect.extend(matchers);

// ---------------------------------------------------------------------------
// Shared prop interfaces
// ---------------------------------------------------------------------------

interface ObjectUploaderProps {
  dataTestId?: string;
  buttonText?: string;
  onUploadComplete?: (path: string) => void;
}

interface QueryClientProviderProps {
  children: React.ReactNode;
}

interface UseMutationResult {
  mutate: () => void;
  isPending: boolean;
}

interface UseMutationOpts<TData> {
  mutationFn?: () => Promise<TData>;
  onSuccess?: (data: TData) => void;
  onError?: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding-setup", vi.fn()],
  useSearch: () => "",
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));

const mockUseMutation = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: (opts: UseMutationOpts<unknown>) => mockUseMutation(opts),
  QueryClient: class { invalidateQueries = vi.fn(); },
  QueryClientProvider: ({ children }: QueryClientProviderProps) => children,
}));

const mockApiRequest = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/components/ObjectUploader", () => ({
  ObjectUploader: ({ dataTestId, buttonText, onUploadComplete }: ObjectUploaderProps) =>
    React.createElement(
      "button",
      {
        "data-testid": dataTestId,
        onClick: () => onUploadComplete && onUploadComplete("test/invoice.jpg"),
      },
      buttonText
    ),
}));

// ---------------------------------------------------------------------------
// Import the component under test
// ---------------------------------------------------------------------------

import { InvoiceScanStep } from "./onboarding-setup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMutationResult(): UseMutationResult {
  return { mutate: vi.fn(), isPending: false };
}

function setupMockMutation() {
  mockUseMutation.mockReturnValue(makeMutationResult());
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures — simulated API scan results (as the server would return them)
// ---------------------------------------------------------------------------

const ITEMS_UNIT_PRICE = [
  {
    name: "Mozzarella Cheese 5 Lb",
    unitPrice: 4.5,
    casePrice: 22.5,
    priceSource: "unit" as const,
    unit: "lb",
    categoryHint: "Dairy",
    matchedItemId: null,
    matchedItemName: null,
    matchConfidence: "none" as const,
    action: "create" as const,
  },
];

const ITEMS_CASE_ONLY = [
  {
    name: "Sliced Bacon 15/18 Count",
    unitPrice: 34.99,
    casePrice: 34.99,
    priceSource: "case" as const,
    unit: "cs",
    categoryHint: "Proteins",
    matchedItemId: null,
    matchedItemName: null,
    matchConfidence: "none" as const,
    action: "create" as const,
  },
];

const ITEMS_ZERO_PRICE = [
  {
    name: "Unknown Item",
    unitPrice: 0,
    casePrice: null,
    priceSource: "zero" as const,
    unit: null,
    categoryHint: null,
    matchedItemId: null,
    matchedItemName: null,
    matchConfidence: "none" as const,
    action: "skip" as const,
  },
];

const ITEMS_WITH_MATCH = [
  {
    name: "Tomato Sauce 6 Can",
    unitPrice: 18.5,
    casePrice: null,
    priceSource: "unit" as const,
    unit: "cs",
    categoryHint: "Grocery",
    matchedItemId: "inv-abc-123",
    matchedItemName: "Tomato Sauce",
    matchConfidence: "high" as const,
    action: "update" as const,
  },
];

// ---------------------------------------------------------------------------
// Helper — simulate a successful scan API response and advance to review state
// ---------------------------------------------------------------------------

async function renderAndAdvanceToReview(
  items: typeof ITEMS_UNIT_PRICE,
  vendorName = "Test Vendor",
) {
  const onComplete = vi.fn();
  setupMockMutation();

  mockApiRequest.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ items, vendorName }),
  });

  render(React.createElement(InvoiceScanStep, { onComplete }));

  const uploadBtn = screen.getByTestId("button-upload-invoice");
  fireEvent.click(uploadBtn);

  await waitFor(() =>
    expect(screen.getByTestId("card-step-invoice-review")).toBeInTheDocument()
  );

  return { onComplete };
}

// ---------------------------------------------------------------------------
// Tests — Upload sub-step
// ---------------------------------------------------------------------------

describe("InvoiceScanStep — upload sub-step", () => {
  beforeEach(() => {
    setupMockMutation();
  });

  it("renders the upload card initially", () => {
    render(React.createElement(InvoiceScanStep, { onComplete: vi.fn() }));
    expect(screen.getByTestId("card-step-invoice-upload")).toBeInTheDocument();
  });

  it("shows the upload button", () => {
    render(React.createElement(InvoiceScanStep, { onComplete: vi.fn() }));
    expect(screen.getByTestId("button-upload-invoice")).toBeInTheDocument();
  });

  it("does not show the review card before a scan", () => {
    render(React.createElement(InvoiceScanStep, { onComplete: vi.fn() }));
    expect(screen.queryByTestId("card-step-invoice-review")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — Review table renders without throwing
// ---------------------------------------------------------------------------

describe("InvoiceScanStep — Step 3 review table renders without throwing", () => {
  it("renders the review card after a successful scan", async () => {
    await renderAndAdvanceToReview(ITEMS_UNIT_PRICE);
    expect(screen.getByTestId("card-step-invoice-review")).toBeInTheDocument();
  });

  it("shows vendor name in the heading when returned by the API", async () => {
    await renderAndAdvanceToReview(ITEMS_UNIT_PRICE, "Restaurant Depot");
    expect(screen.getByText(/Restaurant Depot/i)).toBeInTheDocument();
  });

  it("renders item rows — unit-price items show an editable price input pre-filled with the AI value", async () => {
    await renderAndAdvanceToReview(ITEMS_UNIT_PRICE);
    expect(screen.getByText("Mozzarella Cheese 5 Lb")).toBeInTheDocument();
    const priceInput = screen.getByTestId("input-price-0") as HTMLInputElement;
    expect(priceInput).toBeInTheDocument();
    expect(parseFloat(priceInput.value)).toBeCloseTo(4.5, 2);
  });

  it("does NOT crash when an item has null unitPrice but a valid casePrice (case-only invoice)", async () => {
    await renderAndAdvanceToReview(ITEMS_CASE_ONLY);
    expect(screen.getByTestId("card-step-invoice-review")).toBeInTheDocument();
    expect(screen.getByText("Sliced Bacon 15/18 Count")).toBeInTheDocument();
  });

  it("shows 'case price' badge for items resolved from casePrice fallback", async () => {
    await renderAndAdvanceToReview(ITEMS_CASE_ONLY);
    expect(screen.getByText(/case price/i)).toBeInTheDocument();
  });

  it("shows an editable $0.0000 input for zero-price items (no longer a dash)", async () => {
    await renderAndAdvanceToReview(ITEMS_ZERO_PRICE);
    expect(screen.getByText("Unknown Item")).toBeInTheDocument();
    const priceInput = screen.getByTestId("input-price-0") as HTMLInputElement;
    expect(priceInput).toBeInTheDocument();
    expect(priceInput.value).toBe("0.0000");
  });

  it("shows match info for items with a high-confidence match", async () => {
    await renderAndAdvanceToReview(ITEMS_WITH_MATCH);
    expect(screen.getByText("Tomato Sauce 6 Can")).toBeInTheDocument();
    expect(screen.getByText(/Matches:/i)).toBeInTheDocument();
  });

  it("renders an action selector for every item row", async () => {
    await renderAndAdvanceToReview(ITEMS_UNIT_PRICE);
    const selectors = screen.getAllByTestId(/^select-action-/);
    expect(selectors.length).toBeGreaterThan(0);
  });

  it("renders the Apply button", async () => {
    await renderAndAdvanceToReview(ITEMS_UNIT_PRICE);
    expect(screen.getByTestId("button-apply-invoice")).toBeInTheDocument();
  });

  it("renders a mixed list (unit-price + case-only + zero-price) without throwing", async () => {
    const mixedItems = [
      ...ITEMS_UNIT_PRICE,
      ...ITEMS_CASE_ONLY,
      ...ITEMS_ZERO_PRICE,
    ];
    await renderAndAdvanceToReview(mixedItems);

    expect(screen.getByTestId("card-step-invoice-review")).toBeInTheDocument();
    expect(screen.getByText("Mozzarella Cheese 5 Lb")).toBeInTheDocument();
    expect(screen.getByText("Sliced Bacon 15/18 Count")).toBeInTheDocument();
    expect(screen.getByText("Unknown Item")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — Action selector defaults
// ---------------------------------------------------------------------------

describe("InvoiceScanStep — default action assignment", () => {
  it("defaults zero-price items to 'create' (not skip) so onboarding users can seed inventory without manual changes", async () => {
    await renderAndAdvanceToReview(ITEMS_ZERO_PRICE);
    const selector = screen.getByTestId("select-action-0") as HTMLSelectElement;
    expect(selector.value).toBe("create");
  });

  it("defaults items with no match to 'create'", async () => {
    await renderAndAdvanceToReview(ITEMS_UNIT_PRICE);
    const selector = screen.getByTestId("select-action-0") as HTMLSelectElement;
    expect(selector.value).toBe("create");
  });

  it("defaults high-confidence matched items to 'update'", async () => {
    await renderAndAdvanceToReview(ITEMS_WITH_MATCH);
    const selector = screen.getByTestId("select-action-0") as HTMLSelectElement;
    expect(selector.value).toBe("update");
  });

  it("defaults case-only items with no match to 'create'", async () => {
    await renderAndAdvanceToReview(ITEMS_CASE_ONLY);
    const selector = screen.getByTestId("select-action-0") as HTMLSelectElement;
    expect(selector.value).toBe("create");
  });
});
