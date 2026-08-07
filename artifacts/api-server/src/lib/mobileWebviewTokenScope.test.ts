/**
 * Regression tests for Task #986 completion-review findings:
 *
 * 1. Every mobile WebView wrapper's injected script must restrict the
 *    mobileToken Authorization header to SAME-ORIGIN requests only, so the
 *    long-lived bearer token can never leak to third-party origins reached
 *    by an embedded page. The injected scripts are executed here inside a
 *    sandboxed VM with a stubbed browser environment and probed with both
 *    same-origin and cross-origin fetch/XHR calls.
 *
 * 2. The bulk POST /api/mobile/sessions/:id/apply-scan "add" mode must use
 *    the atomic SQL increment (storage.atomicIncrementCountLineQty) — never
 *    client-visible read-then-write arithmetic — so concurrent applies
 *    cannot lose an update. Verified as a source invariant on the registered
 *    route body (the atomic path itself is covered by storage tests).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it, expect } from "vitest";

const MOBILE_DIR = path.resolve(__dirname, "../../../fnb-cost-pro-mobile");

const WRAPPERS = [
  "components/WebSection.tsx",
  "app/inventory-web.tsx",
  "app/session/count-web.tsx",
] as const;

function extractInjectedScript(file: string): string {
  const src = readFileSync(path.join(MOBILE_DIR, file), "utf8");
  const m = src.match(/const INJECTED_SCRIPT = `([\s\S]*?)`;/);
  if (!m) throw new Error(`INJECTED_SCRIPT not found in ${file}`);
  return m[1];
}

const APP_ORIGIN = "https://app.fnbcostpro.com";
const TOKEN = "test-mobile-token-123";

interface Capture {
  fetches: { url: string; auth: string | undefined }[];
  xhrs: { url: string; auth: string | undefined }[];
}

/** Build a minimal browser-ish sandbox, run the injected script, return probes. */
function runInjectedScript(script: string): {
  sandbox: any;
  capture: Capture;
} {
  const capture: Capture = { fetches: [], xhrs: [] };

  const storage = new Map<string, string>();

  class StubXHR {
    _headers: Record<string, string> = {};
    _url = "";
    open(_method: string, url: string) {
      this._url = url;
    }
    setRequestHeader(k: string, v: string) {
      this._headers[k] = v;
    }
    send() {
      capture.xhrs.push({ url: this._url, auth: this._headers["Authorization"] });
    }
    addEventListener() {}
    get status() {
      return 200;
    }
  }

  const windowObj: any = {
    location: {
      href: `${APP_ORIGIN}/dashboard/mobile?mobileToken=${TOKEN}`,
      origin: APP_ORIGIN,
      search: `?mobileToken=${TOKEN}`,
    },
    ReactNativeWebView: { postMessage: () => {} },
    addEventListener: () => {},
    fetch: (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? "";
      const auth = init?.headers?.["Authorization"];
      capture.fetches.push({ url, auth });
      return Promise.resolve({ status: 200 });
    },
  };

  const sandbox: any = {
    window: windowObj,
    document: {
      addEventListener: () => {},
      querySelectorAll: () => [],
      body: null,
      readyState: "loading",
    },
    console: { log() {}, warn() {}, error() {}, info() {} },
    URL,
    URLSearchParams,
    JSON,
    Array,
    Object,
    Promise,
    String,
    Error,
    sessionStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    },
    XMLHttpRequest: StubXHR,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout,
  };
  // Scripts reference bare identifiers that resolve on window in browsers.
  sandbox.globalThis = sandbox;
  windowObj.sessionStorage = sandbox.sessionStorage;
  windowObj.XMLHttpRequest = StubXHR;
  windowObj.fetch = windowObj.fetch.bind(windowObj);

  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { timeout: 2000 });
  return { sandbox, capture };
}

describe.each(WRAPPERS)("injected mobileToken scope — %s", (file) => {
  const script = extractInjectedScript(file);

  it("attaches Authorization to same-origin requests", async () => {
    const { sandbox, capture } = runInjectedScript(script);
    await sandbox.window.fetch(`${APP_ORIGIN}/api/mobile/stores`);
    await sandbox.window.fetch("/api/mobile/sessions/active"); // relative = same-origin
    expect(capture.fetches).toHaveLength(2);
    for (const f of capture.fetches) {
      expect(f.auth).toBe(`Bearer ${TOKEN}`);
    }

    const xhr = new sandbox.window.XMLHttpRequest();
    // The patched prototype lives on the sandbox's XMLHttpRequest
    xhr.open("GET", `${APP_ORIGIN}/api/whatever`);
    xhr.send();
    expect(capture.xhrs[0].auth).toBe(`Bearer ${TOKEN}`);
  });

  it("NEVER attaches Authorization to cross-origin requests", async () => {
    const { sandbox, capture } = runInjectedScript(script);
    await sandbox.window.fetch("https://evil.example.com/steal");
    await sandbox.window.fetch("http://app.fnbcostpro.com/api"); // scheme change = different origin
    for (const f of capture.fetches) {
      expect(f.auth).toBeUndefined();
    }

    const xhr = new sandbox.window.XMLHttpRequest();
    xhr.open("GET", "https://evil.example.com/steal");
    xhr.send();
    expect(capture.xhrs[0].auth).toBeUndefined();
  });
});

describe("POST /api/mobile/sessions/:id/apply-scan — atomic add invariant", () => {
  const routesSrc = readFileSync(path.resolve(__dirname, "../routes.ts"), "utf8");

  // Isolate the apply-scan handler body (from its registration to the next route).
  const start = routesSrc.indexOf('app.post("/api/mobile/sessions/:id/apply-scan"');
  expect(start).toBeGreaterThan(-1);
  const end = routesSrc.indexOf("app.post(", start + 10);
  const handler = routesSrc.slice(start, end === -1 ? undefined : end);

  it("add mode uses storage.atomicIncrementCountLineQty", () => {
    expect(handler).toContain("atomicIncrementCountLineQty");
  });

  it("does not compute add-mode qty with read-then-write arithmetic", () => {
    // The historical race: newQty = (existingLine.qty ?? 0) + Number(qty)
    expect(handler).not.toMatch(/existingLine\.qty\s*\?\?\s*0\)\s*\+\s*Number\(qty\)/);
  });
});
