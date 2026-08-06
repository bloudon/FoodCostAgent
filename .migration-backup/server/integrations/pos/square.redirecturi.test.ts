/**
 * Unit tests for buildSquareRedirectUri — confirms the URI sent to Square
 * during OAuth matches what an operator must register in the Square
 * Developer Dashboard.
 *
 * Priority order under test:
 *   1. APP_BASE_URL (production / VPS)
 *   2. REPLIT_DEV_DOMAIN (Replit preview)
 *   3. localhost:5000 fallback
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildSquareRedirectUri } from "./square";

const CALLBACK_PATH = "/api/pos/oauth/square/callback";

afterEach(() => {
  delete process.env.APP_BASE_URL;
  delete process.env.REPLIT_DEV_DOMAIN;
});

describe("buildSquareRedirectUri — URI construction", () => {
  it("uses APP_BASE_URL when set — trailing slash is stripped", () => {
    process.env.APP_BASE_URL = "https://app.fnbcostpro.com/";
    delete process.env.REPLIT_DEV_DOMAIN;

    expect(buildSquareRedirectUri()).toBe(
      `https://app.fnbcostpro.com${CALLBACK_PATH}`,
    );
  });

  it("uses APP_BASE_URL without trailing slash unchanged", () => {
    process.env.APP_BASE_URL = "https://app.fnbcostpro.com";
    delete process.env.REPLIT_DEV_DOMAIN;

    expect(buildSquareRedirectUri()).toBe(
      `https://app.fnbcostpro.com${CALLBACK_PATH}`,
    );
  });

  it("falls back to REPLIT_DEV_DOMAIN when APP_BASE_URL is absent", () => {
    delete process.env.APP_BASE_URL;
    process.env.REPLIT_DEV_DOMAIN = "abc123.replit.dev";

    expect(buildSquareRedirectUri()).toBe(
      `https://abc123.replit.dev${CALLBACK_PATH}`,
    );
  });

  it("falls back to localhost:5000 when both env vars are absent", () => {
    delete process.env.APP_BASE_URL;
    delete process.env.REPLIT_DEV_DOMAIN;

    expect(buildSquareRedirectUri()).toBe(
      `http://localhost:5000${CALLBACK_PATH}`,
    );
  });

  it("APP_BASE_URL takes precedence over REPLIT_DEV_DOMAIN when both are set", () => {
    process.env.APP_BASE_URL = "https://app.fnbcostpro.com";
    process.env.REPLIT_DEV_DOMAIN = "abc123.replit.dev";

    expect(buildSquareRedirectUri()).toBe(
      `https://app.fnbcostpro.com${CALLBACK_PATH}`,
    );
  });
});
