// @vitest-environment jsdom
/**
 * Unit tests for the unauthorized handler registered by AuthProvider.
 *
 * Imports the real AuthProvider from context/AuthContext.tsx.  All native
 * Expo / React-Native dependencies are replaced with vi.mock() factories so
 * the suite runs in a jsdom environment without a physical device or
 * the Metro bundler.
 *
 * Contract under test:
 *   1. AuthProvider registers exactly one handler via setUnauthorizedHandler.
 *   2. When the handler receives { reauthenticate: true } it:
 *        a) deletes BOTH SecureStore keys (fnb_auth_token, fnb_auth_user)
 *        b) calls router.replace("/login?reason=session_expired")
 *   3. For every other 401 payload (plain error, reauthenticate:false, null,
 *      undefined, non-object) it deletes stored tokens but does NOT call
 *      router.replace — the AuthGate redirect handles those cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mock native / Expo modules BEFORE importing the module under test.
// vi.mock() calls are hoisted by vitest; factories are evaluated lazily on
// first import of the mocked module, so all native internals are replaced
// before AuthContext.tsx is ever loaded.
// ---------------------------------------------------------------------------

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("expo-router", () => ({
  router: { replace: vi.fn() },
}));

// Keep Platform.OS on native so the SecureStore branch is exercised
// (not the localStorage branch), matching real device behaviour.
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("@workspace/api-client-react", () => ({
  setUnauthorizedHandler: vi.fn(),
  setAuthTokenGetter: vi.fn(),
}));

vi.mock("@/i18n", () => ({
  default: { changeLanguage: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import the real module under test and mocked helpers for assertions.
// Imports are resolved AFTER the vi.mock() calls above take effect.
// ---------------------------------------------------------------------------

import { AuthProvider } from "../context/AuthContext";
import * as expoRouter from "expo-router";
import * as SecureStore from "expo-secure-store";
import { setUnauthorizedHandler } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Helper: render AuthProvider and return the actual handler that was
// registered with setUnauthorizedHandler during the mount useEffect.
// ---------------------------------------------------------------------------

async function mountAndGetHandler(): Promise<(data?: unknown) => Promise<void>> {
  await act(async () => {
    render(
      <AuthProvider>
        <div data-testid="child" />
      </AuthProvider>,
    );
  });

  const mockFn = vi.mocked(setUnauthorizedHandler);
  // The useEffect runs synchronously in act(); handler must be registered.
  expect(mockFn).toHaveBeenCalled();
  const registeredHandler = mockFn.mock.calls[0][0];
  expect(typeof registeredHandler).toBe("function");
  return registeredHandler as (data?: unknown) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthProvider — setUnauthorizedHandler registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers exactly one handler with setUnauthorizedHandler on mount", async () => {
    await mountAndGetHandler();
    expect(vi.mocked(setUnauthorizedHandler)).toHaveBeenCalledOnce();
  });
});

describe("AuthProvider — unauthorized handler: reauthenticate:true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls router.replace with /login?reason=session_expired", async () => {
    const handler = await mountAndGetHandler();

    await act(async () => {
      await handler({ reauthenticate: true, error: "Google token revoked" });
    });

    expect(vi.mocked(expoRouter.router.replace)).toHaveBeenCalledOnce();
    expect(vi.mocked(expoRouter.router.replace)).toHaveBeenCalledWith(
      "/login?reason=session_expired",
    );
  });

  it("deletes both SecureStore token keys before navigating", async () => {
    const handler = await mountAndGetHandler();
    const deleteSpy = vi.mocked(SecureStore.deleteItemAsync);

    await act(async () => {
      await handler({ reauthenticate: true });
    });

    const deletedKeys = deleteSpy.mock.calls.map((c) => c[0]);
    expect(deletedKeys).toContain("fnb_auth_token");
    expect(deletedKeys).toContain("fnb_auth_user");
    expect(deleteSpy).toHaveBeenCalledTimes(2);
  });

  it("deletes tokens BEFORE calling router.replace (correct ordering)", async () => {
    const callOrder: string[] = [];
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async () => {
      callOrder.push("deleteItemAsync");
    });
    vi.mocked(expoRouter.router.replace).mockImplementation(() => {
      callOrder.push("router.replace");
    });

    const handler = await mountAndGetHandler();

    await act(async () => {
      await handler({ reauthenticate: true });
    });

    expect(callOrder).toContain("deleteItemAsync");
    expect(callOrder).toContain("router.replace");
    // Both deletes happen (via Promise.all) before the navigate
    expect(callOrder.indexOf("router.replace")).toBeGreaterThan(
      callOrder.indexOf("deleteItemAsync"),
    );
  });
});

describe("AuthProvider — unauthorized handler: plain 401 (no reauthenticate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT call router.replace for a plain 401 without reauthenticate", async () => {
    const handler = await mountAndGetHandler();

    await act(async () => {
      await handler({ error: "Unauthorized" });
    });

    expect(vi.mocked(expoRouter.router.replace)).not.toHaveBeenCalled();
  });

  it("does NOT call router.replace when reauthenticate is false", async () => {
    const handler = await mountAndGetHandler();

    await act(async () => {
      await handler({ reauthenticate: false });
    });

    expect(vi.mocked(expoRouter.router.replace)).not.toHaveBeenCalled();
  });

  it("does NOT call router.replace when data is null (empty 401 body)", async () => {
    const handler = await mountAndGetHandler();

    await act(async () => {
      await handler(null);
    });

    expect(vi.mocked(expoRouter.router.replace)).not.toHaveBeenCalled();
  });

  it("does NOT call router.replace when data is undefined", async () => {
    const handler = await mountAndGetHandler();

    await act(async () => {
      await handler(undefined);
    });

    expect(vi.mocked(expoRouter.router.replace)).not.toHaveBeenCalled();
  });

  it("does NOT call router.replace for a non-object data (plain-text body)", async () => {
    const handler = await mountAndGetHandler();

    await act(async () => {
      await handler("Unauthorized");
    });

    expect(vi.mocked(expoRouter.router.replace)).not.toHaveBeenCalled();
  });

  it("still deletes stored tokens even without reauthenticate flag", async () => {
    const handler = await mountAndGetHandler();
    const deleteSpy = vi.mocked(SecureStore.deleteItemAsync);

    await act(async () => {
      await handler({ error: "Session ended" });
    });

    // Tokens must always be cleared on any 401
    expect(deleteSpy).toHaveBeenCalledTimes(2);
  });
});
