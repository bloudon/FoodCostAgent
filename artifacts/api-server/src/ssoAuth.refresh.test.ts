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

describe("isSsoAuthenticated — refresh failure", () => {
  it("calls next() gracefully when the Google refresh grant throws", async () => {
    mockRefreshTokenGrant.mockRejectedValue(new Error("invalid_grant"));
    const req = makeReq({ provider: "google", expires_at: EXPIRED });
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() gracefully when the Replit refresh grant throws", async () => {
    mockRefreshTokenGrant.mockRejectedValue(new Error("token_expired"));
    const req = makeReq({ provider: "replit", expires_at: EXPIRED });
    const next = makeNext();
    await isSsoAuthenticated(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
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
