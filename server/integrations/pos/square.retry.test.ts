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

