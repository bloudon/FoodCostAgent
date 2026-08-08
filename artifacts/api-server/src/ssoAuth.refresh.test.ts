/**
 * Regression tests for provider-specific token refresh in isSsoAuthenticated (#998)
 *
 * Verifies that:
 *  - Google sessions use the Google OIDC config for refresh, not the Replit config
 *  - Replit sessions use the Replit OIDC config for refresh
 *  - A session without a refresh token skips the refresh path entirely
 *  - A failed refresh is handled gracefully (falls through to next())
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist shared mocks so vi.mock factories can reference them ────────────────

const { mockRefreshTokenGrant, mockDiscovery, mockGetGoogleOidcConfig } = vi.hoisted(() => {
  const mockReplitConfig = { _name: "replit-oidc" } as any;
  const mockGoogleConfig = { _name: "google-oidc" } as any;

  return {
    mockRefreshTokenGrant: vi.fn(),
    mockDiscovery: vi.fn(async () => mockReplitConfig),
    mockGetGoogleOidcConfig: vi.fn(async () => mockGoogleConfig),
  };
});

// ── Mock openid-client ────────────────────────────────────────────────────────

vi.mock("openid-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openid-client")>();
  return {
    ...actual,
    discovery: mockDiscovery,
    refreshTokenGrant: mockRefreshTokenGrant,
  };
});

// ── Mock googleAuth ───────────────────────────────────────────────────────────

vi.mock("./googleAuth", () => ({
  isGoogleConfigured: vi.fn(() => false),
  setupGoogleSsoRoutes: vi.fn(),
  getGoogleOidcConfig: mockGetGoogleOidcConfig,
}));

// ── Mock memoizee (so getOidcConfig returns our stub immediately) ─────────────

vi.mock("memoizee", () => ({
  default: (fn: Function) => fn,
}));

// ── Mock storage ──────────────────────────────────────────────────────────────

vi.mock("./storage", () => ({
  storage: {
    getUser: vi.fn(async () => ({
      id: "user-1",
      email: "chef@fnb.com",
      companyId: "co-1",
      role: "store_manager",
    })),
  },
}));

// ── Mock connect-pg-simple ────────────────────────────────────────────────────

vi.mock("connect-pg-simple", () => ({
  default: () => class MockPgStore {},
}));

// ── Mock express-session ──────────────────────────────────────────────────────

vi.mock("express-session", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

// ── Mock passport ─────────────────────────────────────────────────────────────

vi.mock("passport", () => ({
  default: {
    initialize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
    session: vi.fn(() => (_req: any, _res: any, next: any) => next()),
    serializeUser: vi.fn(),
    deserializeUser: vi.fn(),
    use: vi.fn(),
    authenticate: vi.fn(),
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { isSsoAuthenticated } from "./ssoAuth";
import { getGoogleOidcConfig } from "./googleAuth";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW_SECONDS = Math.floor(Date.now() / 1000);
const EXPIRED = NOW_SECONDS - 100; // 100 s in the past
const VALID = NOW_SECONDS + 3600;  // 1 hour in the future

function makeReq(fields: Record<string, any> = {}) {
  return {
    isAuthenticated: () => true,
    user: {
      userId: "user-1",
      refresh_token: "rt-abc",
      expires_at: EXPIRED,
      provider: "replit",
      ...fields,
    },
    session: { selectedCompanyId: null },
  } as any;
}

function makeRes() {
  return {} as any;
}

function makeNext() {
  return vi.fn();
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: discovery returns replit config; Google config returns google config
  mockDiscovery.mockResolvedValue({ _name: "replit-oidc" });
  mockGetGoogleOidcConfig.mockResolvedValue({ _name: "google-oidc" });

  // Default: refresh succeeds
  mockRefreshTokenGrant.mockResolvedValue({
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
    claims: () => ({ exp: NOW_SECONDS + 3600 }),
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("isSsoAuthenticated — token still valid", () => {
  it("skips refresh entirely when the token has not expired", async () => {
    const req = makeReq({ expires_at: VALID });
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("isSsoAuthenticated — Replit session refresh", () => {
  it("uses the Replit OIDC config when provider is 'replit'", async () => {
    const req = makeReq({ provider: "replit", expires_at: EXPIRED });
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(mockDiscovery).toHaveBeenCalled();
    expect(getGoogleOidcConfig).not.toHaveBeenCalled();
    expect(mockRefreshTokenGrant).toHaveBeenCalledWith(
      expect.objectContaining({ _name: "replit-oidc" }),
      "rt-abc",
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("uses the Replit OIDC config when provider is absent (legacy sessions)", async () => {
    const req = makeReq({ provider: undefined, expires_at: EXPIRED });
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(mockDiscovery).toHaveBeenCalled();
    expect(getGoogleOidcConfig).not.toHaveBeenCalled();
    expect(mockRefreshTokenGrant).toHaveBeenCalledWith(
      expect.objectContaining({ _name: "replit-oidc" }),
      "rt-abc",
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("isSsoAuthenticated — Google session refresh", () => {
  it("uses the Google OIDC config when provider is 'google'", async () => {
    const req = makeReq({ provider: "google", expires_at: EXPIRED });
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(getGoogleOidcConfig).toHaveBeenCalled();
    expect(mockDiscovery).not.toHaveBeenCalled();
    expect(mockRefreshTokenGrant).toHaveBeenCalledWith(
      expect.objectContaining({ _name: "google-oidc" }),
      "rt-abc",
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("isSsoAuthenticated — no refresh token", () => {
  it("skips refresh and calls next() when no refresh token is stored", async () => {
    const req = makeReq({ provider: "google", expires_at: EXPIRED, refresh_token: undefined });
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("isSsoAuthenticated — refresh failure (transient)", () => {
  it("calls next() gracefully when the Google refresh grant throws a transient error", async () => {
    mockRefreshTokenGrant.mockRejectedValue(new Error("network_error"));
    const req = makeReq({ provider: "google", expires_at: EXPIRED });
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() gracefully when the Replit refresh grant throws a transient error", async () => {
    mockRefreshTokenGrant.mockRejectedValue(new Error("token_expired"));
    const req = makeReq({ provider: "replit", expires_at: EXPIRED });
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("isSsoAuthenticated — terminal token revocation", () => {
  /**
   * Build an error that matches the real openid-client / oauth4webapi shape.
   * ResponseBodyError sets `.error` to the OAuth code and `.message` to the
   * generic string "server responded with an error in the response body".
   * We replicate that so the detection code is exercised faithfully.
   */
  function makeOAuthError(code: string) {
    const err = new Error("server responded with an error in the response body") as any;
    err.error = code;
    return err;
  }

  function makeRevocableReq(provider: string) {
    const req = makeReq({ provider, expires_at: EXPIRED });
    req.logout = vi.fn((cb: () => void) => cb());
    req.session.destroy = vi.fn((cb: (err: any) => void) => cb(null));
    return req;
  }

  function makeJsonRes() {
    const json = vi.fn().mockReturnValue(undefined);
    const status = vi.fn().mockReturnValue({ json });
    return { status, json } as any;
  }

  it("returns 401 with reauthenticate:true on invalid_grant (ResponseBodyError shape) for Google", async () => {
    mockRefreshTokenGrant.mockRejectedValue(makeOAuthError("invalid_grant"));
    const req = makeRevocableReq("google");
    const res = makeJsonRes();
    const next = makeNext();
    await isSsoAuthenticated(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.status().json).toHaveBeenCalledWith(
      expect.objectContaining({ reauthenticate: true }),
    );
    expect(req.logout).toHaveBeenCalled();
  });

  it("returns 401 with reauthenticate:true on token_revoked (ResponseBodyError shape) for Google", async () => {
    mockRefreshTokenGrant.mockRejectedValue(makeOAuthError("token_revoked"));
    const req = makeRevocableReq("google");
    const res = makeJsonRes();
    const next = makeNext();
    await isSsoAuthenticated(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.status().json).toHaveBeenCalledWith(
      expect.objectContaining({ reauthenticate: true }),
    );
    expect(req.logout).toHaveBeenCalled();
  });

  it("destroys the session on terminal revocation", async () => {
    mockRefreshTokenGrant.mockRejectedValue(makeOAuthError("invalid_grant"));
    const req = makeRevocableReq("google");
    const res = makeJsonRes();
    await isSsoAuthenticated(req, res, makeNext());
    expect(req.session.destroy).toHaveBeenCalled();
  });

  it("does NOT return 401 for a transient error (falls through to next)", async () => {
    // server_error has .error = "server_error" (not a terminal code) — should fall through
    mockRefreshTokenGrant.mockRejectedValue(makeOAuthError("server_error"));
    const req = makeRevocableReq("google");
    const res = makeJsonRes();
    const next = makeNext();
    await isSsoAuthenticated(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("also catches invalid_grant carried only in the error message (fallback path)", async () => {
    // Some edge-case libraries surface the code in message rather than .error
    mockRefreshTokenGrant.mockRejectedValue(new Error("invalid_grant"));
    const req = makeRevocableReq("google");
    const res = makeJsonRes();
    const next = makeNext();
    await isSsoAuthenticated(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("isSsoAuthenticated — not authenticated", () => {
  it("falls through immediately when isAuthenticated() is false", async () => {
    const req = { isAuthenticated: () => false, user: null } as any;
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("falls through when user has no expires_at (non-SSO session)", async () => {
    const req = {
      isAuthenticated: () => true,
      user: { userId: "user-1" }, // no expires_at
    } as any;
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
