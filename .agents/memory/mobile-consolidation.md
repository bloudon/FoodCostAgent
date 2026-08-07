---
name: Mobile consolidation constraints
description: Durable architectural constraints for the FnB Cost Pro mobile client and its embedded WebViews
---

- Embedded WebView auth must stay on the `mobileToken` bridge. **Why:** the approved decision requires production evidence before any auth change, and no short-lived web-token exchange exists server-side. **How to apply:** any move to short-lived tokens needs a new approved decision plus a real endpoint.
- Injected WebView scripts may attach the mobile bearer token ONLY to same-origin requests. **Why:** a completion review found the token being forwarded to third-party origins; a sandboxed-VM regression test now enforces the guard.
- All relative mobile count edits (steppers, scans) must use the server's atomic increment (`addQty` dialect) and reconcile the display from the server-returned quantity; absolute writes are reserved for explicit typed direct-set input. **Why:** client-computed absolute sums lose concurrent updates across devices — two completion reviews rejected on this.
- `react-native-webview` stays pinned at 13.15.0. **Why:** 13.17.x collapses WebView prop types to `never` under React 19 types, breaking typecheck.
