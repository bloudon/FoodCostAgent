/**
 * Endpoint-level tests for the onboarding invoice scan HTTP handlers.
 *
 * Uses supertest against real Express handler instances created via the
 * dependency-injection factories in invoiceScanHandler.ts.  Dependencies
 * (scanner, DB operations) are replaced by deterministic in-memory fakes so
 * tests run without a database or OpenAI key.
 *
 * Deliverable 1: POST /api/onboarding/invoice-scan — unitPrice is always a number
 * Deliverable 2: POST /api/onboarding/invoice-scan/apply — null unitPrice + casePrice
 *                → effectiveUnitPrice = casePrice
 */

import express, { type Express } from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createScanHandler,
  createApplyHandler,
  type ScanHandlerDeps,
  type ApplyHandlerDeps,
} from "./invoiceScanHandler";
import type { VendorReceiptScanResult } from "../services/vendorReceiptScanner";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const COMPANY_ID = "company-test-001";
const USER_ID = "user-test-001";

/** Minimal Express app that injects companyId/userId on every request. */
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  // Simulate requireAuth by stamping the request
  app.use((req, _res, next) => {
    (req as any).companyId = COMPANY_ID;
    (req as any).user = { id: USER_ID };
    next();
  });
  return app;
}

const JPEG_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

/** Default scan handler deps — no inventory items (no matching). */
function defaultScanDeps(
  scanResult: VendorReceiptScanResult,
  overrides?: Partial<ScanHandlerDeps>,
): ScanHandlerDeps {
  return {
    readBuffer: async () => ({ buffer: JPEG_BUFFER, mimeType: "image/jpeg" }),
    scanReceipt: async () => scanResult,
    getInventoryItems: async () => [],
    ...overrides,
  };
}

/** Default apply handler deps — records calls to createItem/updateItemPrice. */
function recordingApplyDeps(overrides?: Partial<ApplyHandlerDeps>): {
  deps: ApplyHandlerDeps;
  created: Array<{ name: string; unitId: string; categoryId: string | null; price: number }>;
  updated: Array<{ itemId: string; price: number; casePrice: number | null | undefined }>;
} {
  const created: Array<{ name: string; unitId: string; categoryId: string | null; price: number }> = [];
  const updated: Array<{ itemId: string; price: number; casePrice: number | null | undefined }> = [];

  const deps: ApplyHandlerDeps = {
    resolveUnitId: (_u) => "unit-lb",
    resolveCategoryId: (_h) => null,
    createItem: async (_companyId, name, unitId, categoryId, effectiveUnitPrice) => {
      created.push({ name, unitId, categoryId, price: effectiveUnitPrice });
      return `new-item-${created.length}`;
    },
    updateItemPrice: async (itemId, _companyId, effectiveUnitPrice, casePrice) => {
      updated.push({ itemId, price: effectiveUnitPrice, casePrice });
      return true;
    },
    recalcRecipes: async () => {},
    ...overrides,
  };
  return { deps, created, updated };
}

// ---------------------------------------------------------------------------
// POST /api/onboarding/invoice-scan
// Deliverable 1: unitPrice in response is ALWAYS a number
// ---------------------------------------------------------------------------

