// @vitest-environment jsdom
/**
 * Unit tests for queryClient.ts — session-expired redirect behaviour.
 *
 * Verifies that when any protected endpoint returns HTTP 401 with
 * `{ reauthenticate: true }` in the JSON body, the page is redirected to
 * /login?reason=session_expired.
 *
 * Covers:
 *   1. apiRequest (throwIfResNotOk path)
 *   2. getQueryFn with on401:"throw"
 *   3. getQueryFn with on401:"returnNull" (still redirects on reauthenticate)
 *   4. Plain 401 without reauthenticate flag does NOT redirect (just throws)
 *   5. Non-JSON 401 body does NOT redirect
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// We need to control window.location.href, which is write-protected by jsdom
// unless we define it ourselves.
// ---------------------------------------------------------------------------
let hrefCapture: string | null = null;

function mockWindowLocation() {
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      ...original,
      href: "",
    },
  });
  Object.defineProperty(window.location, "href", {
    configurable: true,
    set(value: string) {
      hrefCapture = value;
    },
    get() {
      return hrefCapture ?? "";
    },
  });
}

function restoreWindowLocation() {
  hrefCapture = null;
}

// ---------------------------------------------------------------------------
// Mock the only external dep that queryClient imports
// ---------------------------------------------------------------------------
vi.mock("@/hooks/use-embedded", () => ({
  getMobileToken: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers to build mock fetch responses
// ---------------------------------------------------------------------------
function makeResponse(status: number, body: unknown, ok?: boolean): Response {
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: ok ?? status < 400,
    status,
    statusText: status === 401 ? "Unauthorized" : "Error",
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve(body),
    headers: new Headers({ "content-type": "application/json" }),
    // Minimal stubs for the remaining Response interface
    body: null,
    bodyUsed: false,
    url: "/api/test",
    redirected: false,
    type: "basic" as ResponseType,
    clone: function () { return this; },
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests: apiRequest via throwIfResNotOk
// ---------------------------------------------------------------------------

describe("apiRequest — reauthenticate redirect", () => {
  beforeEach(() => {
    mockWindowLocation();
  });

  afterEach(() => {
    restoreWindowLocation();
    vi.restoreAllMocks();
  });

  it("redirects to /login?reason=session_expired on 401 + reauthenticate:true", async () => {
    const { apiRequest } = await import("./queryClient");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeResponse(401, { error: "Token revoked", reauthenticate: true }),
    );

    // Should not throw — the redirect replaces the page, so we just return
    await apiRequest("GET", "/api/some-protected-endpoint");

    expect(hrefCapture).toBe("/login?reason=session_expired");
    fetchSpy.mockRestore();
  });

  it("does NOT redirect on plain 401 (no reauthenticate flag)", async () => {
    const { apiRequest } = await import("./queryClient");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeResponse(401, { error: "Unauthorized" }),
    );

    await expect(apiRequest("GET", "/api/protected")).rejects.toThrow("Unauthorized");
    expect(hrefCapture).toBeNull();
    fetchSpy.mockRestore();
  });

  it("does NOT redirect when reauthenticate is false", async () => {
    const { apiRequest } = await import("./queryClient");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeResponse(401, { error: "Bad token", reauthenticate: false }),
    );

    await expect(apiRequest("GET", "/api/protected")).rejects.toThrow("Bad token");
    expect(hrefCapture).toBeNull();
    fetchSpy.mockRestore();
  });

  it("does NOT redirect on non-JSON 401 body", async () => {
    const { apiRequest } = await import("./queryClient");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeResponse(401, "Unauthorized — plain text", false),
    );

    await expect(apiRequest("GET", "/api/protected")).rejects.toThrow();
    expect(hrefCapture).toBeNull();
    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Tests: getQueryFn with on401:"throw"
// ---------------------------------------------------------------------------

describe("getQueryFn(on401:throw) — reauthenticate redirect", () => {
  beforeEach(() => {
    mockWindowLocation();
  });

  afterEach(() => {
    restoreWindowLocation();
    vi.restoreAllMocks();
  });

  it("redirects to /login?reason=session_expired on 401 + reauthenticate:true", async () => {
    const { getQueryFn } = await import("./queryClient");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeResponse(401, { error: "Token revoked", reauthenticate: true }),
    );

    const queryFn = getQueryFn<unknown>({ on401: "throw" });
    // throwIfResNotOk is called — it sets window.location.href and returns,
    // so the outer function resolves (rather than throws) after the redirect.
    try {
      await queryFn({
        queryKey: ["/api/inventory"],
        signal: new AbortController().signal,
        meta: undefined,
      });
    } catch {
      // may or may not throw depending on exact control flow; either way the
      // redirect must have been set.
    }

    expect(hrefCapture).toBe("/login?reason=session_expired");
    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Tests: getQueryFn with on401:"returnNull"
// ---------------------------------------------------------------------------

describe("getQueryFn(on401:returnNull) — reauthenticate redirect", () => {
  beforeEach(() => {
    mockWindowLocation();
  });

  afterEach(() => {
    restoreWindowLocation();
    vi.restoreAllMocks();
  });

  it("redirects to /login?reason=session_expired on 401 + reauthenticate:true (even in returnNull mode)", async () => {
    const { getQueryFn } = await import("./queryClient");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeResponse(401, { reauthenticate: true }),
    );

    const queryFn = getQueryFn<unknown>({ on401: "returnNull" });
    const result = await queryFn({
      queryKey: ["/api/auth", "me"],
      signal: new AbortController().signal,
      meta: undefined,
    });

    // returnNull mode returns null (not throw) after redirect
    expect(result).toBeNull();
    expect(hrefCapture).toBe("/login?reason=session_expired");
    fetchSpy.mockRestore();
  });

  it("returns null but does NOT redirect on plain 401 in returnNull mode", async () => {
    const { getQueryFn } = await import("./queryClient");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeResponse(401, { error: "Not logged in" }),
    );

    const queryFn = getQueryFn<unknown>({ on401: "returnNull" });
    const result = await queryFn({
      queryKey: ["/api/auth", "me"],
      signal: new AbortController().signal,
      meta: undefined,
    });

    expect(result).toBeNull();
    expect(hrefCapture).toBeNull();
    fetchSpy.mockRestore();
  });
});
