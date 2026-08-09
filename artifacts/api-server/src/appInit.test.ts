/**
 * Startup sequencing regression (#997 completion review):
 * initApp() must fully register the canonical /api/sso/* routes — including
 * the async Google OIDC discovery path — before the app serves requests,
 * and a discovery failure must surface as a controlled startup error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";

vi.mock("openid-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openid-client")>();
  return { ...actual, discovery: vi.fn() };
});

vi.mock("./storage", () => ({
  storage: {
    getUserBySsoId: vi.fn(),
    getUserByEmail: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    createUser: vi.fn(),
    getInvitationByToken: vi.fn(),
    acceptInvitation: vi.fn(),
    getCompanyStores: vi.fn(),
    assignUserToStore: vi.fn(),
  },
}));

// Avoid a real Postgres-backed session store during app init
vi.mock("connect-pg-simple", () => ({
  default: () => class MemoryLikeStore {
    on() {}
    get(_sid: string, cb: any) { cb(null, null); }
    set(_sid: string, _sess: any, cb: any) { cb?.(null); }
    destroy(_sid: string, cb: any) { cb?.(null); }
    touch(_sid: string, _sess: any, cb: any) { cb?.(null); }
  },
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env.SESSION_SECRET = "test-session-secret";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function listen(app: any): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("app initialization sequencing", () => {
  it("registers Google /api/sso routes via awaited initApp before serving (mocked discovery)", async () => {
    process.env.OIDC_CLIENT_ID = "test-cid";
    process.env.OIDC_CLIENT_SECRET = "test-secret";
    process.env.APP_BASE_URL = "https://app.fnbcostpro.com";

    const openid = await import("openid-client");
    const discoveryMock = vi.mocked(openid.discovery);
    discoveryMock.mockReset();
    discoveryMock.mockResolvedValue(
        new openid.Configuration(
          {
            issuer: "https://accounts.google.com",
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
            token_endpoint: "https://oauth2.googleapis.com/token",
          },
          "test-cid",
          { client_secret: "test-secret" },
        ) as any,
      );

    const { initApp } = await import("./app");
    const app = await initApp();
    const srv = await listen(app);
    try {
      const provider = await fetch(`${srv.base}/api/sso/provider`).then((r) => r.json());
      expect(provider).toEqual({ provider: "google" });

      const login = await fetch(`${srv.base}/api/sso/login`, { redirect: "manual" });
      expect(login.status).toBe(302);
      const location = login.headers.get("location") ?? "";
      expect(location).toContain("accounts.google.com");
      expect(location).toContain(
        encodeURIComponent("https://app.fnbcostpro.com/api/sso/callback"),
      );
      expect(location).toContain("scope=openid+email+profile");
      expect(location).not.toContain("offline_access");
      expect(location).toContain("access_type=offline");
    } finally {
      await srv.close();
      
    }
  });

  it("fails initApp with a controlled error when Google discovery fails", async () => {
    process.env.OIDC_CLIENT_ID = "test-cid";
    process.env.OIDC_CLIENT_SECRET = "test-secret";
    process.env.APP_BASE_URL = "https://app.fnbcostpro.com";

    const openid = await import("openid-client");
    const discoveryMock = vi.mocked(openid.discovery);
    discoveryMock.mockReset();
    discoveryMock.mockRejectedValue(new Error("discovery unreachable"));

    const { initApp } = await import("./app");
    await expect(initApp()).rejects.toThrow("discovery unreachable");
    
  });

  it("falls back to the Replit provider when Google env is absent", async () => {
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.APP_BASE_URL;
    process.env.REPL_ID = process.env.REPL_ID || "test-repl-id";

    const openid = await import("openid-client");
    const discoveryMock = vi.mocked(openid.discovery);
    discoveryMock.mockReset();
    discoveryMock.mockResolvedValue(
        new openid.Configuration(
          {
            issuer: "https://replit.com/oidc",
            authorization_endpoint: "https://replit.com/oidc/auth",
            token_endpoint: "https://replit.com/oidc/token",
          },
          "test-repl-id",
        ) as any,
      );

    const { initApp } = await import("./app");
    const app = await initApp();
    const srv = await listen(app);
    try {
      const provider = await fetch(`${srv.base}/api/sso/provider`).then((r) => r.json());
      expect(provider).toEqual({ provider: "replit" });
    } finally {
      await srv.close();
      
    }
  });
});
