// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";
vitestExpect.extend(matchers);

// ---------------------------------------------------------------------------
// Interfaces for mock prop shapes
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
        onClick: () => onUploadComplete && onUploadComplete("test/menu.jpg"),
      },
      buttonText
    ),
}));

// ---------------------------------------------------------------------------
// Import the component under test
// ---------------------------------------------------------------------------

import { MenuScanStep } from "./onboarding-setup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMutationResult(): UseMutationResult {
  return { mutate: vi.fn(), isPending: false };
}

function setupMockMutation() {
  mockUseMutation.mockReturnValue(makeMutationResult());
}

const SCAN_RESPONSE = {
  sessionId: "sess-abc-123",
  items: [
    { name: "Margherita Pizza", department: "Mains", category: "", size: "", price: 14.99 },
    { name: "Caesar Salad",     department: "Starters", category: "", size: "", price: 8.99 },
  ],
  intelligence: {
    phones: [], addresses: [], locationCount: 1, multiLocationSignal: false,
  },
};

/**
 * Renders MenuScanStep, mocks the scan API, clicks upload, and waits for
 * the bar question card to appear.
 */
async function renderAndAdvanceToBarQuestion(
  onComplete = vi.fn(),
  initialHasBar?: number | null,
) {
  setupMockMutation();

  // First call: POST /api/onboarding/menu-scan → scan succeeds
  mockApiRequest.mockResolvedValueOnce({
    ok: true,
    json: async () => SCAN_RESPONSE,
  });

  render(React.createElement(MenuScanStep, { onComplete, initialHasBar }));

  // Upload card should be visible initially
  const uploadBtn = screen.getByTestId("button-upload-menu");
  fireEvent.click(uploadBtn);

  await waitFor(() =>
    expect(screen.getByTestId("card-step-bar-question")).toBeInTheDocument()
  );

  return { onComplete };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests — upload sub-step
// ---------------------------------------------------------------------------

describe("MenuScanStep — upload sub-step", () => {
  beforeEach(() => {
    setupMockMutation();
  });

  it("renders the upload card initially", () => {
    render(React.createElement(MenuScanStep, { onComplete: vi.fn() }));
    expect(screen.getByTestId("card-step-menu-scan")).toBeInTheDocument();
  });

  it("shows the upload button", () => {
    render(React.createElement(MenuScanStep, { onComplete: vi.fn() }));
    expect(screen.getByTestId("button-upload-menu")).toBeInTheDocument();
  });

  it("does not show the bar question before scanning", () => {
    render(React.createElement(MenuScanStep, { onComplete: vi.fn() }));
    expect(screen.queryByTestId("card-step-bar-question")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — bar question card appearance
// ---------------------------------------------------------------------------

describe("MenuScanStep — bar question sub-step appearance", () => {
  it("shows the bar question card after a successful scan", async () => {
    await renderAndAdvanceToBarQuestion();
    expect(screen.getByTestId("card-step-bar-question")).toBeInTheDocument();
  });

  it("renders the Yes tile", async () => {
    await renderAndAdvanceToBarQuestion();
    expect(screen.getByTestId("tile-has-bar-yes")).toBeInTheDocument();
  });

  it("renders the No tile", async () => {
    await renderAndAdvanceToBarQuestion();
    expect(screen.getByTestId("tile-has-bar-no")).toBeInTheDocument();
  });

  it("renders the skip button", async () => {
    await renderAndAdvanceToBarQuestion();
    expect(screen.getByTestId("button-skip-bar-question")).toBeInTheDocument();
  });

  it("shows the tile grid container", async () => {
    await renderAndAdvanceToBarQuestion();
    expect(screen.getByTestId("bar-question-tiles")).toBeInTheDocument();
  });

  it("does not show the upload card after scan completes", async () => {
    await renderAndAdvanceToBarQuestion();
    expect(screen.queryByTestId("card-step-menu-scan")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — Yes / No tile interactions
// ---------------------------------------------------------------------------

describe("MenuScanStep — bar question tile interactions", () => {
  it("clicking Yes calls PATCH /api/onboarding/has-bar with hasBar: true", async () => {
    await renderAndAdvanceToBarQuestion();

    // PATCH call mock
    mockApiRequest.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    fireEvent.click(screen.getByTestId("tile-has-bar-yes"));

    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith(
        "PATCH",
        "/api/onboarding/has-bar",
        { hasBar: true }
      )
    );
  });

  it("clicking No calls PATCH /api/onboarding/has-bar with hasBar: false", async () => {
    await renderAndAdvanceToBarQuestion();

    mockApiRequest.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    fireEvent.click(screen.getByTestId("tile-has-bar-no"));

    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith(
        "PATCH",
        "/api/onboarding/has-bar",
        { hasBar: false }
      )
    );
  });

  it("clicking Yes advances to the review card", async () => {
    await renderAndAdvanceToBarQuestion();
    mockApiRequest.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    fireEvent.click(screen.getByTestId("tile-has-bar-yes"));

    await waitFor(() =>
      expect(screen.getByTestId("card-step-menu-review")).toBeInTheDocument()
    );
  });

  it("clicking No advances to the review card", async () => {
    await renderAndAdvanceToBarQuestion();
    mockApiRequest.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    fireEvent.click(screen.getByTestId("tile-has-bar-no"));

    await waitFor(() =>
      expect(screen.getByTestId("card-step-menu-review")).toBeInTheDocument()
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — Skip button
// ---------------------------------------------------------------------------

describe("MenuScanStep — bar question skip behaviour", () => {
  it("clicking Skip does NOT call PATCH /api/onboarding/has-bar", async () => {
    await renderAndAdvanceToBarQuestion();

    // Record call count before skip
    const callsBefore = mockApiRequest.mock.calls.length;

    fireEvent.click(screen.getByTestId("button-skip-bar-question"));

    // No additional apiRequest calls after skip
    expect(mockApiRequest.mock.calls.length).toBe(callsBefore);
  });

  it("clicking Skip advances to the review card", async () => {
    await renderAndAdvanceToBarQuestion();

    fireEvent.click(screen.getByTestId("button-skip-bar-question"));

    await waitFor(() =>
      expect(screen.getByTestId("card-step-menu-review")).toBeInTheDocument()
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — Pre-selection from initialHasBar
// ---------------------------------------------------------------------------

describe("MenuScanStep — pre-selection from prior answer", () => {
  it("Yes tile has active styling when initialHasBar is 1", async () => {
    await renderAndAdvanceToBarQuestion(vi.fn(), 1);
    const yesTile = screen.getByTestId("tile-has-bar-yes");
    expect(yesTile.className).toContain("bg-primary/5");
  });

  it("No tile does not have active styling when initialHasBar is 1", async () => {
    await renderAndAdvanceToBarQuestion(vi.fn(), 1);
    const noTile = screen.getByTestId("tile-has-bar-no");
    expect(noTile.className).not.toContain("bg-primary/5");
  });

  it("No tile has active styling when initialHasBar is 0", async () => {
    await renderAndAdvanceToBarQuestion(vi.fn(), 0);
    const noTile = screen.getByTestId("tile-has-bar-no");
    expect(noTile.className).toContain("bg-primary/5");
  });

  it("Yes tile does not have active styling when initialHasBar is 0", async () => {
    await renderAndAdvanceToBarQuestion(vi.fn(), 0);
    const yesTile = screen.getByTestId("tile-has-bar-yes");
    expect(yesTile.className).not.toContain("bg-primary/5");
  });

  it("neither tile has active styling when initialHasBar is null", async () => {
    await renderAndAdvanceToBarQuestion(vi.fn(), null);
    const yesTile = screen.getByTestId("tile-has-bar-yes");
    const noTile  = screen.getByTestId("tile-has-bar-no");
    expect(yesTile.className).not.toContain("bg-primary/5");
    expect(noTile.className).not.toContain("bg-primary/5");
  });

  it("neither tile has active styling when initialHasBar is undefined", async () => {
    await renderAndAdvanceToBarQuestion(vi.fn(), undefined);
    const yesTile = screen.getByTestId("tile-has-bar-yes");
    const noTile  = screen.getByTestId("tile-has-bar-no");
    expect(yesTile.className).not.toContain("bg-primary/5");
    expect(noTile.className).not.toContain("bg-primary/5");
  });
});