describe("POST /api/onboarding/invoice-scan — endpoint contract", () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
  });

  it("returns 400 when imageObjectPath is missing", async () => {
    app.post("/api/onboarding/invoice-scan", createScanHandler(defaultScanDeps({
      items: [], vendorName: null, rawResponse: "",
    })));
    const res = await request(app).post("/api/onboarding/invoice-scan").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 422 when scanner returns no items", async () => {
    app.post("/api/onboarding/invoice-scan", createScanHandler(defaultScanDeps({
      items: [], vendorName: null, rawResponse: "",
    })));
    const res = await request(app)
      .post("/api/onboarding/invoice-scan")
      .send({ imageObjectPath: "test/invoice.jpg" });
    expect(res.status).toBe(422);
  });

  it("returns 415 when image MIME type is unsupported", async () => {
    app.post("/api/onboarding/invoice-scan", createScanHandler(defaultScanDeps(
      { items: [{ name: "Bacon", unitPrice: 5, casePrice: 50, sku: "", priceType: "unit", packSizeDescription: "", unit: "lb", categoryHint: "" }], vendorName: null, rawResponse: "" },
      { readBuffer: async () => ({ buffer: Buffer.from([]), mimeType: "application/pdf" }) },
    )));
    const res = await request(app)
      .post("/api/onboarding/invoice-scan")
      .send({ imageObjectPath: "test/invoice.pdf" });
    expect(res.status).toBe(415);
  });

  it("DELIVERABLE 1: unitPrice is always a number when scanner returns null unitPrice + valid casePrice", async () => {
    app.post("/api/onboarding/invoice-scan", createScanHandler(defaultScanDeps({
      vendorName: "Test Vendor",
      rawResponse: "",
      items: [
        {
          name: "Sliced Bacon 15/18",
          unitPrice: null,     // ← AI did not return a unit price
          casePrice: 34.99,   // ← only case price available
          sku: "",
          priceType: "case",
          packSizeDescription: "10 lb case",
          unit: "cs",
          categoryHint: "Proteins",
        },
      ],
    })));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan")
      .send({ imageObjectPath: "test/invoice.jpg" });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);

    const item = res.body.items[0];
    // unitPrice must be a number — never null or undefined
    expect(typeof item.unitPrice).toBe("number");
    // When unitPrice is null, must fall back to casePrice
    expect(item.unitPrice).toBe(34.99);
    // priceSource must indicate the fallback
    expect(item.priceSource).toBe("case");
  });

  it("DELIVERABLE 1: unitPrice is always a number when both prices are null (returns 0)", async () => {
    app.post("/api/onboarding/invoice-scan", createScanHandler(defaultScanDeps({
      vendorName: null,
      rawResponse: "",
      items: [
        {
          name: "Unknown Item",
          unitPrice: null,
          casePrice: null,
          sku: "",
          priceType: null,
          packSizeDescription: "",
          unit: null,
          categoryHint: null,
        },
      ],
    })));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan")
      .send({ imageObjectPath: "test/invoice.jpg" });

    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(typeof item.unitPrice).toBe("number");
    expect(item.unitPrice).toBe(0);
    expect(item.priceSource).toBe("zero");
  });

  it("DELIVERABLE 1: unitPrice is always a number when AI returns a unit price", async () => {
    app.post("/api/onboarding/invoice-scan", createScanHandler(defaultScanDeps({
      vendorName: null,
      rawResponse: "",
      items: [
        {
          name: "Mozzarella 5 lb",
          unitPrice: 4.5,
          casePrice: 22.5,
          sku: "",
          priceType: "unit",
          packSizeDescription: "",
          unit: "lb",
          categoryHint: "Dairy",
        },
      ],
    })));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan")
      .send({ imageObjectPath: "test/invoice.jpg" });

    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(typeof item.unitPrice).toBe("number");
    expect(item.unitPrice).toBe(4.5);
    expect(item.priceSource).toBe("unit");
  });

  it("all items in a multi-item response have numeric unitPrice regardless of source", async () => {
    app.post("/api/onboarding/invoice-scan", createScanHandler(defaultScanDeps({
      vendorName: "Mixed Vendor",
      rawResponse: "",
      items: [
        { name: "Bacon", unitPrice: null, casePrice: 34.99, sku: "", priceType: "case", packSizeDescription: "", unit: "cs", categoryHint: "Proteins" },
        { name: "Cheese", unitPrice: 4.5, casePrice: 22.5, sku: "", priceType: "unit", packSizeDescription: "", unit: "lb", categoryHint: "Dairy" },
        { name: "Unknown", unitPrice: null, casePrice: null, sku: "", priceType: null, packSizeDescription: "", unit: null, categoryHint: null },
      ],
    })));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan")
      .send({ imageObjectPath: "test/invoice.jpg" });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    for (const item of res.body.items) {
      expect(typeof item.unitPrice, `Expected number for ${item.name}`).toBe("number");
    }
    expect(res.body.items[0].unitPrice).toBe(34.99); // case fallback
    expect(res.body.items[1].unitPrice).toBe(4.5);   // unit price preserved
    expect(res.body.items[2].unitPrice).toBe(0);     // both null → 0
  });

  it("includes vendorName from the scanner in the response", async () => {
    app.post("/api/onboarding/invoice-scan", createScanHandler(defaultScanDeps({
      vendorName: "Restaurant Depot",
      rawResponse: "",
      items: [
        { name: "Eggs", unitPrice: 2.5, casePrice: 30, sku: "", priceType: "unit", packSizeDescription: "", unit: "dz", categoryHint: "Dairy" },
      ],
    })));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan")
      .send({ imageObjectPath: "test/invoice.jpg" });

    expect(res.status).toBe(200);
    expect(res.body.vendorName).toBe("Restaurant Depot");
  });
});

// ---------------------------------------------------------------------------
// POST /api/onboarding/invoice-scan/apply
// Deliverable 2: null unitPrice + valid casePrice → effectiveUnitPrice = casePrice
// ---------------------------------------------------------------------------

