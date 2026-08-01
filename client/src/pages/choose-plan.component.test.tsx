// @vitest-environment jsdom
/**
 * choose-plan.tsx — Component rendering tests
 *
 * Verifies three critical rendering states:
 *   A. Active subscriber  → account overview (plan/status/locations/capabilities)
 *   B. No plan            → trial-signup flow (14-day trial CTA)
 *   C. Fetch error        → blocking error message (NOT trial checkout)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";

vitestExpect.extend(matchers);

// ── Minimal interfaces ───────────────────────────────────────────────────────

interface QueryClientProviderProps { children: React.ReactNode }

// ── useQuery / useMutation control ───────────────────────────────────────────

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();

// ── Mocks (declared before component import) ─────────────────────────────────

vi.mock("wouter", () => ({
  useLocation: () => ["/choose-plan", vi.fn()],
  useSearch: () => "",
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-company", () => ({
  useCompany: () => ({ selectedCompanyId: "test-company-id" }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "test@test.com" } }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/components/restaurant-background", () => ({
  RestaurantBackground: () => React.createElement("div", { "data-testid": "bg" }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
  useMutation: (opts: unknown) => mockUseMutation(opts),
  QueryClient: class { invalidateQueries = vi.fn(); },
  QueryClientProvider: ({ children }: QueryClientProviderProps) => children,
}));

vi.mock("@shared/plan-catalog", () => ({
  PRICING: { platform: { monthly: 149, annual: 129 } },
  CORE_PLATFORM_CAPABILITIES: [
    "Recipe cost intelligence",
    "Inventory tracking",
    "Vendor price management",
  ],
  MULTI_LOCATION_CAPABILITIES: ["Multi-location reporting"],
  ENTERPRISE_CAPABILITIES: ["Custom reporting", "Dedicated CSM", "SSO", "SLA"],
  ADDITIONAL_LOCATION_PRICING: { monthlyCents: 4900, annualCents: 3900 },
}));

// Static import — must come after all vi.mock() declarations
import ChoosePlan from "./choose-plan";

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupMutation() {
  mockUseMutation.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
}

function renderPage() {
  return render(React.createElement(ChoosePlan));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("choose-plan.tsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    setupMutation();
  });

  // ── A: Active subscriber ─────────────────────────────────────────────────

  describe("when the user has an active subscription", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: {
          plan: "platform",
          status: "active",
          billingInterval: "monthly",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          licensedLocationCount: 2,
          activeLocationCount: 1,
        },
        isLoading: false,
        isError: false,
      });
    });

    it("shows the account overview section (not trial signup)", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("account-overview")).toBeTruthy();
      });
      expect(screen.queryByTestId("trial-signup")).toBeNull();
    });

    it("shows the active status badge", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("badge-status-active")).toBeTruthy();
      });
    });

    it("shows the locations card", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("card-locations")).toBeTruthy();
      });
    });

    it("shows the capabilities checklist card", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("card-capabilities")).toBeTruthy();
      });
      expect(screen.getByText("Recipe cost intelligence")).toBeTruthy();
    });

    it("shows the enterprise card", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("card-enterprise")).toBeTruthy();
      });
    });

    it("shows the Back to Dashboard button", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("button-back-to-dashboard")).toBeTruthy();
      });
    });

    it("does NOT show the start-trial CTA button", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("account-overview")).toBeTruthy();
      });
      expect(screen.queryByTestId("button-start-trial")).toBeNull();
    });
  });

  // ── A2: Trialing ─────────────────────────────────────────────────────────

  describe("when the user has a trialing subscription", () => {
    beforeEach(() => {
      const future = new Date();
      future.setDate(future.getDate() + 5);
      mockUseQuery.mockReturnValue({
        data: {
          plan: "platform",
          status: "trialing",
          billingInterval: "monthly",
          currentPeriodEnd: future.toISOString(),
          licensedLocationCount: 1,
          activeLocationCount: 1,
        },
        isLoading: false,
        isError: false,
      });
    });

    it("shows the trialing status badge", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("badge-status-trialing")).toBeTruthy();
      });
    });

    it("shows the account overview (not trial signup)", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("account-overview")).toBeTruthy();
      });
      expect(screen.queryByTestId("trial-signup")).toBeNull();
    });
  });

  // ── B: No plan ───────────────────────────────────────────────────────────

  describe("when the user has no plan", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: {
          plan: null,
          status: null,
          billingInterval: null,
          currentPeriodEnd: null,
          licensedLocationCount: 1,
          activeLocationCount: 0,
        },
        isLoading: false,
        isError: false,
      });
    });

    it("shows the trial signup flow (not account overview)", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("trial-signup")).toBeTruthy();
      });
      expect(screen.queryByTestId("account-overview")).toBeNull();
    });

    it("shows the trial badge", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("badge-trial")).toBeTruthy();
      });
    });

    it("shows the start-trial CTA button", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("button-start-trial")).toBeTruthy();
      });
    });

    it("shows the monthly/annual toggle buttons", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("button-term-monthly")).toBeTruthy();
        expect(screen.getByTestId("button-term-annual")).toBeTruthy();
      });
    });

    it("shows the platform plan card with capabilities", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("card-platform-plan")).toBeTruthy();
      });
      expect(screen.getByText("Recipe cost intelligence")).toBeTruthy();
    });
  });

  // ── C: Fetch error (critical — must NOT show trial checkout) ─────────────

  describe("when the subscription fetch fails", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      });
    });

    it("shows the blocking error message", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("subscription-fetch-error")).toBeTruthy();
      });
    });

    it("does NOT show the trial signup flow", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("subscription-fetch-error")).toBeTruthy();
      });
      expect(screen.queryByTestId("trial-signup")).toBeNull();
    });

    it("does NOT show the account overview", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("subscription-fetch-error")).toBeTruthy();
      });
      expect(screen.queryByTestId("account-overview")).toBeNull();
    });

    it("does NOT show the start-trial CTA button", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId("subscription-fetch-error")).toBeTruthy();
      });
      expect(screen.queryByTestId("button-start-trial")).toBeNull();
    });
  });

  // ── Loading spinner ──────────────────────────────────────────────────────

  describe("while loading", () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });
    });

    it("shows neither trial signup nor account overview while loading", async () => {
      renderPage();
      expect(screen.queryByTestId("trial-signup")).toBeNull();
      expect(screen.queryByTestId("account-overview")).toBeNull();
      expect(screen.queryByTestId("subscription-fetch-error")).toBeNull();
    });
  });
});
