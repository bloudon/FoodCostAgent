const EMBEDDED_KEY = "fnb_embedded_mode";

/**
 * Returns true when the app is running inside a native WebView in embedded mode.
 *
 * The WebView loads any page with ?embedded=true once — e.g.
 *   https://app.fnbcostpro.com/inventory-sessions?embedded=true
 *
 * That value is immediately written to sessionStorage so every subsequent
 * SPA navigation (which changes the URL without a full page reload) continues
 * to render in embedded mode without needing the query param again.
 *
 * sessionStorage is scoped to the WebView tab/process and is cleared when
 * the WebView is destroyed, so it can't "leak" into a regular browser session.
 */
export function useEmbedded(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("embedded") === "true") {
    sessionStorage.setItem(EMBEDDED_KEY, "true");
    return true;
  }
  return sessionStorage.getItem(EMBEDDED_KEY) === "true";
}

/** Call once at App boot to seed sessionStorage from the URL. */
export function initEmbedded(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get("embedded") === "true") {
    sessionStorage.setItem(EMBEDDED_KEY, "true");
  }
}
