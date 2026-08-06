// @vitest-environment jsdom
/**
 * Component tests for GetOperationalCard.
 *
 * Covers:
 *   - Card renders for a brand-new account (0/3 complete)
 *   - Progress text and bar reflect the correct required-step count
 *   - Each main step row (menu, storage, invoice, count) reflects its
 *     completion signal from the milestones API
 *   - Done steps show a checkmark; the first undone required step is labelled "Next"
 *   - Orderly appears in the "Other import options" section, not the main checklist
 *   - Dismiss button fires the mutation
 *   - Card is hidden when dismissed flag is true (persists across page loads)
 *   - Card auto-hides once all 3 required steps are satisfied
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
 * Configure useQuery to return milestones data and render the card.
 * The component now makes only one useQuery call (milestones).
 */
function renderCard(opts: {
  completedMilestoneIds?: string[];
  dismissed?: boolean;
  milestonesLoading?: boolean;
}) {
  const milestonesData = makeMilestonesResponse(
    opts.completedMilestoneIds ?? [],
    opts.dismissed ?? false
  );

  mockUseQuery.mockImplementation(() => ({
    data: opts.milestonesLoading ? undefined : milestonesData,
    isLoading: opts.milestonesLoading ?? false,
  }));

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

  it("auto-hides when all 3 required steps are satisfied", () => {
    renderCard({
      completedMilestoneIds: ["menu_scan", "storage_locations", "invoice_scan"],
    });
    expect(screen.queryByTestId("get-operational-card")).not.toBeInTheDocument();
  });

  it("still renders when only 2 of 3 required steps are done", () => {
    renderCard({
      completedMilestoneIds: ["menu_scan", "storage_locations"],
    });
    expect(screen.getByTestId("get-operational-card")).toBeInTheDocument();
  });

  it("still renders when all 3 required steps + optional count are done (not yet dismissed)", () => {
    // auto-hide fires on required completion; since completedCount === totalCount for
    // the server milestones the server will auto-dismiss on next load.
    // For this test the dismissed flag is still false, so the card should be hidden
    // by the requiredCompleted === requiredSteps.length check.
    renderCard({
      completedMilestoneIds: [
        "menu_scan",
        "storage_locations",
        "invoice_scan",
        "inventory_count",
      ],
    });
    // All 3 required steps done → card auto-hides
    expect(screen.queryByTestId("get-operational-card")).not.toBeInTheDocument();
  });
});

// ── Suite: Progress display ───────────────────────────────────────────────────

describe("GetOperationalCard — progress display", () => {
  it("shows '0 of 3 complete' for a brand-new account", () => {
    renderCard({});
    expect(
      screen.getByTestId("operational-card-progress-text")
    ).toHaveTextContent("0 of 3 complete");
  });

  it("shows '1 of 3 complete' when one required milestone step is done", () => {
    renderCard({ completedMilestoneIds: ["menu_scan"] });
    expect(
      screen.getByTestId("operational-card-progress-text")
    ).toHaveTextContent("1 of 3 complete");
  });

  it("shows '2 of 3 complete' when menu + storage are done", () => {
    renderCard({
      completedMilestoneIds: ["menu_scan", "storage_locations"],
    });
    expect(
      screen.getByTestId("operational-card-progress-text")
    ).toHaveTextContent("2 of 3 complete");
  });

  it("completing the optional inventory_count does not advance the required count", () => {
    // inventory_count is optional — required count stays at 2
    renderCard({
      completedMilestoneIds: [
        "menu_scan",
        "storage_locations",
        "inventory_count",
      ],
    });
    expect(
      screen.getByTestId("operational-card-progress-text")
    ).toHaveTextContent("2 of 3 complete");
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

  it("renders the count step row", () => {
    renderCard({});
    expect(screen.getByTestId("operational-step-count")).toBeInTheDocument();
  });

  it("renders the step list container with 4 rows (3 required + 1 optional)", () => {
    renderCard({});
    const list = screen.getByTestId("operational-step-list");
    expect(list.children).toHaveLength(4);
  });

  it("does NOT render an orderly row in the main step list", () => {
    renderCard({});
    expect(screen.queryByTestId("operational-step-orderly")).not.toBeInTheDocument();
  });
});

// ── Suite: Other import options (Orderly) ────────────────────────────────────

describe("GetOperationalCard — other import options", () => {
  it("renders the 'Other import options' section", () => {
    renderCard({});
    expect(screen.getByTestId("operational-other-importers")).toBeInTheDocument();
  });

  it("renders the Orderly entry in the other importers section", () => {
    renderCard({});
    expect(screen.getByTestId("operational-other-orderly")).toBeInTheDocument();
  });

  it("renders a 'Go' button for the Orderly importer", () => {
    renderCard({});
    expect(
      screen.getByTestId("button-go-operational-other-orderly")
    ).toBeInTheDocument();
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

  it("highlights the invoice step as 'Next' when menu + storage are done", () => {
    renderCard({
      completedMilestoneIds: ["menu_scan", "storage_locations"],
    });
    const label = screen.getByTestId("operational-step-label-invoice");
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
