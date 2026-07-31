// @vitest-environment jsdom
/**
 * Component tests for GetOperationalCard.
 *
 * Covers:
 *   - Card renders for a brand-new account (0/5 complete)
 *   - Progress text and bar reflect the correct completed count
 *   - Each step row (menu, storage, invoice, orderly, count) reflects its
 *     completion signal from the milestones API or orderly batches API
 *   - Done steps show a checkmark; the first undone step is labelled "Next"
 *   - Dismiss button fires the mutation
 *   - Card is hidden when dismissed flag is true (persists across page loads)
 *   - Card auto-hides once all 5 steps are satisfied
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";

vitestExpect.extend(matchers);

// ── Hoisted mocks (available inside vi.mock factories) ────────────────────────

const {
  mockInvalidateQueries,
  mockUseQuery,
  mockUseMutation,
  mockCapturedMutate,
  mockMutateOnSuccess,
} = vi.hoisted(() => {
  const mockInvalidateQueries = vi.fn();
  const mockUseQuery = vi.fn();
  const mockUseMutation = vi.fn();
  const mockCapturedMutate = { current: vi.fn() };
  const mockMutateOnSuccess = { current: undefined as (() => void) | undefined };
  return {
    mockInvalidateQueries,
    mockUseQuery,
    mockUseMutation,
    mockCapturedMutate,
    mockMutateOnSuccess,
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: mockInvalidateQueries },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  useMutation: (opts: {
    mutationFn: () => Promise<unknown>;
    onSuccess?: () => void;
  }) => {
    mockMutateOnSuccess.current = opts.onSuccess;
    const mutate = vi.fn(() => {
      return Promise.resolve().then(() => opts.onSuccess?.());
    });
    mockCapturedMutate.current = mutate;
    return { mutate, isPending: false };
  },
  QueryClient: class {
    invalidateQueries = mockInvalidateQueries;
  },
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Import component after mocks ──────────────────────────────────────────────

import { GetOperationalCard } from "./get-operational-card";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a milestones API response with the given completed milestone IDs. */
function makeMilestonesResponse(
  completedIds: string[] = [],
  dismissed = false
) {
  const MILESTONE_DEFS = [
    { id: "menu_scan", label: "Scan Your Menu", path: "/onboarding" },
    { id: "storage_locations", label: "Set Up Storage", path: "/onboarding" },
    { id: "invoice_scan", label: "Scan an Invoice", path: "/onboarding" },
    { id: "inventory_count", label: "First Count", path: "/onboarding" },
  ];

  const milestones = MILESTONE_DEFS.map((m) => ({
    ...m,
    completed: completedIds.includes(m.id),
  }));

  return {
    milestones,
    completedCount: milestones.filter((m) => m.completed).length,
    totalCount: milestones.length,
    dismissed,
  };
}

/**
 * Configure useQuery to return the given state for the two queries the
 * component makes (milestones first, orderly batches second) and render.
 */
function renderCard(opts: {
  completedMilestoneIds?: string[];
  dismissed?: boolean;
  orderlyBatches?: unknown[];
  milestonesLoading?: boolean;
}) {
  const milestonesData = makeMilestonesResponse(
    opts.completedMilestoneIds ?? [],
    opts.dismissed ?? false
  );

  let callIndex = 0;
  mockUseQuery.mockImplementation(() => {
    callIndex += 1;
    if (callIndex % 2 === 1) {
      // First call: milestones query
      return {
        data: opts.milestonesLoading ? undefined : milestonesData,
        isLoading: opts.milestonesLoading ?? false,
      };
    }
    // Second call: orderly batches query
    return { data: opts.orderlyBatches ?? [] };
  });

  return render(React.createElement(GetOperationalCard));
}

// ── Teardown ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Suite: Card visibility ────────────────────────────────────────────────────

