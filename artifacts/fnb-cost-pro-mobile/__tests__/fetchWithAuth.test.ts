/**
 * Unit tests for fetchWithAuth.
 *
 * Verifies that a 401+reauthenticate:true response from any protected
 * endpoint correctly calls handleUnauthorized(true) — which navigates to
 * /login?reason=session_expired — while plain 401s, non-JSON bodies, and
 * successful responses do NOT trigger the session-expired redirect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithAuth } from "../lib/fetchWithAuth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(status: number, body?: unknown, contentType = "application/json"): Response {
  const bodyStr = body !== undefined ? JSON.stringify(body) : "";
  return new Response(bodyStr, {
    status,
    headers: { "Content-Type": contentType },
  });
}

// ---------------------------------------------------------------------------
// Setup: replace global fetch with vi.fn()
// ---------------------------------------------------------------------------

const globalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = globalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Success paths — handleUnauthorized must NOT be called
// ---------------------------------------------------------------------------

describe("fetchWithAuth — success paths", () => {
  it("does NOT call handleUnauthorized on 200", async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeResponse(200, { ok: true }));
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    const res = await fetchWithAuth("https://api.example.com/data", {}, handleUnauthorized);

    expect(handleUnauthorized).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("does NOT call handleUnauthorized on 403", async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeResponse(403, { error: "Forbidden" }));
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    await fetchWithAuth("https://api.example.com/data", {}, handleUnauthorized);

    expect(handleUnauthorized).not.toHaveBeenCalled();
  });

  it("does NOT call handleUnauthorized on 404", async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeResponse(404, { error: "Not Found" }));
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    await fetchWithAuth("https://api.example.com/data", {}, handleUnauthorized);

    expect(handleUnauthorized).not.toHaveBeenCalled();
  });

  it("returns the raw Response so callers can inspect res.ok", async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeResponse(201, { created: true }));
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    const res = await fetchWithAuth("https://api.example.com/data", {}, handleUnauthorized);

    expect(res.status).toBe(201);
    expect(res.ok).toBe(true);
  });

  it("passes the url and options through to fetch unchanged", async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeResponse(200, {}));
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
      body: JSON.stringify({ x: 1 }),
    };
    await fetchWithAuth("https://api.example.com/resource", options, handleUnauthorized);

    expect(global.fetch).toHaveBeenCalledWith("https://api.example.com/resource", options);
  });
});

// ---------------------------------------------------------------------------
// 401 paths — the session-expired redirect core logic
// ---------------------------------------------------------------------------

describe("fetchWithAuth — 401 paths", () => {
  it("calls handleUnauthorized(true) when reauthenticate:true in body", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      makeResponse(401, { reauthenticate: true, message: "Google token revoked" })
    );
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    await fetchWithAuth("https://api.example.com/protected", {}, handleUnauthorized);

    expect(handleUnauthorized).toHaveBeenCalledOnce();
    expect(handleUnauthorized).toHaveBeenCalledWith(true);
  });

  it("calls handleUnauthorized(false) when reauthenticate is absent in body", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      makeResponse(401, { message: "Unauthorized" })
    );
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    await fetchWithAuth("https://api.example.com/protected", {}, handleUnauthorized);

    expect(handleUnauthorized).toHaveBeenCalledOnce();
    expect(handleUnauthorized).toHaveBeenCalledWith(false);
  });

  it("calls handleUnauthorized(false) when reauthenticate is false in body", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      makeResponse(401, { reauthenticate: false })
    );
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    await fetchWithAuth("https://api.example.com/protected", {}, handleUnauthorized);

    expect(handleUnauthorized).toHaveBeenCalledOnce();
    expect(handleUnauthorized).toHaveBeenCalledWith(false);
  });

  it("calls handleUnauthorized(false) when 401 body is not JSON", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response("Unauthorized", { status: 401, headers: { "Content-Type": "text/plain" } })
    );
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    await fetchWithAuth("https://api.example.com/protected", {}, handleUnauthorized);

    expect(handleUnauthorized).toHaveBeenCalledOnce();
    expect(handleUnauthorized).toHaveBeenCalledWith(false);
  });

  it("calls handleUnauthorized(false) when 401 body is empty", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response("", { status: 401 }));
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    await fetchWithAuth("https://api.example.com/protected", {}, handleUnauthorized);

    expect(handleUnauthorized).toHaveBeenCalledOnce();
    expect(handleUnauthorized).toHaveBeenCalledWith(false);
  });

  it("still returns the 401 Response after calling handleUnauthorized", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      makeResponse(401, { reauthenticate: true })
    );
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    const res = await fetchWithAuth("https://api.example.com/protected", {}, handleUnauthorized);

    expect(res.status).toBe(401);
  });

  it("calls handleUnauthorized exactly once per 401 response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      makeResponse(401, { reauthenticate: true })
    );
    const handleUnauthorized = vi.fn(async (_r: boolean) => {});

    await fetchWithAuth("https://api.example.com/protected", {}, handleUnauthorized);

    expect(handleUnauthorized).toHaveBeenCalledTimes(1);
  });
});
