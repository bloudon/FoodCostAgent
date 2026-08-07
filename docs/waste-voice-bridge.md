# Waste Voice Draft Bridge — Web Team Handoff

Contract between the **FNB Cost Pro mobile app** (native) and the **main application's Waste page** (wrapped in a WebView) for handing off voice-captured waste drafts.

Suggested web-side task: **"Embeddable Waste Module and Voice Draft Bridge"** — see the checklist at the end.

## Ownership boundaries

| Owner | Responsibility |
| --- | --- |
| Native app | Microphone, recording, transcript display, WebView bridge |
| Mobile API | Transcription + spoken-intent extraction ONLY (no catalog/item/unit resolution) |
| Main application (you) | Item/unit/reason resolution, costing, confirmation wizard, submission |

No waste record is ever created by the mobile side. The wrapped Waste wizard is the sole confirmation/correction interface; the user reviews and submits through your existing waste endpoints.

## Embedded page requirements

The native app opens:

```
https://app.fnbcostpro.com/waste?embedded=true&mobileToken=<JWT>
```

- `embedded=true` — hide global chrome (nav, footer) as with the other embedded pages.
- `mobileToken` — short-lived JWT. The native app injects a script that patches `fetch`/XHR to send it as `Authorization: Bearer <token>` on same-page API calls. Your auth guard must accept it the same way the dashboard/count embedded pages do.

### Auth caveats

- **Token in URL**: the token appears in the page URL. Do not log full URLs server-side for this route; strip `mobileToken` from analytics/monitoring.
- **Expiry while open**: the token is short-lived (~5 min). If an API call returns 401 mid-session, surface a clear "session expired" state — the native app shows a Retry that reloads with a fresh token. Do not silently redirect to `/login` (the app detects that redirect as a failure).

## Bridge protocol (version 1)

Transport:

- **Web → native**: `window.ReactNativeWebView.postMessage(JSON.stringify(msg))`
- **Native → web**: the app dispatches a `MessageEvent('message')` whose `data` is the JSON string. **Register listeners on BOTH `window` and `document`** — React Native WebView delivers on `document` on Android and `window` on iOS:

```js
function onMessage(e) { /* parse e.data */ }
window.addEventListener("message", onMessage);
document.addEventListener("message", onMessage); // Android
```

Every message has `type`, `version` (currently `1`), and `requestId`. Responses **must echo the `requestId`** of the draft they refer to.

### Lifecycle

```
Web page loaded
  │ 1. web → native   FNB_WASTE_BRIDGE_READY        (mandatory — native waits for this)
  │ 2. native → web   FNB_WASTE_DRAFT               (storeId + transcript + entries)
  │ 3. web → native   FNB_WASTE_DRAFT_RECEIVED      (ack — handoff successful only now)
  │      … user reviews/corrects/submits in the wizard …
  │ 4. web → native   FNB_WASTE_CREATED             (after successful submission)
  │        or         FNB_WASTE_CANCELLED           (user abandons in the wizard)
  │        or         FNB_WASTE_ERROR               (submission/processing failure)
```

Native rules you can rely on:

- Native holds the draft in memory and **never** puts it in the query string.
- Native sends `FNB_WASTE_DRAFT` only after `FNB_WASTE_BRIDGE_READY` (15 s timeout → error UI).
- Native dedupes per page session: within one live page session, a draft acked with `FNB_WASTE_DRAFT_RECEIVED` is not re-sent. After a page reload/retry, the retained draft IS re-delivered (same `requestId`). **The web side must treat `requestId` as an idempotency key** — ignore or merge a repeated `FNB_WASTE_DRAFT` with a requestId it already processed.
- Native clears the draft **only** on `FNB_WASTE_CREATED` or explicit user cancellation; on error or abandonment the draft is retained for retry.

### Message examples

`FNB_WASTE_BRIDGE_READY` (web → native, on page ready; `requestId` is null here):

```json
{ "type": "FNB_WASTE_BRIDGE_READY", "version": 1, "requestId": null }
```

`FNB_WASTE_DRAFT` (native → web):

