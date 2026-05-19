const EMBEDDED_KEY = "fnb_embedded_mode";
const MOBILE_TOKEN_KEY = "fnb_mobile_token";

// ─── Synchronous capture at module load ───────────────────────────────────────
// This runs the instant this module is imported — before React mounts and
// before any useEffect fires. That guarantees the token is in sessionStorage
// by the time checkAuth() calls getMobileToken(), eliminating the race where
// the Expo WebView modifies the URL or the SPA router replaces it before the
// auth check reads it.
(function captureUrlParams() {
  const params = new URLSearchParams(window.location.search);

  const token = params.get("mobileToken");
  if (token) {
    sessionStorage.setItem(MOBILE_TOKEN_KEY, token);
    // Strip from URL so the raw token doesn't linger in browser history or
    // get picked up by analytics / error-reporting tools.
    const clean = new URL(window.location.href);
    clean.searchParams.delete("mobileToken");
    window.history.replaceState({}, "", clean.toString());
  }

  if (params.get("embedded") === "true") {
    sessionStorage.setItem(EMBEDDED_KEY, "true");
  }
})();
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the mobile Bearer token if the page was opened from the Expo WebView.
 * The token is captured synchronously at module load (above) and stored in
 * sessionStorage. All subsequent SPA navigations read it from there.
 */
export function getMobileToken(): string | null {
  return sessionStorage.getItem(MOBILE_TOKEN_KEY);
}

/**
 * Returns true when the app is running inside a native WebView in embedded mode.
 *
 * The WebView loads any page with ?embedded=true once — e.g.
 *   https://app.fnbcostpro.com/inventory-sessions?embedded=true
 *
 * That value is captured synchronously at module load (above) so every
 * subsequent SPA navigation continues to render in embedded mode without
 * needing the query param again.
 *
 * sessionStorage is scoped to the WebView tab/process and is cleared when
 * the WebView is destroyed, so it can't "leak" into a regular browser session.
 */
export function useEmbedded(): boolean {
  return sessionStorage.getItem(EMBEDDED_KEY) === "true";
}

/** @deprecated — capture now happens automatically at module load. */
export function initEmbedded(): void {
  // no-op: kept for any callers that haven't been updated yet
}
