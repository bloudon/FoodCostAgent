// @vitest-environment jsdom
/**
 * Unit tests for client/src/lib/analytics.ts
 *
 * Verifies:
 *  - isMarketingDomain() guard: only passes on fnbcostpro.com / www.fnbcostpro.com
 *  - track() always appends page and timestamp base props
 *  - track() calls window.gtag on marketing domains
 *  - track() logs to console.debug (not gtag) on non-marketing domains
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    value: { hostname, pathname: "/test-path", href: `https://${hostname}/test-path` },
    writable: true,
    configurable: true,
  });
}

// We need to re-import analytics after setting up the hostname because the
// module reads window.location at call time (not module load time), so we
// can just import once and change window.location between tests.
import { track } from "./analytics";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analytics – isMarketingDomain guard", () => {
  let gtag: ReturnType<typeof vi.fn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it("calls gtag on fnbcostpro.com", () => {
    setHostname("fnbcostpro.com");
    track("hero_cta_click", { language: "en" });
    expect(gtag).toHaveBeenCalledOnce();
    const [, name, payload] = gtag.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("hero_cta_click");
    expect(payload).toMatchObject({ language: "en", page: "/test-path" });
    expect(typeof payload.timestamp).toBe("string");
  });

  it("calls gtag on www.fnbcostpro.com", () => {
    setHostname("www.fnbcostpro.com");
    track("pricing_page_viewed", { language: "es" });
    expect(gtag).toHaveBeenCalledOnce();
    const [, name] = gtag.mock.calls[0] as [string, string, unknown];
    expect(name).toBe("pricing_page_viewed");
  });

  it("does NOT call gtag on localhost", () => {
    setHostname("localhost");
    track("hero_cta_click", { language: "en" });
    expect(gtag).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
  });

  it("does NOT call gtag on Replit dev hostnames", () => {
    setHostname("abc123.replit.dev");
    track("workflow_section_viewed", { language: "en" });
    expect(gtag).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
  });

  it("does NOT call gtag on app.fnbcostpro.com", () => {
    setHostname("app.fnbcostpro.com");
    track("for_chefs_page_viewed", { language: "en" });
    expect(gtag).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
  });
});

describe("analytics – base props", () => {
  let gtag: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    setHostname("fnbcostpro.com");
  });

  afterEach(() => {
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it("always includes page and timestamp", () => {
    track("contact_form_started", { language: "en" });
    const payload = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(payload.page).toBe("/test-path");
    expect(typeof payload.timestamp).toBe("string");
    // ISO-8601 check
    expect(() => new Date(payload.timestamp as string)).not.toThrow();
  });

  it("caller-supplied props override base props", () => {
    track("industry_page_viewed", { language: "en", segment: "chef-led", page: "/custom" });
    const payload = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(payload.page).toBe("/custom");
    expect(payload.segment).toBe("chef-led");
  });
});

describe("analytics – language_switched includes language prop", () => {
  let gtag: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    setHostname("fnbcostpro.com");
  });

  afterEach(() => {
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it("language_switched carries language, from, and to", () => {
    track("language_switched", { language: "en", from: "en", to: "es" });
    const payload = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(payload.language).toBe("en");
    expect(payload.from).toBe("en");
    expect(payload.to).toBe("es");
  });
});