```json
{
  "type": "FNB_WASTE_DRAFT",
  "version": 1,
  "requestId": "7f3f7f1e-9f43-4a4b-9a75-0d4a1c2b3d4e",
  "payload": {
    "storeId": "d3a2c9b8-1234-4cde-9f00-aabbccddeeff",
    "transcript": "two pounds of chicken breast spoiled in the walk-in and three burger buns dropped",
    "entries": [
      { "spokenItem": "chicken breast", "wasteType": "inventory", "qty": 2, "spokenUnit": "pounds", "reasonCode": "SPOILED", "notes": "in the walk-in" },
      { "spokenItem": "burger buns", "wasteType": null, "qty": 3, "spokenUnit": null, "reasonCode": "DROPPED", "notes": null }
    ]
  }
}
```

Entry fields: `spokenItem` is always present; `wasteType` (`"inventory" | "menu_item"`), `qty` (positive number), `spokenUnit`, `reasonCode` (`SPOILED | DAMAGED | OVERPRODUCTION | DROPPED | CUSTOMER_COMPLAINT | QUALITY | OTHER`), and `notes` are each **null when not spoken** — the API never invents values. Your wizard resolves items/units and fills gaps. Max 10 entries.

`FNB_WASTE_DRAFT_RECEIVED` (web → native, immediately on receipt):

```json
{ "type": "FNB_WASTE_DRAFT_RECEIVED", "version": 1, "requestId": "7f3f7f1e-9f43-4a4b-9a75-0d4a1c2b3d4e" }
```

`FNB_WASTE_CREATED` (web → native, after the user submits and your API confirms):

```json
{
  "type": "FNB_WASTE_CREATED",
  "version": 1,
  "requestId": "7f3f7f1e-9f43-4a4b-9a75-0d4a1c2b3d4e",
  "payload": { "createdWasteLogIds": ["a1…", "b2…"], "createdCount": 2 }
}
```

`FNB_WASTE_CANCELLED` (web → native, user explicitly abandons the draft in the wizard):

```json
{ "type": "FNB_WASTE_CANCELLED", "version": 1, "requestId": "7f3f7f1e-9f43-4a4b-9a75-0d4a1c2b3d4e" }
```

`FNB_WASTE_ERROR` (web → native, unrecoverable failure; draft is retained natively):

```json
{
  "type": "FNB_WASTE_ERROR",
  "version": 1,
  "requestId": "7f3f7f1e-9f43-4a4b-9a75-0d4a1c2b3d4e",
  "payload": { "code": "SUBMIT_FAILED", "message": "Waste submission was rejected by the server." }
}
```

Suggested `code` values: `SUBMIT_FAILED`, `AUTH_EXPIRED`, `INVALID_DRAFT`, `UNSUPPORTED_VERSION`, `INTERNAL`.

### Versioning

`version` is `1`. If you receive a higher version than you support, reply with `FNB_WASTE_ERROR` + code `UNSUPPORTED_VERSION`. The native app shows an "update the app" message when versions mismatch.

## Mobile API reference (for context — you don't call this)

`POST /api/mobile/voice/waste/interpret` (multipart: `audio` ≤10 MB/60 s or `transcript`, plus `storeId`) → `{ transcript, entries[], transcriptionWarnings[], interpretationWarnings[], model, requestId }`. It validates store access only; it never touches the catalog. Raw audio is transient and deleted after transcription.

## Web-side task checklist ("Embeddable Waste Module and Voice Draft Bridge")

1. **Add `/waste` to the mobile-token route whitelist** (see `embedded-route-whitelist.md` for the full list of routes to unblock). The router currently registers only a small set of routes when authenticated via `mobileToken`; all others render NotFound in embedded mode. Without this, the WebView shows a 404 and the handshake never starts.
2. Make `/waste` render embedded (`embedded=true`): no global nav, accepts `mobileToken` auth like the dashboard/count embedded pages.
3. On page ready, post `FNB_WASTE_BRIDGE_READY`; listen for messages on both `window` and `document`.
4. On `FNB_WASTE_DRAFT`: ack with `FNB_WASTE_DRAFT_RECEIVED`, then prefill the waste wizard — resolve `spokenItem`/`spokenUnit` against the catalog, prompt for anything null, treat `requestId` as an idempotency key.
5. On successful submission through the existing waste endpoints, post `FNB_WASTE_CREATED` with the created IDs; on user abandon, `FNB_WASTE_CANCELLED`; on failure, `FNB_WASTE_ERROR`.
6. Strip `mobileToken` from any URL logging for this route; handle mid-session 401 with an explicit expired state instead of a login redirect.
