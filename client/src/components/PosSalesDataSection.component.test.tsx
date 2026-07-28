// @vitest-environment jsdom
/**
 * Component tests for the save-before-OAuth gate in PosSalesDataSection.
 *
 * These tests exercise the handleConnectClick path that the API-level tests
 * cannot reach:
 *
 *   - A 422 (invalid combo) shows an inline error and suppresses the redirect.
 *   - A 409 retained_pos_connection shows the blocking dialog and suppresses
 *     the redirect.
 *   - A successful PATCH (200) allows the OAuth redirect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";

vitestExpect.extend(matchers);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface QueryClientProviderProps {
  children: React.ReactNode;
}

interface UseMutationOpts<TData> {
  mutationFn?: (...args: any[]) => Promise<TData>;
  onSuccess?: (data: TData) => void;
  onError?: (err: any) => void;
}

// ---------------------------------------------------------------------------
// Module mocks — declared before imports
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));

// useQuery returns data per query key; useMutation is a real pass-through stub
const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: any) => mockUseQuery(opts),
  useMutation: (opts: UseMutationOpts<unknown>) => mockUseMutation(opts),
  QueryClient: class {
    invalidateQueries = vi.fn();
  },
  QueryClientProvider: ({ children }: QueryClientProviderProps) => children,
}));

// Radix-based shadcn components can be brittle in jsdom — replace with thin
// pass-through or minimal interactive stubs so the test can focus on logic.

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => React.createElement("div", null, children),
  CardContent: ({ children }: any) => React.createElement("div", null, children),
  CardDescription: ({ children }: any) => React.createElement("p", null, children),
  CardHeader: ({ children }: any) => React.createElement("div", null, children),
  CardTitle: ({ children }: any) => React.createElement("span", null, children),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children, "data-testid": dtid, variant }: any) =>
    React.createElement("div", { "data-testid": dtid || "alert", "data-variant": variant }, children),
  AlertDescription: ({ children }: any) =>
    React.createElement("span", { "data-testid": "alert-description" }, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, "data-testid": dtid, disabled }: any) =>
    React.createElement("button", { "data-testid": dtid, onClick, disabled }, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => React.createElement("span", null, children),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: any) => React.createElement("label", null, children),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => React.createElement("hr", null),
}));

// Select — render a minimal stub; component reads value from company prop (no
// interaction needed for these tests).
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) =>
    React.createElement("div", { "data-select-value": value }, children),
  SelectContent: ({ children }: any) => React.createElement("div", null, children),
  SelectItem: ({ children, value }: any) =>
    React.createElement("option", { value }, children),
  SelectTrigger: ({ children, "data-testid": dtid }: any) =>
    React.createElement("div", { "data-testid": dtid }, children),
  SelectValue: ({ placeholder }: any) =>
    React.createElement("span", null, placeholder),
}));

// Dialog — render content when open=true so we can find text in the DOM.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? React.createElement("div", { "data-testid": "dialog-open" }, children) : null,
  DialogContent: ({ children }: any) =>
    React.createElement("div", { "data-testid": "dialog-content" }, children),
  DialogDescription: ({ children, className }: any) =>
    React.createElement("div", { "data-testid": "dialog-description" }, children),
  DialogFooter: ({ children }: any) =>
    React.createElement("div", null, children),
  DialogHeader: ({ children }: any) =>
    React.createElement("div", null, children),
  DialogTitle: ({ children }: any) =>
    React.createElement("h2", { "data-testid": "dialog-title" }, children),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => React.createElement("div", null, children),
  TooltipContent: ({ children }: any) => React.createElement("div", null, children),
  TooltipProvider: ({ children }: any) => React.createElement("div", null, children),
  TooltipTrigger: ({ children }: any) => React.createElement("div", null, children),
}));

// Lucide icons — stub every export to a no-op span so SVG doesn't trip up jsdom
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

import { PosSalesDataSection } from "./PosSalesDataSection";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_PROVIDERS = [
  {
    providerKey: "square",
    displayName: "Square",
    availability: "available",
    capabilities: {
      oauth: true,
      salesRetrieval: true,
      locationMapping: true,
      itemMapping: true,
      backfill: true,
    },
  },
];

const MOCK_SETUP_STATUS = {
  providerSelected: true,
  primaryMethodSelected: true,
  connectorAvailable: true,
  connectionStatus: "not_connected",
  locations: { total: 0, mapped: 0, ignored: 0, unresolved: 0 },
  items: { total: 0, mapped: 0, ignored: 0, unresolved: 0 },
  lastSuccessfulSyncAt: null,
  lastAttemptedSyncAt: null,
  latestSyncStatus: null,
  warningCount: 0,
};

/** Minimal Company shape sufficient for the component to render. */
function makeCompany(overrides: Record<string, any> = {}): any {
  return {
    id: "company-test-1",
    name: "Test Restaurant",
    posProvider: "square",
    primarySalesMethod: "pos_connector",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupQueryMocks() {
  mockUseQuery.mockImplementation((opts: any) => {
    const key = Array.isArray(opts.queryKey) ? opts.queryKey[0] : opts.queryKey;
    if (key === "/api/pos/providers") {
      return { data: MOCK_PROVIDERS, isLoading: false };
    }
    if (key === "/api/pos/connections") {
      return { data: [], isLoading: false };
    }
    if (key === "/api/pos/setup-status") {
      return { data: MOCK_SETUP_STATUS, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  });

  // useMutation — capture and forward the callbacks so onError/onSuccess fire.
  mockUseMutation.mockImplementation((opts: UseMutationOpts<unknown>) => ({
    mutate: async (payload: unknown) => {
      try {
        const data = await opts.mutationFn?.(payload);
        opts.onSuccess?.(data);
      } catch (err) {
        opts.onError?.(err);
      }
    },
    isPending: false,
  }));
}

function renderSection(companyOverrides: Record<string, any> = {}) {
  return render(
    React.createElement(PosSalesDataSection, {
      selectedCompanyId: "company-test-1",
      company: makeCompany(companyOverrides),
      onDirtyChange: vi.fn(),
    }),
  );
}

// ---------------------------------------------------------------------------
// location.href tracking
// ---------------------------------------------------------------------------

let mockLocationHref = "";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockLocationHref = "";
  Object.defineProperty(window, "location", {
    configurable: true,
    get: () => ({
      href: mockLocationHref,
      set href(v: string) { mockLocationHref = v; },
      pathname: "/settings",
      search: "",
    }),
  });

  setupQueryMocks();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("PosSalesDataSection — save-before-OAuth gate", () => {
  it("renders the Connect Square button when provider=square and method=pos_connector with no existing connection", async () => {
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId("button-square-connect")).toBeInTheDocument(),
    );
  });

  it("shows an inline error and does NOT redirect when PATCH returns 422", async () => {
    const errorMessage = "The selected POS provider does not support an electronic connection.";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          code: "invalid_pos_configuration",
          error: errorMessage,
        }),
      }),
    );

    renderSection();

    const connectBtn = await screen.findByTestId("button-square-connect");
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    // Inline error alert should appear
    await waitFor(() =>
      expect(screen.getByTestId("alert-description")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("alert-description").textContent).toContain(
      errorMessage,
    );

    // OAuth redirect must NOT have fired
    expect(mockLocationHref).not.toBe("/api/pos/connect/square");
  });

  it("opens the blocking dialog and does NOT redirect when PATCH returns 409 retained_pos_connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          code: "retained_pos_connection",
          error: "Cannot change POS provider while a connection exists.",
          provider: "square",
          connectionId: "conn-abc",
          connectionStatus: "active",
        }),
      }),
    );

    renderSection();

    const connectBtn = await screen.findByTestId("button-square-connect");
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    // Blocking dialog must open
    await waitFor(() =>
      expect(screen.getByTestId("dialog-open")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("dialog-title").textContent).toContain(
      "Cannot Change POS Provider",
    );

    // OAuth redirect must NOT have fired
    expect(mockLocationHref).not.toBe("/api/pos/connect/square");

    // No inline error message alongside the dialog
    expect(screen.queryByTestId("alert-description")).toBeNull();
  });

  it("redirects to /api/pos/connect/square when PATCH succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "company-test-1", posProvider: "square" }),
      }),
    );

    // Track window.location.href assignment directly
    let capturedHref = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      get: () => ({
        get href() { return capturedHref; },
        set href(v: string) { capturedHref = v; },
        pathname: "/settings",
        search: "",
      }),
    });

    renderSection();

    const connectBtn = await screen.findByTestId("button-square-connect");
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    await waitFor(() =>
      expect(capturedHref).toBe("/api/pos/connect/square"),
    );

    // No inline error
    expect(screen.queryByTestId("alert-description")).toBeNull();
  });
});
