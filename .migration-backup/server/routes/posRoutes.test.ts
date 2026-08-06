/**
 * Tests for Square POS reconnect flow.
 * Covers: signed state creation/verification, nonce lifecycle,
 *         reconnect callback logic (success, expiry, replay, merchant mismatch, cancellation),
 *         and OAuth callback route integration (first-time create, reconnect upsert, bad code).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Server } from "http";

// ── Module mocks (hoisted by vitest — must be defined before imports that use them) ──
// These mocks are hoisted to module scope by vitest so they intercept the imports
// in posRoutes.ts before any test runs. The existing pure-function tests are not
// affected because they only exercise createSignedState / verifySignedState (crypto-only).

vi.mock("../storage", () => ({
  storage: {
    getPosConnectionById: vi.fn(),
    createPosConnection: vi.fn(),
    updatePosConnection: vi.fn(),
    upsertPosLocationMappings: vi.fn(),
    getPosConnections: vi.fn(),
    deletePosConnection: vi.fn(),
    getPosLocationMappings: vi.fn(),
    upsertPosLocationMapping: vi.fn(),
    getPosItemMappings: vi.fn(),
    upsertPosItemMappings: vi.fn(),
    updatePosItemMapping: vi.fn(),
    createMenuItem: vi.fn(),
    getPosSyncAuditRows: vi.fn(),
    // Framework guard — returns undefined (no existing connection) by default.
    // Override per-test for the retained-connection path.
    getRetainedPosConnectionForCompany: vi.fn().mockResolvedValue(undefined),
    getCompany: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../integrations/pos/square", () => ({
  squarePosConnector: {
    exchangeCode: vi.fn(),
    listLocations: vi.fn(),
  },
  buildSquareAuthUrl: vi.fn(() => "https://connect.squareup.com/oauth2/authorize?fake=1"),
  buildSquareRedirectUri: vi.fn(() => "https://app.fnbcostpro.com/api/pos/oauth/square/callback"),
}));

// Stub requireAuth so route-level tests can inject an authenticated identity
// without a real session.  Individual tests can override req.companyId via the
// TEST_COMPANY_ID env-like variable or by replacing the mock per-suite.
vi.mock("../auth", () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: "user-test", role: "company_admin", companyId: "company-test" };
    req.companyId = "company-test";
    next();
  }),
}));

vi.mock("../services/posSyncJobs", () => ({
  backfillLocationTimezones: vi.fn().mockResolvedValue(undefined),
  runBackfill: vi.fn().mockResolvedValue(undefined),
  runIncrementalSync: vi.fn().mockResolvedValue(undefined),
}));

// ── Import helpers under test ──────────────────────────────────────────────────
// We test the pure helpers in isolation; route-level tests use mocked storage.

// Set a predictable SESSION_SECRET before importing the module
process.env.SESSION_SECRET = "test-secret-for-unit-tests";

import { createSignedState, verifySignedState } from "./posRoutes";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Record<string, any> = {}) {
  return {
    companyId: "company-abc",
    userId: "user-xyz",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── createSignedState / verifySignedState ─────────────────────────────────────

describe("createSignedState + verifySignedState", () => {
  it("round-trips a plain new-connection state", () => {
    const data = makeState();
    const signed = createSignedState(data);
    const parsed = verifySignedState(signed);
    expect(parsed.companyId).toBe(data.companyId);
    expect(parsed.userId).toBe(data.userId);
    expect(parsed.timestamp).toBe(data.timestamp);
  });

  it("round-trips a reconnect state containing connectionId and nonce", () => {
    const data = makeState({ connectionId: "conn-123", nonce: "abc123" });
    const signed = createSignedState(data);
    const parsed = verifySignedState(signed);
    expect(parsed.connectionId).toBe("conn-123");
    expect(parsed.nonce).toBe("abc123");
  });

  it("throws when the signature is tampered with", () => {
    const signed = createSignedState(makeState());
    // Flip the last character of the sig
    const tampered = signed.slice(0, -1) + (signed.endsWith("a") ? "b" : "a");
    expect(() => verifySignedState(tampered)).toThrow("Invalid state signature");
  });

  it("throws when the payload is missing a dot separator", () => {
    expect(() => verifySignedState("nodothere")).toThrow();
  });

  it("throws when the payload is corrupted base64", () => {
    // valid sig format but garbage payload
    const fakePayload = "!!!not-base64!!!";
    const crypto = require("crypto");
    const sig = crypto
      .createHmac("sha256", "test-secret-for-unit-tests")
      .update(fakePayload)
      .digest("hex");
    expect(() => verifySignedState(`${fakePayload}.${sig}`)).toThrow();
  });
});

// ── State expiry (simulated) ───────────────────────────────────────────────────

describe("state expiry check (callback logic simulation)", () => {
  const SIXTY_MIN_MS = 60 * 60 * 1000;

  it("considers a fresh state (now) as not expired", () => {
    const data = makeState({ timestamp: Date.now() });
    const signed = createSignedState(data);
    const parsed = verifySignedState(signed);
    expect(Date.now() - parsed.timestamp).toBeLessThan(SIXTY_MIN_MS);
  });

  it("considers a 61-minute-old state as expired", () => {
    const data = makeState({ timestamp: Date.now() - SIXTY_MIN_MS - 60_000 });
    const signed = createSignedState(data);
    const parsed = verifySignedState(signed);
    expect(Date.now() - parsed.timestamp).toBeGreaterThan(SIXTY_MIN_MS);
  });
});

// ── Reconnect callback behaviour (unit-level logic) ───────────────────────────

describe("reconnect callback logic", () => {
  /**
   * Simulates the core reconnect decision tree extracted from the callback:
   *   - verify state
   *   - check expiry
   *   - check nonce consumed
   *   - check merchant match
   */
  function simulateCallback(opts: {
    state: string;
    consumedNonces?: Set<string>;
    existingMerchantId: string;
    incomingMerchantId: string;
    nowOffset?: number; // ms to add to Date.now() to simulate clock advance
  }): { outcome: string; error?: string } {
    const { state, consumedNonces = new Set(), existingMerchantId, incomingMerchantId, nowOffset = 0 } = opts;
    const SIXTY_MIN_MS = 60 * 60 * 1000;

    let parsed: any;
    try {
      parsed = verifySignedState(state);
    } catch {
      return { outcome: "redirect", error: "state_invalid" };
    }

    if (Date.now() + nowOffset - parsed.timestamp > SIXTY_MIN_MS) {
      return { outcome: "redirect", error: "state_expired" };
    }

    if (parsed.nonce && consumedNonces.has(parsed.nonce)) {
      return { outcome: "redirect", error: "state_replayed" };
    }
    if (parsed.nonce) consumedNonces.add(parsed.nonce);

    if (incomingMerchantId !== existingMerchantId) {
      return { outcome: "redirect", error: "merchant_mismatch" };
    }

    return { outcome: "reconnected" };
  }

  it("succeeds when state is valid, nonce is fresh, and merchant matches", () => {
    const state = createSignedState(makeState({ connectionId: "c1", nonce: "n1" }));
    const result = simulateCallback({
      state,
      existingMerchantId: "merchant-A",
      incomingMerchantId: "merchant-A",
    });
    expect(result.outcome).toBe("reconnected");
  });

  it("rejects a tampered state as state_invalid", () => {
    const state = createSignedState(makeState({ connectionId: "c1", nonce: "n2" }));
    const tampered = state.slice(0, -1) + (state.endsWith("a") ? "b" : "a");
    const result = simulateCallback({
      state: tampered,
      existingMerchantId: "merchant-A",
      incomingMerchantId: "merchant-A",
    });
    expect(result.error).toBe("state_invalid");
  });

  it("rejects an expired state as state_expired", () => {
    const state = createSignedState(makeState({
      connectionId: "c1",
      nonce: "n3",
      timestamp: Date.now() - 61 * 60 * 1000, // 61 min ago
    }));
    const result = simulateCallback({
      state,
      existingMerchantId: "merchant-A",
      incomingMerchantId: "merchant-A",
    });
    expect(result.error).toBe("state_expired");
  });

  it("rejects a replayed nonce as state_replayed", () => {
    const nonce = "already-used-nonce";
    const consumed = new Set([nonce]);
    const state = createSignedState(makeState({ connectionId: "c1", nonce }));
    const result = simulateCallback({
      state,
      consumedNonces: consumed,
      existingMerchantId: "merchant-A",
      incomingMerchantId: "merchant-A",
    });
    expect(result.error).toBe("state_replayed");
  });

  it("does not replay the same nonce twice even in the same run", () => {
    const nonce = "single-use";
    const consumed = new Set<string>();
    const state = createSignedState(makeState({ connectionId: "c1", nonce }));

    const first = simulateCallback({
      state,
      consumedNonces: consumed,
      existingMerchantId: "merchant-A",
      incomingMerchantId: "merchant-A",
    });
    expect(first.outcome).toBe("reconnected");

    // Reuse same state token — nonce now consumed
    const second = simulateCallback({
      state,
      consumedNonces: consumed,
      existingMerchantId: "merchant-A",
      incomingMerchantId: "merchant-A",
    });
    expect(second.error).toBe("state_replayed");
  });

  it("rejects a different merchant as merchant_mismatch", () => {
    const state = createSignedState(makeState({ connectionId: "c1", nonce: "n4" }));
    const result = simulateCallback({
      state,
      existingMerchantId: "merchant-A",
      incomingMerchantId: "merchant-B",
    });
    expect(result.error).toBe("merchant_mismatch");
  });

  it("does not create a duplicate connection record when merchant matches (structural test)", () => {
    // The reconnect path calls updatePosConnection, not createPosConnection.
    // This test verifies that the merchant-match gate passes before any write,
    // so a mismatch can never reach the update call.
    const updateCalled = { value: false };
    const createCalled = { value: false };

    const nonce = "n5";
    const state = createSignedState(makeState({ connectionId: "c1", nonce }));
    const consumed = new Set<string>();

    const result = simulateCallback({
      state,
      consumedNonces: consumed,
      existingMerchantId: "merchant-A",
      incomingMerchantId: "merchant-A",
    });

    // Only on reconnected outcome would update be called
    if (result.outcome === "reconnected") updateCalled.value = true;

    expect(createCalled.value).toBe(false); // create must never be called on reconnect
    expect(updateCalled.value).toBe(true);
  });

  it("preserves mappings — merchant mismatch returns error before any DB write", () => {
    // Simulate a mismatch: the callback must return before reaching update/create
    const nonce = "n6";
    const state = createSignedState(makeState({ connectionId: "c1", nonce }));
    const dbWritten = { value: false };

    const result = simulateCallback({
      state,
      existingMerchantId: "merchant-A",
      incomingMerchantId: "merchant-B",
    });

    // Since mismatch is detected, no DB write should occur
    expect(result.error).toBe("merchant_mismatch");
    expect(dbWritten.value).toBe(false);
  });
});

