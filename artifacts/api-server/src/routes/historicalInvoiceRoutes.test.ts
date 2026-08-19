import express from "express";
import supertest from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  authenticated: true,
  user: {
    id: "imported-invoice-route-user",
    companyId: "imported-invoice-route-company",
    role: "company_admin",
  } as any,
}));

const serviceMocks = vi.hoisted(() => ({
  listImportedInvoices: vi.fn(),
  getImportedInvoiceDetail: vi.fn(),
  previewHistoricalInvoiceLineResolution: vi.fn(),
  searchHistoricalInvoiceResolutionCandidates: vi.fn(),
  confirmHistoricalInvoiceLineResolution: vi.fn(),
}));

vi.mock("../auth", () => ({
  requireAuth: vi.fn((req: any, res: any, next: any) => {
    if (!authState.authenticated) {
      return res.status(401).json({ message: "Authentication required" });
    }
    req.user = authState.user;
    req.companyId = authState.user.companyId;
    next();
  }),
  requireTier: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock("../services/orderly/importedInvoiceRead", () => serviceMocks);
vi.mock("../services/orderly/historicalInvoiceResolution", () => {
  class HistoricalInvoiceResolutionError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
  return {
    HistoricalInvoiceResolutionError,
    previewHistoricalInvoiceLineResolution: serviceMocks.previewHistoricalInvoiceLineResolution,
    searchHistoricalInvoiceResolutionCandidates: serviceMocks.searchHistoricalInvoiceResolutionCandidates,
    confirmHistoricalInvoiceLineResolution: serviceMocks.confirmHistoricalInvoiceLineResolution,
  };
});

let registerHistoricalInvoiceRoutes: (app: express.Express) => void;

function buildApp() {
  const app = express();
  app.use(express.json());
  registerHistoricalInvoiceRoutes(app);
  return app;
}

beforeAll(async () => {
  ({ registerHistoricalInvoiceRoutes } = await import("./historicalInvoiceRoutes"));
});

beforeEach(() => {
  authState.authenticated = true;
  authState.user = {
    id: "imported-invoice-route-user",
    companyId: "imported-invoice-route-company",
    role: "company_admin",
  };
  serviceMocks.listImportedInvoices.mockReset();
  serviceMocks.getImportedInvoiceDetail.mockReset();
  serviceMocks.previewHistoricalInvoiceLineResolution.mockReset();
  serviceMocks.searchHistoricalInvoiceResolutionCandidates.mockReset();
  serviceMocks.confirmHistoricalInvoiceLineResolution.mockReset();
});

describe("historical imported invoice HTTP routes", () => {
  it("returns 401 without authentication and does not invoke the list service", async () => {
    authState.authenticated = false;

    const response = await supertest(buildApp()).get("/api/imported-invoices");

    expect(response.status).toBe(401);
    expect(serviceMocks.listImportedInvoices).not.toHaveBeenCalled();
  });

  it("returns the authenticated company's imported invoice summaries", async () => {
    const summary = {
      id: "historical-invoice-1",
      kind: "imported_invoice",
      sourceLabel: "Historical Imported Invoice",
      invoiceNumber: "CC-100",
      invoiceDate: "2026-05-01",
      vendorId: null,
      vendorName: "Coca Cola",
      storeId: "store-1",
      lineCount: 4,
      totalAmount: 125,
    };
    serviceMocks.listImportedInvoices.mockResolvedValue([summary]);

    const response = await supertest(buildApp()).get("/api/imported-invoices");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([summary]);
    expect(serviceMocks.listImportedInvoices).toHaveBeenCalledWith(
      authState.user,
      authState.user.companyId,
    );
  });

  it("returns 404 without revealing an inaccessible or missing invoice", async () => {
    serviceMocks.getImportedInvoiceDetail.mockResolvedValue(null);

    const response = await supertest(buildApp())
      .get("/api/imported-invoices/inaccessible-invoice");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Invoice not found." });
    expect(serviceMocks.getImportedInvoiceDetail).toHaveBeenCalledWith(
      "inaccessible-invoice",
      authState.user,
      authState.user.companyId,
    );
  });

  it("returns the read-only detail contract for an accessible invoice", async () => {
    const detail = {
      id: "historical-invoice-1",
      kind: "imported_invoice",
      sourceLabel: "Historical Imported Invoice",
      invoiceNumber: "CC-100",
      invoiceDate: "2026-05-01",
      vendorId: null,
      vendorName: "Coca Cola",
      storeId: "store-1",
      lineCount: 1,
      totalAmount: 25,
      sourceSystem: "ORDERLY",
      sourceInvoiceId: "xlsx:coca-cola:CC-100",
      lines: [{
        id: "historical-line-1",
        sourceLineId: "xlsx-row-1",
        resolutionStatus: "unresolved",
        description: "Coca Cola",
        sourceGlCode: null,
        sourceCategory: null,
      }],
    };
    serviceMocks.getImportedInvoiceDetail.mockResolvedValue(detail);

    const response = await supertest(buildApp())
      .get("/api/imported-invoices/historical-invoice-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(detail);
  });

  it("previews a selected vendor product within the authenticated invoice line", async () => {
    const preview = {
      impact: { occurrenceCount: 3, affectedOccurrenceCount: 2, spend: 95 },
      classification: { status: "SAFE_CANDIDATE", canConfirm: true },
    };
    serviceMocks.previewHistoricalInvoiceLineResolution.mockResolvedValue(preview);

    const response = await supertest(buildApp())
      .get("/api/imported-invoices/invoice-1/lines/line-1/resolution-preview")
      .query({ vendorItemId: "vendor-item-1" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(preview);
    expect(serviceMocks.previewHistoricalInvoiceLineResolution).toHaveBeenCalledWith(
      "invoice-1",
      "line-1",
      "vendor-item-1",
      authState.user,
      authState.user.companyId,
    );
  });

  it("returns 409 when a competing mapping blocks confirmation", async () => {
    const { HistoricalInvoiceResolutionError } = await import("../services/orderly/historicalInvoiceResolution");
    serviceMocks.confirmHistoricalInvoiceLineResolution.mockRejectedValue(
      new HistoricalInvoiceResolutionError("CONFLICT" as any, "A competing mapping already exists."),
    );

    const response = await supertest(buildApp())
      .post("/api/imported-invoices/invoice-1/lines/line-1/resolve")
      .send({ vendorItemId: "vendor-item-1", confirm: true });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "A competing mapping already exists." });
  });

  it.each([
    {
      method: "get",
      path: "/api/imported-invoices/invoice-1/lines/line-1/resolution-preview",
      service: "previewHistoricalInvoiceLineResolution",
    },
    {
      method: "get",
      path: "/api/imported-invoices/invoice-1/lines/line-1/resolution-candidates",
      service: "searchHistoricalInvoiceResolutionCandidates",
    },
    {
      method: "post",
      path: "/api/imported-invoices/invoice-1/lines/line-1/resolve",
      service: "confirmHistoricalInvoiceLineResolution",
    },
  ])("returns 401 for unauthenticated $path without calling its service", async ({ method, path, service }) => {
    authState.authenticated = false;
    const request = method === "post"
      ? supertest(buildApp()).post(path).send({ vendorItemId: "vendor-item-1", confirm: true })
      : supertest(buildApp()).get(path);
    const response = await request;
    expect(response.status).toBe(401);
    expect((serviceMocks as any)[service]).not.toHaveBeenCalled();
  });

  it.each([
    {
      method: "get",
      path: "/api/imported-invoices/invoice-1/lines/private-line/resolution-preview",
      service: "previewHistoricalInvoiceLineResolution",
    },
    {
      method: "get",
      path: "/api/imported-invoices/invoice-1/lines/private-line/resolution-candidates",
      service: "searchHistoricalInvoiceResolutionCandidates",
    },
    {
      method: "post",
      path: "/api/imported-invoices/invoice-1/lines/private-line/resolve",
      service: "confirmHistoricalInvoiceLineResolution",
    },
  ])("uses a privacy-safe 404 for inaccessible $path", async ({ method, path, service }) => {
    const { HistoricalInvoiceResolutionError } = await import("../services/orderly/historicalInvoiceResolution");
    (serviceMocks as any)[service].mockRejectedValue(
      new HistoricalInvoiceResolutionError("NOT_FOUND" as any, "Invoice line not found."),
    );
    const request = method === "post"
      ? supertest(buildApp()).post(path).send({ vendorItemId: "vendor-item-1", confirm: true })
      : supertest(buildApp()).get(path);
    const response = await request;
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Invoice line not found." });
  });
});