describe("GetOperationalCard — visibility", () => {
  it("renders the card for a brand-new account (nothing complete, not dismissed)", () => {
    renderCard({});
    expect(screen.getByTestId("get-operational-card")).toBeInTheDocument();
  });

  it("does NOT render while the milestones query is loading", () => {
    renderCard({ milestonesLoading: true });
    expect(screen.queryByTestId("get-operational-card")).not.toBeInTheDocument();
  });

  it("does NOT render when dismissed flag is true", () => {
    renderCard({ dismissed: true });
    expect(screen.queryByTestId("get-operational-card")).not.toBeInTheDocument();
  });

  it("auto-hides when all 5 steps are satisfied", () => {
    // All 4 milestone-driven steps complete + orderly batches present
    renderCard({
      completedMilestoneIds: [
        "menu_scan",
        "storage_locations",
        "invoice_scan",
        "inventory_count",
      ],
      orderlyBatches: [{ id: "batch-1" }],
    });
    expect(screen.queryByTestId("get-operational-card")).not.toBeInTheDocument();
  });

  it("still renders when only 4 of 5 steps are done (orderly missing)", () => {
    renderCard({
      completedMilestoneIds: [
        "menu_scan",
        "storage_locations",
        "invoice_scan",
        "inventory_count",
      ],
      orderlyBatches: [],
    });
    expect(screen.getByTestId("get-operational-card")).toBeInTheDocument();
  });
});

// ── Suite: Progress display ───────────────────────────────────────────────────

describe("GetOperationalCard — progress display", () => {
  it("shows '0 of 5 complete' for a brand-new account", () => {
    renderCard({});
    expect(
      screen.getByTestId("operational-card-progress-text")
    ).toHaveTextContent("0 of 5 complete");
  });

  it("shows '1 of 5 complete' when one milestone step is done", () => {
    renderCard({ completedMilestoneIds: ["menu_scan"] });
    expect(
      screen.getByTestId("operational-card-progress-text")
    ).toHaveTextContent("1 of 5 complete");
  });

  it("shows '2 of 5 complete' when menu milestone + orderly batches are done", () => {
    renderCard({
      completedMilestoneIds: ["menu_scan"],
      orderlyBatches: [{ id: "batch-1" }],
    });
    expect(
      screen.getByTestId("operational-card-progress-text")
    ).toHaveTextContent("2 of 5 complete");
  });

  it("shows '4 of 5 complete' when four steps are done", () => {
    renderCard({
      completedMilestoneIds: [
        "menu_scan",
        "storage_locations",
        "invoice_scan",
        "inventory_count",
      ],
    });
    expect(
      screen.getByTestId("operational-card-progress-text")
    ).toHaveTextContent("4 of 5 complete");
  });

  it("renders the progress bar element", () => {
    renderCard({});
    expect(
      screen.getByTestId("operational-card-progress-bar")
    ).toBeInTheDocument();
  });
});

// ── Suite: Step rows for a new account ───────────────────────────────────────

describe("GetOperationalCard — step rows for a new account", () => {
  it("renders the menu step row", () => {
    renderCard({});
    expect(screen.getByTestId("operational-step-menu")).toBeInTheDocument();
  });

  it("renders the storage step row", () => {
    renderCard({});
    expect(screen.getByTestId("operational-step-storage")).toBeInTheDocument();
  });

  it("renders the invoice step row", () => {
    renderCard({});
    expect(screen.getByTestId("operational-step-invoice")).toBeInTheDocument();
  });

  it("renders the orderly step row", () => {
    renderCard({});
    expect(screen.getByTestId("operational-step-orderly")).toBeInTheDocument();
  });

  it("renders the count step row", () => {
    renderCard({});
    expect(screen.getByTestId("operational-step-count")).toBeInTheDocument();
  });

  it("renders the step list container with all 5 rows", () => {
    renderCard({});
    const list = screen.getByTestId("operational-step-list");
    expect(list.children).toHaveLength(5);
  });
});

// ── Suite: Step completion signals ───────────────────────────────────────────