describe("POST /api/onboarding/invoice-scan/apply — endpoint contract", () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
  });

  it("returns 400 when items array is missing", async () => {
    const { deps } = recordingApplyDeps();
    app.post("/api/onboarding/invoice-scan/apply", createApplyHandler(deps));
    const res = await request(app)
      .post("/api/onboarding/invoice-scan/apply")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when items array is empty", async () => {
    const { deps } = recordingApplyDeps();
    app.post("/api/onboarding/invoice-scan/apply", createApplyHandler(deps));
    const res = await request(app)
      .post("/api/onboarding/invoice-scan/apply")
      .send({ items: [] });
    expect(res.status).toBe(400);
  });

  it("DELIVERABLE 2 (create): null unitPrice + valid casePrice → effectiveUnitPrice = casePrice", async () => {
    const { deps, created } = recordingApplyDeps();
    app.post("/api/onboarding/invoice-scan/apply", createApplyHandler(deps));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan/apply")
      .send({
        items: [
          {
            name: "Sliced Bacon 15/18",
            unitPrice: null,   // ← null — must fall back to casePrice
            casePrice: 29.99,  // ← should be used as effectiveUnitPrice
            action: "create",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBe(1);

    // The item must have been created with price = casePrice (not 0)
    expect(created).toHaveLength(1);
    expect(created[0].price).toBe(29.99);
    expect(typeof created[0].price).toBe("number");
  });

  it("DELIVERABLE 2 (update): null unitPrice + valid casePrice → effectiveUnitPrice = casePrice", async () => {
    const { deps, updated } = recordingApplyDeps();
    app.post("/api/onboarding/invoice-scan/apply", createApplyHandler(deps));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan/apply")
      .send({
        items: [
          {
            name: "Mozzarella Cheese",
            unitPrice: null,   // ← null — must fall back to casePrice
            casePrice: 44.5,
            action: "update",
            inventoryItemId: "inv-item-abc123",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(1);
    expect(updated).toHaveLength(1);
    expect(updated[0].price).toBe(44.5); // effectiveUnitPrice = casePrice
    expect(typeof updated[0].price).toBe("number");
  });

  it("DELIVERABLE 2: undefined unitPrice + valid casePrice → effectiveUnitPrice = casePrice", async () => {
    const { deps, created } = recordingApplyDeps();
    app.post("/api/onboarding/invoice-scan/apply", createApplyHandler(deps));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan/apply")
      .send({
        items: [
          {
            name: "Chicken Breast 40 lb",
            // unitPrice omitted (undefined)
            casePrice: 89.99,
            action: "create",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(created[0].price).toBe(89.99);
  });

  it("uses unitPrice when both unitPrice and casePrice are present", async () => {
    const { deps, created } = recordingApplyDeps();
    app.post("/api/onboarding/invoice-scan/apply", createApplyHandler(deps));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan/apply")
      .send({
        items: [
          {
            name: "Mozzarella 5 lb",
            unitPrice: 4.5,
            casePrice: 22.5,
            action: "create",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(created[0].price).toBe(4.5); // unitPrice wins
  });

  it("writes effectiveUnitPrice = 0 when both prices are absent", async () => {
    const { deps, created } = recordingApplyDeps();
    app.post("/api/onboarding/invoice-scan/apply", createApplyHandler(deps));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan/apply")
      .send({
        items: [
          {
            name: "No Price Item",
            unitPrice: null,
            casePrice: null,
            action: "create",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(created[0].price).toBe(0);
    expect(typeof created[0].price).toBe("number");
  });

  it("skip action is a no-op — no DB calls made", async () => {
    const createItemFn = vi.fn().mockResolvedValue("new-id");
    const updateItemFn = vi.fn().mockResolvedValue(true);
    const { deps } = recordingApplyDeps({
      createItem: createItemFn,
      updateItemPrice: updateItemFn,
    });
    app.post("/api/onboarding/invoice-scan/apply", createApplyHandler(deps));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan/apply")
      .send({
        items: [{ name: "Ignored Item", unitPrice: 5, casePrice: 50, action: "skip" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBe(0);
    expect(res.body.updatedCount).toBe(0);
    expect(createItemFn).not.toHaveBeenCalled();
    expect(updateItemFn).not.toHaveBeenCalled();
  });

  it("handles mixed actions in a single request", async () => {
    const { deps, created, updated } = recordingApplyDeps();
    app.post("/api/onboarding/invoice-scan/apply", createApplyHandler(deps));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan/apply")
      .send({
        items: [
          { name: "New Bacon", unitPrice: null, casePrice: 34.99, action: "create" },
          { name: "Existing Cheese", unitPrice: null, casePrice: 22.5, action: "update", inventoryItemId: "inv-cheese" },
          { name: "Skip Me", unitPrice: 1, casePrice: 10, action: "skip" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBe(1);
    expect(res.body.updatedCount).toBe(1);
    expect(created[0].price).toBe(34.99); // null unitPrice → casePrice
    expect(updated[0].price).toBe(22.5);   // null unitPrice → casePrice
  });

  it("effectiveUnitPrice is always a number across all action types", async () => {
    const prices: number[] = [];
    const { deps } = recordingApplyDeps({
      createItem: async (_cid, name, uid, catid, price) => {
        prices.push(price);
        return `item-${prices.length}`;
      },
    });
    app.post("/api/onboarding/invoice-scan/apply", createApplyHandler(deps));

    const res = await request(app)
      .post("/api/onboarding/invoice-scan/apply")
      .send({
        items: [
          { name: "A", unitPrice: null, casePrice: 10, action: "create" },
          { name: "B", unitPrice: null, casePrice: null, action: "create" },
          { name: "C", unitPrice: 5, casePrice: 50, action: "create" },
        ],
      });

    expect(res.status).toBe(200);
    expect(prices).toHaveLength(3);
    for (const p of prices) {
      expect(typeof p).toBe("number");
    }
    expect(prices[0]).toBe(10);  // null unitPrice → casePrice
    expect(prices[1]).toBe(0);   // both null → 0
    expect(prices[2]).toBe(5);   // unitPrice wins
  });
});
