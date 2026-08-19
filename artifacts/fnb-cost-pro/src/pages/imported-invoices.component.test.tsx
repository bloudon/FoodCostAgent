// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "wouter";

vitestExpect.extend(matchers);

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() }
}));

vi.mock("@/hooks/use-store-context", () => ({
  useStoreContext: () => ({ selectedStoreId: "store-1" }),
}));

vi.mock("@/hooks/use-tier", () => ({
  useTier: () => ({ hasFeature: () => true }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "user-1", role: "manager" } }),
}));

let mockLocation = "/orders";
const setMockLocation = vi.fn((loc) => { mockLocation = loc; });

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useLocation: () => [mockLocation, setMockLocation],
    useParams: () => ({ invoiceId: "inv-1" }),
    Link: React.forwardRef(({ href, children, ...props }: any, ref: any) =>
      React.createElement("a", { href, ref, ...props }, children)
    ),
  };
});

const mockImportedInvoices = [
  {
    id: "inv-1",
    kind: "historical_imported_invoice",
    sourceLabel: "Imported Invoice",
    invoiceNumber: "12345",
    invoiceDate: "2023-10-01",
    vendorId: "vendor-1",
    vendorName: "Sysco",
    storeId: "store-1",
    storeName: "Main Store",
    lineCount: 3,
    totalAmount: 150.00,
    originalFilename: "sysco_invoice.xlsx",
    approvedAt: "2023-10-02T10:00:00Z"
  }
];

const mockPurchaseOrders = [
  {
    id: "po-1",
    type: "purchase",
    status: "pending",
    createdAt: "2023-10-03T10:00:00Z",
    expectedDate: "2023-10-04",
    completedAt: null,
    vendorName: "US Foods",
    storeId: "store-1",
    lineCount: 5,
    totalAmount: 250.00
  }
];

const mockInvoiceDetail = {
  ...mockImportedInvoices[0],
  sourceSystem: "orderly",
  sourceInvoiceId: "src-1",
  subtotal: 140.00,
  taxAmount: 10.00,
  chargeAmount: null,
  creditAmount: null,
  lines: [
    {
      id: "line-1",
      sourceLineId: "src-line-1",
      description: "Chicken Breast",
      itemCode: null,
      quantity: 10,
      unitPrice: 14.00,
      lineTotal: 140.00,
      pack: null,
      sourceGlCode: null,
      sourceCategory: "Meat",
      resolutionStatus: "resolved",
      resolvedInventoryItemName: "Chicken"
    }
  ]
};

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useQuery: (opts: any) => {
      const key = String(opts?.queryKey?.[0] ?? "");
      if (key === "/api/imported-invoices/inv-1") {
        return { data: mockInvoiceDetail, isLoading: false };
      }
      if (key.includes("/api/imported-invoices")) return { data: mockImportedInvoices, isLoading: false };
      if (key.includes("/api/orders/unified")) return { data: mockPurchaseOrders, isLoading: false };
      if (key.includes("/api/purchase-orders")) return { data: mockPurchaseOrders, isLoading: false };
      if (key.includes("/api/vendors")) return { data: [{ id: "vendor-1", name: "Sysco" }], isLoading: false };
      if (key.includes("/api/quickbooks/status")) return { data: { connected: false }, isLoading: false };
      return { data: [], isLoading: false };
    },
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

import Orders from "./orders";
import Receiving from "./receiving";
import ImportedInvoiceDetail from "./imported-invoice-detail";

describe("Imported Invoices UI requirements", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("Orders page: renders imported rows with historical wording and detail links, without edit/receive actions", () => {
    render(<Orders />);

    // Row is rendered with Historical status
    const row = screen.getByTestId("row-order-inv-1");
    expect(row).toBeInTheDocument();
    
    // Status text
    const statusBadge = screen.getByTestId("badge-status-inv-1");
    expect(statusBadge).toHaveTextContent("Historical");

    // Action button should be View details, not Edit or Receive
    const viewButton = screen.getByTestId("button-view-imported-invoice-inv-1");
    expect(viewButton).toBeInTheDocument();
    expect(viewButton).toHaveTextContent("View details");
    expect(within(row).queryByRole("button", { name: /receive|edit|export/i })).not.toBeInTheDocument();
    
    // Normal purchase order has Edit or Receive
    const poEditButton = screen.getByTestId("button-edit-order-po-1");
    expect(poEditButton).toBeInTheDocument();

    // Click View details should navigate
    fireEvent.click(viewButton);
    expect(setMockLocation).toHaveBeenCalledWith("/imported-invoices/inv-1?from=orders");
  });

  it("Receiving page: renders historical disclaimer and only view details action", () => {
    render(<Receiving />);

    // Disclaimer text
    expect(screen.getByText(/do not prove stock was physically received/i)).toBeInTheDocument();

    // Row is rendered
    const row = screen.getByTestId("row-historical-invoice-inv-1");
    expect(row).toBeInTheDocument();

    // Action is View details
    const viewButton = screen.getByTestId("button-view-historical-invoice-inv-1");
    expect(viewButton).toBeInTheDocument();
    expect(viewButton).toHaveTextContent("View details");

    // Check normal pending orders list is present too
    expect(screen.getByTestId("row-pending-order-po-1")).toBeInTheDocument();
  });

  it("Detail page: renders missing source values as em dash and has no mutating controls", () => {
    window.history.replaceState({}, "", "/imported-invoices/inv-1?from=receiving");
    render(<ImportedInvoiceDetail />);

    // Historical badge
    expect(screen.getByTestId("badge-historical-label")).toHaveTextContent("Historical Imported Invoice");

    // Missing charge amount uses em dash
    expect(screen.getByTestId("text-charges")).toHaveTextContent("—");
    
    // Line item with missing item code and pack uses em dash
    expect(screen.getByTestId("text-item-code-0")).toHaveTextContent("—");
    expect(screen.getByTestId("text-pack-0")).toHaveTextContent("—");
    expect(screen.getByTestId("text-source-gl-0")).toHaveTextContent("—");
    expect(screen.getByTestId("button-back")).toHaveAttribute("href", "/receiving");

    // No mutating controls (edit/save buttons)
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });
});