describe("GetOperationalCard — step completion signals", () => {
  it("marks the menu step done when menu_scan milestone is complete", () => {
    renderCard({ completedMilestoneIds: ["menu_scan"] });
    const label = screen.getByTestId("operational-step-label-menu");
    expect(label.className).toMatch(/line-through/);
  });

  it("marks the storage step done when storage_locations milestone is complete", () => {
    renderCard({ completedMilestoneIds: ["storage_locations"] });
    const label = screen.getByTestId("operational-step-label-storage");
    expect(label.className).toMatch(/line-through/);
  });

  it("marks the invoice step done when invoice_scan milestone is complete", () => {
    renderCard({ completedMilestoneIds: ["invoice_scan"] });
    const label = screen.getByTestId("operational-step-label-invoice");
    expect(label.className).toMatch(/line-through/);
  });

  it("marks the count step done when inventory_count milestone is complete", () => {
    renderCard({ completedMilestoneIds: ["inventory_count"] });
    const label = screen.getByTestId("operational-step-label-count");
    expect(label.className).toMatch(/line-through/);
  });

  it("marks the orderly step done when orderly batches array is non-empty", () => {
    renderCard({ orderlyBatches: [{ id: "b1" }, { id: "b2" }] });
    const label = screen.getByTestId("operational-step-label-orderly");
    expect(label.className).toMatch(/line-through/);
  });

  it("leaves the orderly step incomplete when orderly batches is empty", () => {
    renderCard({ orderlyBatches: [] });
    const label = screen.getByTestId("operational-step-label-orderly");
    expect(label.className).not.toMatch(/line-through/);
  });

  it("leaves a milestone step incomplete when its flag is not set", () => {
    renderCard({ completedMilestoneIds: [] });
    const label = screen.getByTestId("operational-step-label-menu");
    expect(label.className).not.toMatch(/line-through/);
  });
});

// ── Suite: Next-step highlight ────────────────────────────────────────────────

describe("GetOperationalCard — next-step highlight", () => {
  it("highlights the menu step as 'Next' when nothing is done", () => {
    renderCard({});
    const label = screen.getByTestId("operational-step-label-menu");
    expect(label.textContent).toMatch(/next/i);
  });

  it("highlights the storage step as 'Next' when menu is done", () => {
    renderCard({ completedMilestoneIds: ["menu_scan"] });
    const label = screen.getByTestId("operational-step-label-storage");
    expect(label.textContent).toMatch(/next/i);
  });

  it("highlights the orderly step as 'Next' when menu + storage + invoice are done", () => {
    renderCard({
      completedMilestoneIds: ["menu_scan", "storage_locations", "invoice_scan"],
    });
    const label = screen.getByTestId("operational-step-label-orderly");
    expect(label.textContent).toMatch(/next/i);
  });

  it("renders the 'Go' button only for the next (first undone) step", () => {
    renderCard({});
    expect(screen.getByTestId("button-go-operational-menu")).toBeInTheDocument();
    expect(
      screen.queryByTestId("button-go-operational-storage")
    ).not.toBeInTheDocument();
  });

  it("renders the bottom 'Continue' button pointing to the next step", () => {
    renderCard({});
    expect(
      screen.getByTestId("button-continue-operational")
    ).toBeInTheDocument();
  });
});

// ── Suite: Dismiss behaviour ──────────────────────────────────────────────────

describe("GetOperationalCard — dismiss", () => {
  it("renders the dismiss button", () => {
    renderCard({});
    expect(
      screen.getByTestId("button-dismiss-operational-card")
    ).toBeInTheDocument();
  });

  it("calls the dismiss mutation when the dismiss button is clicked", () => {
    renderCard({});
    fireEvent.click(screen.getByTestId("button-dismiss-operational-card"));
    expect(mockCapturedMutate.current).toHaveBeenCalledTimes(1);
  });

  it("invalidates the milestones query after the mutation succeeds", async () => {
    renderCard({});
    fireEvent.click(screen.getByTestId("button-dismiss-operational-card"));
    // Let microtask queue drain so onSuccess fires
    await Promise.resolve();
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/onboarding/milestones"],
    });
  });

  it("does not render when the milestones API returns dismissed: true (persists across loads)", () => {
    renderCard({ dismissed: true, completedMilestoneIds: [] });
    expect(
      screen.queryByTestId("get-operational-card")
    ).not.toBeInTheDocument();
  });
});
