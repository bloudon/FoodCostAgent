# Mobile Dashboard Shortcuts — Web Team Handoff

**Ask:** add the routes below to the main application's mobile-token (embedded-mode) route whitelist so the mobile app's dashboard shortcuts stop showing 404s.

## Problem

The mobile app wraps `https://app.fnbcostpro.com/dashboard/mobile?embedded=true` in a WebView. The Quick Access tiles on that page link to:

| Tile | Target route |
| --- | --- |
| All Sessions | `/inventory-sessions?embedded=true` ✅ works |
| Inventory | `/inventory-items?embedded=true` ❌ 404 |
| Recipes | `/recipes?embedded=true` ❌ 404 |
| Shelf Scans | `/shelf-scans?embedded=true` ❌ 404 |
| Variance | `/tfc/variance?embedded=true` ❌ 404 |
| All Stores | `/stores?embedded=true` ❌ 404 |

The client router registers only a limited route set when the session is authenticated via `mobileToken` (currently: `/`, `/dashboard/mobile`, `/inventory-sessions`, `/new-count`, `/inventory-count`, `/count/:id`, `/count/:id/mobile`, `/item-count/:id`, `/purchase-orders/:id`). Every other path falls through to the NotFound component in embedded mode — even though the pages exist for normal logins. That is why only "All Sessions" works.

## Requested change

Add to the mobile-token/embedded route whitelist:

- `/inventory-items` (plus its subroutes if the page links onward: `/inventory-items/:id`, `/inventory-items/new`, `/inventory-items/par-levels`, `/inventory-items/duplicates`)
- `/recipes` (plus `/recipes/:id`, `/recipes/new`, `/recipes/:id/edit` if reachable from the list)
- `/shelf-scans`
- `/tfc/variance`
- `/stores`
- `/waste` — required for the voice waste handoff; full contract in `waste-voice-bridge.md`

For each route, honor `embedded=true` the same way the dashboard does: no global nav/footer, mobile-friendly layout, `mobileToken` Bearer auth accepted.

## Notes

- The token arrives once via `?mobileToken=` on the first page load; your app already persists it to sessionStorage (`fnb_mobile_token`) and sends it as a Bearer header, so in-app navigation keeps working — no extra auth work needed per page.
- The token is short-lived. On a mid-session 401, show an explicit "session expired" state rather than redirecting to `/login` (the native app treats a `/login` redirect as an auth failure).
- No mobile app release is needed: once the whitelist is deployed, the tiles start working immediately for all users.

## Acceptance

On a phone, each Quick Access tile opens its page inside the app (no 404, no global nav), and links within those pages keep working.
