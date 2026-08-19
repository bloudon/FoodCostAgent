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
});