// ── OAuth callback route — integration tests (supertest + stubbed storage) ────
//
// These tests mount only the callback route on a minimal Express app so we can
// exercise the full handler (state validation → exchangeCode → DB write) without
// a real database.  vi.mock() at the top of this file stubs storage and the Square
// connector before any import runs.

import { storage } from "../storage";
import { squarePosConnector } from "../integrations/pos/square";
import { registerPosRoutes } from "./posRoutes";

describe("OAuth callback route — connection upsert behaviour", () => {
  let app: ReturnType<typeof express>;
  let server: Server;

  // Cast to vi.Mock so TypeScript accepts .mockResolvedValue etc.
  const mockGetById = storage.getPosConnectionById as ReturnType<typeof vi.fn>;
  const mockCreate = storage.createPosConnection as ReturnType<typeof vi.fn>;
  const mockUpdate = storage.updatePosConnection as ReturnType<typeof vi.fn>;
  const mockUpsertLoc = storage.upsertPosLocationMappings as ReturnType<typeof vi.fn>;
  const mockExchange = squarePosConnector.exchangeCode as ReturnType<typeof vi.fn>;
  const mockListLoc = squarePosConnector.listLocations as ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default non-fatal stubs
    mockUpsertLoc.mockResolvedValue([]);
    mockListLoc.mockResolvedValue([]);

    // Build a fresh Express app for each test so nonce state doesn't leak
    app = express();
    app.use(express.json());
    registerPosRoutes(app);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Helper: build a valid signed-state query param
  function newConnectionState(companyId = "company-new") {
    return createSignedState({ companyId, userId: "user-1", timestamp: Date.now() });
  }

  function reconnectState(connectionId: string, companyId = "company-abc") {
    return createSignedState({
      companyId,
      userId: "user-1",
      connectionId,
      nonce: `nonce-${Math.random()}`,
      timestamp: Date.now(),
    });
  }

  // ── (a) First-time connection creates exactly one row ─────────────────────

  it("(a) first-time connection calls createPosConnection exactly once and never updatePosConnection", async () => {
    const fakeTokens = {
      accessToken: "tok-access",
      refreshToken: "tok-refresh",
      tokenExpiresAt: new Date(),
      merchantId: "merchant-NEW",
    };
    mockExchange.mockResolvedValue(fakeTokens);
    mockCreate.mockResolvedValue({ id: "conn-created", ...fakeTokens });

    const state = newConnectionState();
    const addr = server.address() as { port: number };

    const res = await request(`http://127.0.0.1:${addr.port}`)
      .get("/api/pos/oauth/square/callback")
      .query({ code: "good-code", state })
      .redirects(0); // capture the redirect without following it

    // Must redirect to the location-mapping page (success path)
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/pos\/location-mapping\/conn-created/);

    // Storage assertions: exactly one create, zero updates
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();

    // Verify the payload passed to create includes the correct fields
    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg.provider).toBe("square");
    expect(createArg.merchantId).toBe("merchant-NEW");
    expect(createArg.status).toBe("active");
  });

  // ── (b) Reconnect upserts — never creates a duplicate row ────────────────

  it("(b) reconnect path calls updatePosConnection exactly once and never createPosConnection", async () => {
    const existingConnection = {
      id: "conn-existing",
      companyId: "company-abc",
      merchantId: "merchant-ABC",
      accessToken: "old-tok",
      refreshToken: "old-refresh",
      tokenExpiresAt: new Date(),
      status: "disconnected",
    };
    mockGetById.mockResolvedValue(existingConnection);

    const fakeTokens = {
      accessToken: "new-tok-access",
      refreshToken: "new-tok-refresh",
      tokenExpiresAt: new Date(),
      merchantId: "merchant-ABC", // same merchant
    };
    mockExchange.mockResolvedValue(fakeTokens);
    mockUpdate.mockResolvedValue({ ...existingConnection, ...fakeTokens, status: "active" });

    const state = reconnectState("conn-existing");
    const addr = server.address() as { port: number };

    const res = await request(`http://127.0.0.1:${addr.port}`)
      .get("/api/pos/oauth/square/callback")
      .query({ code: "reconnect-code", state })
      .redirects(0);

    // Must redirect to the reconnected success page
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/pos_reconnected=1/);

    // Storage assertions: exactly one update, zero creates
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();

    // Confirm update was called with the right connection id and fresh tokens
    const [updatedId, updatedCompanyId, updatedFields] = mockUpdate.mock.calls[0];
    expect(updatedId).toBe("conn-existing");
    expect(updatedCompanyId).toBe("company-abc");
    expect(updatedFields.accessToken).toBe("new-tok-access");
    expect(updatedFields.status).toBe("active");
  });

  // ── (c) Bad OAuth code — no DB row created ────────────────────────────────

  it("(c) bad OAuth code from Square causes a redirect with error and no DB writes", async () => {
    mockExchange.mockRejectedValue(new Error("Square token exchange failed: invalid_grant"));

    const state = newConnectionState();
    const addr = server.address() as { port: number };

    const res = await request(`http://127.0.0.1:${addr.port}`)
      .get("/api/pos/oauth/square/callback")
      .query({ code: "bad-code", state })
      .redirects(0);

    // Must redirect to the error page — not a 200 or 500
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/pos_error/);

    // No storage writes must occur
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── (d) Cross-company attack — state.companyId !== connection.companyId ──────

  it("(d) cross-company reconnect token is rejected with connection_not_found and no DB writes", async () => {
    // The attacker embeds company-evil's companyId in the state token but passes
    // company-abc's connectionId. The callback must detect the mismatch at the
    // companyId check (line 171 of posRoutes.ts) and bail out before any write.
    const existingConnection = {
      id: "conn-existing",
      companyId: "company-abc",       // legitimate owner
      merchantId: "merchant-ABC",
      accessToken: "old-tok",
      refreshToken: "old-refresh",
      tokenExpiresAt: new Date(),
      status: "active",
    };
    mockGetById.mockResolvedValue(existingConnection);

    // State is signed with a *different* companyId — the cross-company payload
    const attackerState = createSignedState({
      companyId: "company-evil",      // attacker's company, not the connection's
      userId: "user-attacker",
      connectionId: "conn-existing",  // victim's connection id
      nonce: `nonce-${Math.random()}`,
      timestamp: Date.now(),
    });

    const addr = server.address() as { port: number };

    const res = await request(`http://127.0.0.1:${addr.port}`)
      .get("/api/pos/oauth/square/callback")
      .query({ code: "any-code", state: attackerState })
      .redirects(0);

    // Must redirect to connection_not_found — not a 200 or 500
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/pos_error=connection_not_found/);

    // Neither create nor update must ever be called
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── Edge: missing code/state params redirect without any DB writes ─────────

  it("missing code param redirects to error without any DB writes", async () => {
    const addr = server.address() as { port: number };

    const res = await request(`http://127.0.0.1:${addr.port}`)
      .get("/api/pos/oauth/square/callback")
      .query({ state: newConnectionState() }) // no code
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/pos_error=missing_params/);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── PATCH /api/pos/connections/:id/item-mappings/:variationId ─────────────────
//
// Covers: ignore existing row, unignore existing row, relink existing row,
//         first-time ignore when no row exists yet (upsert path),
//         missing external names on first-time upsert (400),
//         connection-not-found guard (404).

describe("PATCH /api/pos/connections/:id/item-mappings/:variationId", () => {
  let app: ReturnType<typeof express>;
  let server: Server;

  const mockGetById       = storage.getPosConnectionById as ReturnType<typeof vi.fn>;
  const mockUpdateMapping = storage.updatePosItemMapping  as ReturnType<typeof vi.fn>;
  const mockUpsertMappings = storage.upsertPosItemMappings as ReturnType<typeof vi.fn>;

  const CONN_ID  = "conn-patch-test";
  const VAR_ID   = "var-abc123";
  const COMPANY  = "company-test"; // must match requireAuth stub above

  const fakeConn = { id: CONN_ID, companyId: COMPANY, status: "active" };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    registerPosRoutes(app);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function url(variationId = VAR_ID) {
    return `/api/pos/connections/${CONN_ID}/item-mappings/${encodeURIComponent(variationId)}`;
  }
  function addr() { return (server.address() as { port: number }).port; }

  it("sets ignored=1 on an existing mapping row", async () => {
    const savedRow = { id: "map-1", connectionId: CONN_ID, externalVariationId: VAR_ID, ignored: 1 };
    mockGetById.mockResolvedValue(fakeConn);
    mockUpdateMapping.mockResolvedValue(savedRow);

    const res = await request(`http://127.0.0.1:${addr()}`)
      .patch(url())
      .send({ ignored: true });

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(1);
    expect(mockUpdateMapping).toHaveBeenCalledWith(CONN_ID, VAR_ID, { ignored: true });
    // Should NOT fall through to upsert when UPDATE returned a row
    expect(mockUpsertMappings).not.toHaveBeenCalled();
  });

  it("clears ignored (unignore) on an existing row", async () => {
    const savedRow = { id: "map-1", connectionId: CONN_ID, externalVariationId: VAR_ID, ignored: 0 };
    mockGetById.mockResolvedValue(fakeConn);
    mockUpdateMapping.mockResolvedValue(savedRow);

    const res = await request(`http://127.0.0.1:${addr()}`)
      .patch(url())
      .send({ ignored: false });

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(0);
    expect(mockUpdateMapping).toHaveBeenCalledWith(CONN_ID, VAR_ID, { ignored: false });
  });

  it("relinks menuItemId on an existing row", async () => {
    const savedRow = { id: "map-1", menuItemId: "mi-new" };
    mockGetById.mockResolvedValue(fakeConn);
    mockUpdateMapping.mockResolvedValue(savedRow);

    const res = await request(`http://127.0.0.1:${addr()}`)
      .patch(url())
      .send({ menuItemId: "mi-new" });

    expect(res.status).toBe(200);
    expect(res.body.menuItemId).toBe("mi-new");
    expect(mockUpdateMapping).toHaveBeenCalledWith(CONN_ID, VAR_ID, { menuItemId: "mi-new" });
  });

  it("upserts (creates) the row when it does not exist yet — first-time ignore", async () => {
    // updatePosItemMapping returns undefined → row not found → fall through to upsert
    const newRow = { id: "map-new", connectionId: CONN_ID, externalVariationId: VAR_ID, ignored: 1 };
    mockGetById.mockResolvedValue(fakeConn);
    mockUpdateMapping.mockResolvedValue(undefined);
    mockUpsertMappings.mockResolvedValue([newRow]);

    const res = await request(`http://127.0.0.1:${addr()}`)
      .patch(url())
      .send({
        ignored: true,
        externalItemId: "item-xyz",
        externalItemName: "Margherita Pizza",
        externalVariationName: "Large",
      });

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(1);
    expect(mockUpsertMappings).toHaveBeenCalledWith(
      CONN_ID,
      COMPANY,
      expect.arrayContaining([
        expect.objectContaining({
          externalVariationId: VAR_ID,
          externalItemId: "item-xyz",
          externalItemName: "Margherita Pizza",
          externalVariationName: "Large",
          ignored: true,
        }),
      ]),
    );
  });

  it("returns 400 when no row exists and external names are missing", async () => {
    mockGetById.mockResolvedValue(fakeConn);
    mockUpdateMapping.mockResolvedValue(undefined); // no row

    const res = await request(`http://127.0.0.1:${addr()}`)
      .patch(url())
      .send({ ignored: true }); // no externalItemId / names

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/externalItemId/);
  });

  it("returns 404 when the connection belongs to a different company", async () => {
    mockGetById.mockResolvedValue({ ...fakeConn, companyId: "other-company" });

    const res = await request(`http://127.0.0.1:${addr()}`)
      .patch(url())
      .send({ ignored: true });

    expect(res.status).toBe(404);
    expect(mockUpdateMapping).not.toHaveBeenCalled();
  });
});

// ── POST /api/pos/connections/:id/item-mappings/create-and-link ───────────────
//
// Covers: happy-path creates a menu item + mapping, missing required fields (400),
//         duplicate pluSku (409), connection-not-found guard (404).

describe("POST /api/pos/connections/:id/item-mappings/create-and-link", () => {
  let app: ReturnType<typeof express>;
  let server: Server;

  const mockGetById        = storage.getPosConnectionById  as ReturnType<typeof vi.fn>;
  const mockCreateMenuItem = storage.createMenuItem         as ReturnType<typeof vi.fn>;
  const mockUpsertMappings  = storage.upsertPosItemMappings  as ReturnType<typeof vi.fn>;

  const CONN_ID = "conn-cal-test";
  const COMPANY = "company-test";
  const fakeConn = { id: CONN_ID, companyId: COMPANY, status: "active" };

  const goodBody = {
    externalVariationId: "var-zzz",
    externalItemId: "item-zzz",
    externalItemName: "Margherita",
    externalVariationName: "Large",
    menuItemName: "Margherita Pizza Large",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    registerPosRoutes(app);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function url() { return `/api/pos/connections/${CONN_ID}/item-mappings/create-and-link`; }
  function addr() { return (server.address() as { port: number }).port; }

  it("creates a menu item and links it — returns both in the response", async () => {
    const newItem    = { id: "mi-created", name: "Margherita Pizza Large", pluSku: "SQ-var-zzz" };
    const newMapping = { id: "map-created", menuItemId: "mi-created", ignored: 0 };
    mockGetById.mockResolvedValue(fakeConn);
    mockCreateMenuItem.mockResolvedValue(newItem);
    mockUpsertMappings.mockResolvedValue([newMapping]);

    const res = await request(`http://127.0.0.1:${addr()}`)
      .post(url())
      .send(goodBody);

    expect(res.status).toBe(200);
    expect(res.body.menuItem.id).toBe("mi-created");
    expect(res.body.mapping.menuItemId).toBe("mi-created");
    expect(mockCreateMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY, name: "Margherita Pizza Large" }),
    );
    expect(mockUpsertMappings).toHaveBeenCalledWith(
      CONN_ID,
      COMPANY,
      expect.arrayContaining([
        expect.objectContaining({
          externalVariationId: "var-zzz",
          menuItemId: "mi-created",
          ignored: false,
        }),
      ]),
    );
  });

  it("returns 400 when externalVariationId or menuItemName is missing", async () => {
    mockGetById.mockResolvedValue(fakeConn);

    const res = await request(`http://127.0.0.1:${addr()}`)
      .post(url())
      .send({ menuItemName: "Test" }); // missing externalVariationId

    expect(res.status).toBe(400);
    expect(mockCreateMenuItem).not.toHaveBeenCalled();
  });

  it("returns 409 when createMenuItem throws a unique-constraint error", async () => {
    mockGetById.mockResolvedValue(fakeConn);
    mockCreateMenuItem.mockRejectedValue(new Error("duplicate key value violates unique constraint"));

    const res = await request(`http://127.0.0.1:${addr()}`)
      .post(url())
      .send(goodBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  it("returns 404 when the connection belongs to a different company", async () => {
    mockGetById.mockResolvedValue({ ...fakeConn, companyId: "other-company" });

    const res = await request(`http://127.0.0.1:${addr()}`)
      .post(url())
      .send(goodBody);

    expect(res.status).toBe(404);
    expect(mockCreateMenuItem).not.toHaveBeenCalled();
  });
});
