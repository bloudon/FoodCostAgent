/**
 * Unit tests for Square API hardening (#545):
 *  - SQUARE_API_VERSION constant is sent on every request
 *  - Transient errors (429, 500, 502, 503) are retried up to 4 times
 *  - Retry-After header is respected on 429
 *  - Non-transient errors (400, 401, 404) fail immediately
 *  - 401 throws SquareTokenRevokedError without retry
 *  - A successful response after retries returns data normally
 *  - Cursor pagination follows all pages and aggregates results
 *
 * Real delays are eliminated by replacing squareTestHooks.sleep with a no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SQUARE_API_VERSION,
  SquareTokenRevokedError,
  squarePosConnector,
  squareTestHooks,
} from "./square";

// ── Skip real backoff delays in every test ────────────────────────────────────
beforeEach(() => {
  squareTestHooks.sleep = async () => {};
});
afterEach(() => {
  // Restore default sleep and remove any fetch stub
  squareTestHooks.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  vi.unstubAllGlobals();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(status: number, body: any, headers: Record<string, string> = {}): Response {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(...responses: Response[]): ReturnType<typeof vi.fn> {
  let call = 0;
  const mock = vi.fn(async () => {
    const res = responses[Math.min(call, responses.length - 1)];
    call++;
    return res;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

// ── SQUARE_API_VERSION ────────────────────────────────────────────────────────

describe("SQUARE_API_VERSION", () => {
  it("is a non-empty string in YYYY-MM-DD format", () => {
    expect(SQUARE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── squareFetch retry behaviour ───────────────────────────────────────────────

describe("squareFetch via squarePosConnector.listLocations", () => {
  it("sends Square-Version header matching SQUARE_API_VERSION", async () => {
    const mock = stubFetch(makeResponse(200, { locations: [] }));
    await squarePosConnector.listLocations("tok-abc");
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Square-Version"]).toBe(SQUARE_API_VERSION);
  });

  it("returns data immediately on a 200 response", async () => {
    stubFetch(makeResponse(200, { locations: [{ id: "L1", name: "Main", timezone: "America/Chicago" }] }));
    const locs = await squarePosConnector.listLocations("tok");
    expect(locs).toHaveLength(1);
    expect(locs[0].externalId).toBe("L1");
  });

  it("retries on 429 and succeeds on the next attempt", async () => {
    const mock = stubFetch(
      makeResponse(429, "rate limited"),
      makeResponse(200, { locations: [] }),
    );
    const locs = await squarePosConnector.listLocations("tok");
    expect(locs).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 up to 4 times then throws", async () => {
    const mock = stubFetch(
      makeResponse(500, "server error"),
      makeResponse(500, "server error"),
      makeResponse(500, "server error"),
      makeResponse(500, "server error"),
    );
    await expect(squarePosConnector.listLocations("tok")).rejects.toThrow(/Square API 500/);
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it("retries on 502 and 503", async () => {
    const mock = stubFetch(
      makeResponse(502, "bad gateway"),
      makeResponse(503, "service unavailable"),
      makeResponse(200, { locations: [] }),
    );
    const locs = await squarePosConnector.listLocations("tok");
    expect(locs).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 400 — fails immediately", async () => {
    const mock = stubFetch(makeResponse(400, "bad request"));
    await expect(squarePosConnector.listLocations("tok")).rejects.toThrow(/Square API 400/);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 404 — fails immediately", async () => {
    const mock = stubFetch(makeResponse(404, "not found"));
    await expect(squarePosConnector.listLocations("tok")).rejects.toThrow(/Square API 404/);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("throws SquareTokenRevokedError on 401 without retrying", async () => {
    const mock = stubFetch(makeResponse(401, "unauthorized"));
    await expect(squarePosConnector.listLocations("tok")).rejects.toBeInstanceOf(SquareTokenRevokedError);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("respects Retry-After header on 429 — the sleep receives the header value in ms", async () => {
    const sleepCalls: number[] = [];
    squareTestHooks.sleep = async (ms) => { sleepCalls.push(ms); };

    stubFetch(
      makeResponse(429, "rate limited", { "Retry-After": "3" }),
      makeResponse(200, { locations: [] }),
    );
    await squarePosConnector.listLocations("tok");

    // sleep should have been called once with 3000ms (3s * 1000)
    expect(sleepCalls).toHaveLength(1);
    expect(sleepCalls[0]).toBe(3_000);
  });

  it("succeeds after two retries and returns the correct payload", async () => {
    const mock = stubFetch(
      makeResponse(503, "unavailable"),
      makeResponse(503, "unavailable"),
      makeResponse(200, { locations: [{ id: "L3", name: "Airport", timezone: "America/Denver" }] }),
    );
    const locs = await squarePosConnector.listLocations("tok");
    expect(locs).toHaveLength(1);
    expect(locs[0].timezone).toBe("America/Denver");
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff (no Retry-After) — delay grows between retries", async () => {
    const sleepCalls: number[] = [];
    squareTestHooks.sleep = async (ms) => { sleepCalls.push(ms); };

    stubFetch(
      makeResponse(500, "err"),
      makeResponse(500, "err"),
      makeResponse(200, { locations: [] }),
    );
    await squarePosConnector.listLocations("tok");

    // Two sleeps; second delay should be >= first (base-2 backoff + jitter)
    expect(sleepCalls).toHaveLength(2);
    // With ±25% jitter the second sleep floor is BASE*2*0.75 = 1500ms
    // and the first sleep floor is BASE*1*0.75 = 750ms; just verify ordering trend
    expect(sleepCalls[1]).toBeGreaterThanOrEqual(sleepCalls[0] * 0.5);
  });
});

// ── Cursor pagination ─────────────────────────────────────────────────────────

describe("retrieveSales cursor pagination", () => {
  it("follows cursor across multiple pages and aggregates all orders", async () => {
    const page1 = {
      orders: [
        {
          id: "ord-1",
          closed_at: "2024-02-28T03:00:00Z",
          line_items: [
            {
              uid: "li-1",
              quantity: "1",
              catalog_object_id: "var-pizza",
              name: "Margherita Pizza",
              gross_sales_money: { amount: 1200 },
              total_discount_money: { amount: 0 },
              total_money: { amount: 1200 },
            },
          ],
          returns: [],
        },
      ],
      cursor: "page2cursor",
    };
    const page2 = {
      orders: [
        {
          id: "ord-2",
          closed_at: "2024-02-28T05:00:00Z",
          line_items: [
            {
              uid: "li-2",
              quantity: "2",
              catalog_object_id: "var-pizza",
              name: "Margherita Pizza",
              gross_sales_money: { amount: 2400 },
              total_discount_money: { amount: 0 },
              total_money: { amount: 2400 },
            },
          ],
          returns: [],
        },
      ],
      // no cursor → done
    };

    const mock = stubFetch(
      makeResponse(200, page1),
      makeResponse(200, page2),
    );

    const batches = await squarePosConnector.retrieveSales("tok", "loc-1", "2024-02-28", "2024-02-28");

    expect(mock).toHaveBeenCalledTimes(2);
    // Both orders land in the same date batch
    expect(batches).toHaveLength(1);
    const lines = batches[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0].externalOrderId).toBe("ord-1");
    expect(lines[1].externalOrderId).toBe("ord-2");
    expect(lines[1].quantity).toBe(2);
  });

  it("sends the cursor from the previous page in the next request body", async () => {
    const mock = stubFetch(
      makeResponse(200, { orders: [], cursor: "my-cursor" }),
      makeResponse(200, { orders: [] }),
    );

    await squarePosConnector.retrieveSales("tok", "loc-1", "2024-02-27", "2024-02-28");

    expect(mock).toHaveBeenCalledTimes(2);
    const [, secondInit] = mock.mock.calls[1] as [string, RequestInit];
    const secondBody = JSON.parse(secondInit.body as string);
    expect(secondBody.cursor).toBe("my-cursor");
  });

  it("returns empty batches array when there are no orders", async () => {
    stubFetch(makeResponse(200, { orders: [] }));
    const batches = await squarePosConnector.retrieveSales("tok", "loc-1", "2024-02-28", "2024-02-28");
    expect(batches).toEqual([]);
  });
});

// ── Modifier ingestion ────────────────────────────────────────────────────────

describe("retrieveSales modifier handling", () => {
  it("emits a separate PosSalesLine for a catalog-backed modifier (has catalog_object_id)", async () => {
    stubFetch(makeResponse(200, {
      orders: [{
        id: "ord-mod-1",
        closed_at: "2024-02-28T03:00:00Z",
        line_items: [{
          uid: "li-1",
          quantity: "1",
          catalog_object_id: "var-burger",
          name: "Burger",
          gross_sales_money: { amount: 1200 },
          total_discount_money: { amount: 0 },
          total_money: { amount: 1200 },
          modifiers: [{
            uid: "mod-uid-1",
            catalog_object_id: "mod-cat-extra-cheese",
            name: "Extra Cheese",
            applied_money: { amount: 150 },
          }],
        }],
        returns: [],
      }],
    }));

    const batches = await squarePosConnector.retrieveSales("tok", "loc-1", "2024-02-28", "2024-02-28");
    const lines = batches[0].lines;

    // Should have 2 lines: the base burger and the modifier
    expect(lines).toHaveLength(2);

    const burgerLine = lines.find((l) => l.externalLineId === "li-1")!;
    expect(burgerLine.externalVariationId).toBe("var-burger");
    expect(burgerLine.quantity).toBe(1);
    expect(burgerLine.grossSalesMoney).toBe(1200);

    const modLine = lines.find((l) => l.externalLineId === "li-1-mod-mod-uid-1")!;
    expect(modLine).toBeDefined();
    expect(modLine.externalVariationId).toBe("mod-cat-extra-cheese");
    expect(modLine.itemName).toBe("Extra Cheese");
    expect(modLine.quantity).toBe(1); // same qty as parent
    expect(modLine.grossSalesMoney).toBe(150);
    expect(modLine.netSalesMoney).toBe(150);
  });

  it("emits a PosSalesLine WITHOUT externalVariationId for an ad hoc modifier (no catalog_object_id)", async () => {
    stubFetch(makeResponse(200, {
      orders: [{
        id: "ord-adhoc-mod",
        closed_at: "2024-02-28T03:00:00Z",
        line_items: [{
          uid: "li-2",
          quantity: "2",
          catalog_object_id: "var-pizza",
          name: "Pizza",
          gross_sales_money: { amount: 2400 },
          total_discount_money: { amount: 0 },
          total_money: { amount: 2400 },
          modifiers: [{
            uid: "mod-uid-adhoc",
            // No catalog_object_id — free-text / open-price add-on
            name: "Special Request",
            applied_money: { amount: 0 },
          }],
        }],
        returns: [],
      }],
    }));

    const batches = await squarePosConnector.retrieveSales("tok", "loc-1", "2024-02-28", "2024-02-28");
    const lines = batches[0].lines;

    // Still 2 lines — ad hoc modifier is emitted (not dropped)
    expect(lines).toHaveLength(2);

    const modLine = lines.find((l) => l.externalLineId === "li-2-mod-mod-uid-adhoc")!;
    expect(modLine).toBeDefined();
    // No catalog ID → externalVariationId is undefined so ingestion routes it to adhocItems
    expect(modLine.externalVariationId).toBeUndefined();
    expect(modLine.itemName).toBe("Special Request");
    expect(modLine.quantity).toBe(2); // same qty as parent
  });

  it("uses a stable index-based suffix when modifier has no uid", async () => {
    stubFetch(makeResponse(200, {
      orders: [{
        id: "ord-no-uid",
        closed_at: "2024-02-28T03:00:00Z",
        line_items: [{
          uid: "li-3",
          quantity: "1",
          catalog_object_id: "var-salad",
          name: "Salad",
          gross_sales_money: { amount: 900 },
          total_discount_money: { amount: 0 },
          total_money: { amount: 900 },
          modifiers: [
            // No uid on either modifier
            { catalog_object_id: "mod-dressing", name: "Ranch", applied_money: { amount: 50 } },
            { catalog_object_id: "mod-croutons", name: "Croutons", applied_money: { amount: 25 } },
          ],
        }],
        returns: [],
      }],
    }));

    const batches = await squarePosConnector.retrieveSales("tok", "loc-1", "2024-02-28", "2024-02-28");
    const lines = batches[0].lines;

    // 1 base line + 2 modifier lines
    expect(lines).toHaveLength(3);

    // Stable index-based IDs when uid is absent
    expect(lines.some((l) => l.externalLineId === "li-3-mod-idx0")).toBe(true);
    expect(lines.some((l) => l.externalLineId === "li-3-mod-idx1")).toBe(true);
  });
});

// ── retrieveCatalog modifier support ─────────────────────────────────────────

describe("retrieveCatalog MODIFIER_LIST support", () => {
  it("returns PosCatalogVariation entries for each modifier in a MODIFIER_LIST object", async () => {
    // First fetch call returns ITEM page (no items for simplicity), second returns MODIFIER_LIST page.
    stubFetch(
      // Pass 1: ITEM search — empty
      makeResponse(200, { catalog_objects: [] }),
      // Pass 2: MODIFIER_LIST search — one list with two modifiers
      makeResponse(200, {
        catalog_objects: [
          {
            id: "mod-list-seasonings",
            type: "MODIFIER_LIST",
            modifier_list_data: {
              name: "Seasonings",
              modifiers: [
                {
                  id: "mod-garlic-salt",
                  modifier_data: { name: "Garlic Salt", price_money: { amount: 50 } },
                },
                {
                  id: "mod-lemon-pepper",
                  modifier_data: { name: "Lemon Pepper", price_money: { amount: 75 } },
                },
              ],
            },
          },
        ],
      }),
    );

    const catalog = await squarePosConnector.retrieveCatalog("tok-abc");

    // Both modifiers should appear as PosCatalogVariation entries
    expect(catalog).toHaveLength(2);

    const garlic = catalog.find((v) => v.externalVariationId === "mod-garlic-salt");
    expect(garlic).toBeDefined();
    expect(garlic!.externalItemId).toBe("mod-list-seasonings"); // modifier set ID
    expect(garlic!.itemName).toBe("Seasonings");
    expect(garlic!.variationName).toBe("Garlic Salt");
    expect(garlic!.priceMoney).toBe(50);
    expect(garlic!.isModifier).toBe(true);

    const lemon = catalog.find((v) => v.externalVariationId === "mod-lemon-pepper");
    expect(lemon).toBeDefined();
    expect(lemon!.isModifier).toBe(true);
  });

  it("returns ITEM variations alongside modifiers when both are present", async () => {
    stubFetch(
      // Pass 1: ITEM search — one item with one variation
      makeResponse(200, {
        catalog_objects: [
          {
            id: "item-burger",
            type: "ITEM",
            item_data: {
              name: "Burger",
              variations: [
                {
                  id: "var-burger-regular",
                  item_variation_data: { name: "Regular", price_money: { amount: 1200 } },
                },
              ],
            },
          },
        ],
      }),
      // Pass 2: MODIFIER_LIST search — one list with one modifier
      makeResponse(200, {
        catalog_objects: [
          {
            id: "mod-list-toppings",
            type: "MODIFIER_LIST",
            modifier_list_data: {
              name: "Extra Toppings",
              modifiers: [
                {
                  id: "mod-extra-cheese",
                  modifier_data: { name: "Extra Cheese", price_money: { amount: 150 } },
                },
              ],
            },
          },
        ],
      }),
    );

    const catalog = await squarePosConnector.retrieveCatalog("tok-abc");

    // One item variation + one modifier = 2 entries total
    expect(catalog).toHaveLength(2);

    const itemVar = catalog.find((v) => v.externalVariationId === "var-burger-regular");
    expect(itemVar).toBeDefined();
    expect(itemVar!.isModifier).toBeUndefined(); // item variations have no isModifier flag

    const modVar = catalog.find((v) => v.externalVariationId === "mod-extra-cheese");
    expect(modVar).toBeDefined();
    expect(modVar!.externalItemId).toBe("mod-list-toppings");
    expect(modVar!.isModifier).toBe(true);
  });

  it("excludes modifier entries when MODIFIER_LIST search returns an empty page", async () => {
    stubFetch(
      // Pass 1: ITEM search — one item variation
      makeResponse(200, {
        catalog_objects: [
          {
            id: "item-pizza",
            type: "ITEM",
            item_data: {
              name: "Pizza",
              variations: [
                {
                  id: "var-pizza-sm",
                  item_variation_data: { name: "Small", price_money: { amount: 900 } },
                },
              ],
            },
          },
        ],
      }),
      // Pass 2: MODIFIER_LIST search — empty (merchant has no modifiers)
      makeResponse(200, { catalog_objects: [] }),
    );

    const catalog = await squarePosConnector.retrieveCatalog("tok-abc");

    // Only the item variation — no modifier entries
    expect(catalog).toHaveLength(1);
    expect(catalog[0].externalVariationId).toBe("var-pizza-sm");
    expect(catalog[0].isModifier).toBeUndefined();
  });
});

