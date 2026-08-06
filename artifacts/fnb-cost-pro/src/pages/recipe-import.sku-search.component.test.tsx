// @vitest-environment jsdom
/**
 * Regression guard: SKU search in the real InventoryCombobox exported from recipe-import.tsx.
 *
 * The component sets each CommandItem's value to:
 *
 *   value={item.pluSku ? `${item.name} ${item.pluSku}` : item.name}
 *
 * The cmdk library filters visible items by matching the CommandInput text
 * against those `value` strings.  If `pluSku` is ever dropped from the value,
 * renamed, or the expression changes, users would get no results when they type
 * a SKU — and these tests would catch it before it ships.
 *
 * The real `InventoryCombobox` component (exported from recipe-import.tsx) is
 * rendered directly, so any code change to the production component is
 * immediately reflected in test results.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";

vitestExpect.extend(matchers);

// ---------------------------------------------------------------------------
// jsdom polyfills required by cmdk and Radix UI
// ---------------------------------------------------------------------------

beforeAll(() => {
  // cmdk's CommandList observes list height with ResizeObserver
  if (typeof (global as Record<string, unknown>).ResizeObserver === "undefined") {
    (global as Record<string, unknown>).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // cmdk scrolls the selected item into view; jsdom stubs don't implement this
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // Radix UI Popover checks hasPointerCapture on elements
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

// ---------------------------------------------------------------------------
// Mocks required so recipe-import.tsx can be imported without crashing
// (InventoryCombobox itself uses none of these — they are page-level imports)
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/recipe-import", vi.fn()],
  useSearch: () => "",
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/components/ObjectUploader", () => ({
  ObjectUploader: () => null,
}));

vi.mock("@/components/tier-gate", () => ({
  TierGate: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  QueryClient: class { invalidateQueries = vi.fn(); },
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Import the real production component under test
// ---------------------------------------------------------------------------

import { InventoryCombobox } from "./recipe-import";

// ---------------------------------------------------------------------------
// Shared fixture — same InventoryItem shape used by recipe-import.tsx
// ---------------------------------------------------------------------------

interface TestItem {
  id: string;
  name: string;
  pluSku?: string | null;
}

const ITEMS: TestItem[] = [
  { id: "item-tomato",  name: "Tomato Roma",       pluSku: "TOM-001" },
  { id: "item-cheese",  name: "Cheese Mozzarella",  pluSku: "CHZ-999" },
  { id: "item-nosku",   name: "Basil Fresh",         pluSku: null },
];

// ---------------------------------------------------------------------------
// Helper: render the component and open the popover
// ---------------------------------------------------------------------------

async function renderAndOpen(items: TestItem[] = ITEMS): Promise<void> {
  render(
    React.createElement(InventoryCombobox, {
      value: null,
      items,
      onChange: vi.fn(),
      testId: "test-combobox-trigger",
    })
  );

  // The trigger button renders the combobox label
  const trigger = screen.getByTestId("test-combobox-trigger");
  expect(trigger).toBeInTheDocument();

  // Click to open the Popover
  fireEvent.click(trigger);

  // The Command input inside the PopoverContent should now be visible
  await waitFor(() =>
    expect(screen.getByPlaceholderText("Search inventory...")).toBeInTheDocument(),
    { timeout: 3000 }
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InventoryCombobox (recipe-import.tsx) — SKU search", () => {
  it("renders the trigger button", () => {
    render(
      React.createElement(InventoryCombobox, {
        value: null,
        items: ITEMS,
        onChange: vi.fn(),
        testId: "test-combobox-trigger",
      })
    );
    expect(screen.getByTestId("test-combobox-trigger")).toBeInTheDocument();
  });

  it("shows the CommandInput after clicking the trigger", async () => {
    await renderAndOpen();
    expect(screen.getByPlaceholderText("Search inventory...")).toBeInTheDocument();
  });

  it("displays all items when the search input is empty", async () => {
    await renderAndOpen();
    expect(screen.getByText("Tomato Roma")).toBeInTheDocument();
    expect(screen.getByText("Cheese Mozzarella")).toBeInTheDocument();
    expect(screen.getByText("Basil Fresh")).toBeInTheDocument();
  });

  it("surfaces only Tomato Roma when its PLU/SKU (TOM-001) is typed", async () => {
    await renderAndOpen();

    const input = screen.getByPlaceholderText("Search inventory...");
    fireEvent.change(input, { target: { value: "TOM-001" } });

    // Item whose value includes the SKU must appear
    await waitFor(() => expect(screen.getByText("Tomato Roma")).toBeInTheDocument());

    // Others must be hidden
    expect(screen.queryByText("Cheese Mozzarella")).not.toBeInTheDocument();
    expect(screen.queryByText("Basil Fresh")).not.toBeInTheDocument();
  });

  it("surfaces only Cheese Mozzarella when its SKU (CHZ-999) is typed", async () => {
    await renderAndOpen();

    const input = screen.getByPlaceholderText("Search inventory...");
    fireEvent.change(input, { target: { value: "CHZ-999" } });

    await waitFor(() => expect(screen.getByText("Cheese Mozzarella")).toBeInTheDocument());
    expect(screen.queryByText("Tomato Roma")).not.toBeInTheDocument();
    expect(screen.queryByText("Basil Fresh")).not.toBeInTheDocument();
  });

  it("still surfaces Basil Fresh by name when it has no pluSku", async () => {
    await renderAndOpen();

    const input = screen.getByPlaceholderText("Search inventory...");
    fireEvent.change(input, { target: { value: "Basil" } });

    await waitFor(() => expect(screen.getByText("Basil Fresh")).toBeInTheDocument());
    expect(screen.queryByText("Tomato Roma")).not.toBeInTheDocument();
    expect(screen.queryByText("Cheese Mozzarella")).not.toBeInTheDocument();
  });

  it("restores all items when the search input is cleared", async () => {
    await renderAndOpen();
    const input = screen.getByPlaceholderText("Search inventory...");

    fireEvent.change(input, { target: { value: "TOM-001" } });
    await waitFor(() => expect(screen.getByText("Tomato Roma")).toBeInTheDocument());
    expect(screen.queryByText("Cheese Mozzarella")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });

    await waitFor(() => {
      expect(screen.getByText("Tomato Roma")).toBeInTheDocument();
      expect(screen.getByText("Cheese Mozzarella")).toBeInTheDocument();
      expect(screen.getByText("Basil Fresh")).toBeInTheDocument();
    });
  });

  it("shows 'No items found.' when the typed text matches nothing", async () => {
    await renderAndOpen();

    const input = screen.getByPlaceholderText("Search inventory...");
    fireEvent.change(input, { target: { value: "XYZZY-NOMATCH" } });

    await waitFor(() =>
      expect(screen.getByText("No items found.")).toBeInTheDocument()
    );
  });

  it("name search works alongside SKU search", async () => {
    await renderAndOpen();

    const input = screen.getByPlaceholderText("Search inventory...");
    fireEvent.change(input, { target: { value: "cheese" } });

    await waitFor(() => expect(screen.getByText("Cheese Mozzarella")).toBeInTheDocument());
    expect(screen.queryByText("Tomato Roma")).not.toBeInTheDocument();
    expect(screen.queryByText("Basil Fresh")).not.toBeInTheDocument();
  });

  it("calls onChange with the selected item's id and name when an item is chosen", async () => {
    const onChange = vi.fn();
    render(
      React.createElement(InventoryCombobox, {
        value: null,
        items: ITEMS,
        onChange,
        testId: "test-combobox-trigger",
      })
    );

    fireEvent.click(screen.getByTestId("test-combobox-trigger"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Search inventory...")).toBeInTheDocument()
    );

    // Click the "Tomato Roma" option
    fireEvent.click(screen.getByText("Tomato Roma"));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("item-tomato", "Tomato Roma");
    });
  });
});
