// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect as vitestExpect } from "vitest";
import React from "react";

vitestExpect.extend(matchers);

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));

const preview = {
  batchId: "batch-1",
  status: "pending_review",
  vendorNameDetected: "Coca Cola",
  vendorId: "vendor-1",
  vendorName: "Coca Cola",
  invoiceCount: 1,
  lineCount: 2,
  resolvedLines: 1,
  heldLines: 1,
  resolvedDollars: 48,
  heldDollars: 24,
  holdReasonCounts: { no_vendor_item: 1 },
  alreadyImportedInvoices: [],
  reconciliation: [{
    invoiceNumber: "INV-1",
    invoiceDate: "2026-08-01",
    statedTotal: 72,
    lineSum: 72,
    gap: 0,
    reconciles: true,
  }],
  lines: [
    {
      lineId: "line-1",
      rowIndex: 0,
      invoiceNumber: "INV-1",
      invoiceDate: "2026-08-01",
      itemCode: "COKE-12",
      description: "Coca Cola 12oz",
      packSizeRaw: "2/12 EACH",
      category: "Beverages",
      glCode: "510200",
      qty: 2,
      extendedAmount: 48,
      status: "resolved",
      holdReason: null,
      matchStrategy: "vendor_sku",
      inventoryItemName: "Coca Cola 12oz",
      packCrossCheck: "match",
      derivedCasePrice: 24,
    },
    {
      lineId: "line-2",
      rowIndex: 1,
      invoiceNumber: "INV-1",
      invoiceDate: "2026-08-01",
      itemCode: "SPRITE-12",
      description: "Sprite 12oz",
      packSizeRaw: "2/12 EACH",
      category: null,
      glCode: null,
      qty: 1,
      extendedAmount: 24,
      status: "held",
      holdReason: "no_vendor_item",
      matchStrategy: null,
      inventoryItemName: null,
      packCrossCheck: null,
      derivedCasePrice: null,
    },
  ],
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: any) => {
    const key = String(opts?.queryKey?.[0] ?? "");
    if (key.includes("/preview")) return { data: preview, isLoading: false };
    return {
      data: [{
        id: "batch-1",
        originalFilename: "coca-cola.xlsx",
        vendorNameDetected: "Coca Cola",
        invoiceCount: 1,
        lineCount: 2,
        dateRangeStart: "2026-08-01",
        dateRangeEnd: "2026-08-01",
        totalAmount: 72,
        status: "pending_review",
        uploadedAt: "2026-08-18T12:00:00.000Z",
      }],
      isLoading: false,
    };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import VendorInvoiceImport from "./vendor-invoice-import";

describe("vendor invoice source accounting evidence", () => {
  beforeEach(() => {
    preview.status = "pending_review";
  });

  afterEach(cleanup);

  it("shows source GL Code and Category before approval and uses an em dash when absent", () => {
    render(<VendorInvoiceImport />);
    fireEvent.click(screen.getByTestId("button-view-batch-batch-1"));

    expect(screen.getByRole("columnheader", { name: "Source GL Code" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Source Category" })).toBeInTheDocument();
    expect(screen.getByTestId("text-source-gl-code-0")).toHaveTextContent("510200");
    expect(screen.getByTestId("text-source-category-0")).toHaveTextContent("Beverages");
    expect(screen.getByTestId("text-source-gl-code-1")).toHaveTextContent("—");
    expect(screen.getByTestId("text-source-category-1")).toHaveTextContent("—");
  });

  it("keeps the source evidence visible after approval", () => {
    preview.status = "approved";
    render(<VendorInvoiceImport />);
    fireEvent.click(screen.getByTestId("button-view-batch-batch-1"));

    expect(screen.getByTestId("alert-batch-approved")).toBeInTheDocument();
    expect(screen.getByTestId("text-source-gl-code-0")).toHaveTextContent("510200");
    expect(screen.getByTestId("text-source-category-0")).toHaveTextContent("Beverages");
  });
});