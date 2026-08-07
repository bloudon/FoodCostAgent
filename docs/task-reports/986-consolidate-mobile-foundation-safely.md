# Task #986 — Consolidate the mobile foundation safely

## Asked

Reconcile the historical hybrid Expo app with the Task #981 native proof of concept into one consolidated mobile client: record approved architecture decisions in `replit.md` before implementation, freeze shared contracts, establish the historical-based client foundation, consolidate to one auth provider / SecureStore strategy / token getter / API client / WebView bridge / inventory mutation dialect, preserve review-before-apply, atomic `addQty`, permission enforcement, assigned-store restrictions and resume behavior, verify the 19-flow regression gate, and stop instead of guessing on unverifiable shared contracts.

## Shipped

- Recorded four dated **Approved 2026-08-07** decision entries in `replit.md` (consolidation base, ownership boundaries, embedded-auth blocker, Floor Mode out of scope, deferred cleanup), replacing the stale "Pending Approval" language.
- Merged the historical hybrid client (commit `c90f29cd99ae06ac3a3c004ca7724e9cdfb31b50` of `bloudon/FnB_mobile`) into `artifacts/fnb-cost-pro-mobile` as the approved base: hybrid tab shell (Home/Counts/Recipes/Reports/Waste/More), `context/AuthContext.tsx` single auth provider, `components/WebSection.tsx` mobileToken WebView bridge, `lib/wasteBridge.ts` voice-waste bridge v1, `CatchWeightScanModal`, native camera/voice flows, and English/Spanish i18n.
- Retained #981-only capabilities in place per the deferred-cleanup decision: `app/scan.tsx` (reviewed sweep-scan matching + `/apply-scan`), `app/(tabs)/settings.tsx` (hidden from tab bar via `href: null`), `components/AuthGuard.tsx`, `hooks/useApi.ts`, `hooks/useAuth.tsx`, `lib/api.ts`. `settings.tsx` and `AuthGuard.tsx` were repointed to the consolidated `context/AuthContext` provider; nothing was deleted or quarantined.
- Ported the historical additive extensions to `lib/api-client-react` (`setUnauthorizedHandler` 401 handling and generated sweep/catch-weight schemas) — a strict superset of the current lib.
- Froze the shared contracts by importing `docs/embedded-route-whitelist.md` and `docs/waste-voice-bridge.md` from the historical repo.
- Merged dependencies (i18next, react-i18next, react-native-webview 13.15.0 pinned for TS compatibility, expo-audio ~1.1.1, expo-camera, expo-file-system) into the artifact package.

### Embedded-auth verification evidence (blocker)

An independent read-only audit of `artifacts/api-server` found **no `/api/mobile/auth/web-token` route or short-lived web-session token exchange anywhere in the repo**. The only verifiable contract is the opaque 30-day session token from `POST /api/mobile/login` (`src/routes.ts:24474–24533`), hashed and validated by `requireAuth` (`src/auth.ts`), accepted via cookie or Bearer. Per the approved decision, WebView authentication was **not changed**: the historical `mobileToken` bridge and embedded-route whitelist are preserved verbatim, and the blocker is recorded in `replit.md`.

### Completion-review remediation (post Reviewer/QA)

The external completion review identified two blocking issues, both fixed before completion:

- **Atomic add:** `app/results.tsx` direct apply now sends `{ addQty }` in "add" mode (server-side atomic increment) instead of PATCHing a client-computed absolute count; the bulk `POST /api/mobile/sessions/:id/apply-scan` "add" mode now calls `storage.atomicIncrementCountLineQty` instead of read-then-write arithmetic ("set" mode semantics unchanged).
- **Token scoping:** the injected scripts in `components/WebSection.tsx`, `app/inventory-web.tsx`, and `app/session/count-web.tsx` now attach the mobileToken Authorization header only to same-origin fetch/XHR requests (same guard `app/waste-web.tsx` already had).
- **New regression tests:** `artifacts/api-server/src/lib/mobileWebviewTokenScope.test.ts` executes each wrapper's injected script in a sandboxed VM proving same-origin-only token attachment (8 tests), plus a source invariant that apply-scan "add" uses the atomic increment.

The second completion review flagged that the native manual +/- flow still raced (debounced client-computed absolute `{ count }` writes). Fixed:

- **Native stepper concurrency policy:** `lib/countDeltaQueue.ts` (pure, RN-free) accumulates relative deltas per line, debounces, and flushes a single `{ addQty }` PATCH so the server performs the atomic increment; the display reconciles from the server-returned quantity. `useUpdateItemCount` exposes `addToCount` (used by the `app/session/item.tsx` steppers) and keeps absolute `saveCount` only for explicit typed input — intentional "the shelf holds N" direct-set, last-write-wins. `flushAll` drains both queues (Done button, backgrounding, unmount).
- **Concurrency regression tests:** `artifacts/api-server/src/lib/countDeltaQueue.test.ts` simulates two devices incrementing the same line simultaneously (asserts no lost update: 10+5+5=20, where absolute writes yielded 15), server-truth reconciliation after a foreign increment, tap coalescing, error surfacing, and a source invariant that the item-screen steppers use `addToCount`.
The third completion review flagged the count-list rows' absolute writes. Resolution:

- **Count-list contract:** the list rows' only edit control is a typed text input — an explicit absolute direct-set by design (last write wins). It now flows through `DirectSetQueue` (same pure module), and the list screen passes an `onServerQty` callback so `localCounts` is always reconciled from the server-returned quantity after every save; scanned catch-weight additions already used the atomic `addQty` dialect. `useUpdateItemCount` no longer contains any hand-rolled absolute PATCH path.
- **Behavioral list-flow tests added:** `countDeltaQueue.test.ts` now also covers DirectSetQueue server reconciliation, concurrent-device adds interleaved with a direct-set converging on server truth, typing debounce, error surfacing, plus source invariants that the count-list wires `setLocalCounts` reconciliation and the catch-weight modal uses `addQty` (20 tests total across the two new files).
- **Final evidence:** api-server suite 1119 passed, 1 skipped; same 4 pre-existing unrelated failing files. Mobile typecheck exit 0. The 7 api-server typecheck errors are pre-existing (identical with the change stashed).

## Deviations

- The short-lived web-session token target for embedded pages was NOT implemented — blocked for lack of production/API evidence, exactly as the approved decision requires. Recorded as an open decision in `replit.md`.
- `react-native-webview` pinned to `13.15.0` (13.17.x collapses WebView prop types to `never` under @types/react 19.1.17, breaking typecheck). Version bump is a candidate for a later routine task.

## Review

Reviewer: **PASS WITH FOLLOW-UP** (independent Reviewer workstream `fnb-986-reviewer`; separation VERIFIED)
QA: **PASS WITH FOLLOW-UP** (independent QA workstream `fnb-986-qa`; separation VERIFIED)
Independent session/workstream separation: **VERIFIED** — Reviewer and QA ran as separately instantiated subagent workstreams; the Builder did not self-certify either result.

Reviewer findings (non-blocking): FU-1 apply-scan "add" mode should use `storage.atomicIncrementCountLineQty` instead of read-then-write arithmetic; FU-2 apply the `waste-web.tsx` same-origin guard to `WebSection.tsx`'s injected fetch/XHR intercept; FU-3 comment clarification on bridge version-mismatch handling. No blocking finding; no PM decision required.

QA findings (non-blocking): F1/F2 orphaned `hooks/useAuth.tsx` and `components/AuthGuard.tsx` are dead code (deliberately retained per deferred-cleanup decision); F3 heuristic 5-minute token stale check should be revisited if a web-token endpoint ever ships.

## Tests

- `pnpm --filter @workspace/fnb-cost-pro-mobile run typecheck` — exit 0 (Builder and QA independently).
- `cd artifacts/api-server && pnpm exec vitest run --silent` — 1099 passed, 1 skipped; 4 failed test FILES (`menuInsightsService`, `orderGuideProcessor`, `PdfOrderGuide`, `SalesByItemParser`) — all pre-existing environmental failures (missing pdf-parse subpath export, missing xlsx fixture) unrelated to this task; confirmed identical before and after the change.
- Expo workflow `artifacts/fnb-cost-pro-mobile: expo` restarted and boots cleanly (Metro bundler up, QR served, no bundle errors).
- 19-flow regression gate: 15 flows verified by QA via code/contract inspection and automation (sign-in/out wiring, auth gate redirects, single provider, apply-scan contract, waste bridge lifecycle incl. requestId idempotency, WebView token handoff/whitelist, tab navigation, EN/ES i18n + persistence, 401 expiry handling). 4 flows are device-dependent and NOT VERIFIABLE in this environment: live camera scanning, microphone recording, Expo Go device login, and a live production WebView auth round-trip.

## Risks / Decisions

- Embedded short-lived token remains an open, blocked decision pending production evidence (recorded in `replit.md`).
- Deferred cleanup of historical/#981 duplicate files is a separate approved follow-up after device regression evidence.
- Device-dependent regression flows need a manual pass on real hardware before production reliance.

## Git

Branch: `main`
Base SHA: `a0443c25`
Final SHA: `954b6c96` (implementation; this report is committed immediately after — see `git log --oneline -3` on `main`)
Diff / PR: local commits on `main`; `git diff a0443c25..954b6c96`

---

## Addendum — Task #989: Device-dependent flow verification (2026-08-07)

### Scope

Task #989 was the gate for the 4 flows that QA could not exercise in the workspace during Task #986: live camera scanning (sweep + catch weight), microphone/voice waste recording and bridge handoff, Expo Go device login, and a live WebView mobileToken auth round-trip.

Physical device testing could not be performed from the Replit workspace environment (no attached iOS/Android hardware). The addendum records the result of a thorough **static code inspection** of every code path involved in the 4 flows, in lieu of a live device run. The inspection covers the English and Spanish paths where applicable.

---

### Flow 1 — Live camera scanning (sweep + catch weight)

**Files inspected:** `app/camera.tsx`, `components/CatchWeightScanModal.tsx`, `i18n/locales/en.json`, `i18n/locales/es.json`

| Check | Result |
|---|---|
| `useCameraPermissions` — correct `expo-camera` API | ✅ |
| Permission request: `canAskAgain=true` → "Allow Camera Access" button calls `requestPermission()` | ✅ |
| Permission denied with `canAskAgain=false` → displays text instructing user to enable in device Settings. No `Linking.openSettings()` deep-link — user must navigate manually. | ⚠️ observation only, no crash |
| Sweep: multi-frame capture (max 5), frame strip UI | ✅ |
| Sweep upload: XHR to `/api/mobile/sweep-scan` with Bearer token | ✅ |
| Catch weight: single-frame capture, XHR to `/api/mobile/catch-weight-scan` | ✅ |
| 401 response on either endpoint → `logout()` | ✅ |
| `CatchWeightScanModal` `handleConfirm` sends `{ addQty }` (atomic) not absolute count | ✅ |
| Auto-capture countdown arms only when `visible && autoCapture && permission.granted` | ✅ |
| Double-fire guard (`isCapturingRef`) prevents race on countdown fire | ✅ |
| Confidence auto-apply logic (in `onWeightRead`/sweep-review mode): **high** and **low** → immediately call `onWeightRead(weight)` without showing sheet; **medium** or **null** (AI uncertain) → shows result sheet with editable weight field | ✅ (accurately noted) |
| In direct-confirm mode (no `onWeightRead`): all confidences show result sheet; medium/low weight field is editable | ✅ |
| Haptic feedback on capture and on success | ✅ |
| `camera.*` i18n keys — **English**: 15 keys covering permission UI, library/scan labels, frame hints | ✅ |
| `camera.*` i18n keys — **Spanish**: 15 keys, full parity with English | ✅ |
| `CatchWeightScanModal` result sheet, error messages, button labels — **hard-coded English** (no i18n keys used) | ⚠️ observation, not blocking |

**Observation:** The sweep flow in `app/camera.tsx` and the embedded sweep flow in `app/scan.tsx` are separate code paths. `app/camera.tsx` (the primary historical sweep screen) uses `CameraView` from `expo-camera` directly; `app/scan.tsx` (the retained #981 path) uses `expo-image-picker`. Both attach Bearer auth headers and route to `mode: 'add'` on apply. No defects found.

**Physical device status:** PENDING — requires a device with a rear camera running Expo Go or a dev build against a live API.

---

### Flow 2 — Microphone / voice waste recording and bridge handoff

**Files inspected:** `app/voice-waste.tsx`, `app/waste-web.tsx`, `lib/wasteBridge.ts`

| Check | Result |
|---|---|
| `AudioModule.requestRecordingPermissionsAsync()` before recording | ✅ |
| `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })` before record | ✅ |
| `RecordingPresets.HIGH_QUALITY` preset used | ✅ |
| 60 s auto-stop via `durationSeconds >= MAX_RECORDING_SECONDS` effect | ✅ |
| Multipart POST to `/api/mobile/voice/waste/interpret` with `storeId`, `durationSeconds`, audio blob | ✅ |
| `setWasteDraft()` called with `requestId`, `storeId`, `transcript`, `entries` before navigating | ✅ |
| `waste-web.tsx` loads token → WebView URL `?mobileToken=...&embedded=true` | ✅ |
| Injected script: same-origin-only Bearer header on fetch + XHR | ✅ |
| Bridge handshake: `FNB_WASTE_BRIDGE_READY` → `sendDraft()` → `FNB_WASTE_DRAFT_RECEIVED` | ✅ |
| Ready timeout 15 s, ack timeout 10 s — both surface recoverable error, draft retained | ✅ |
| Session-scoped dedupe (`ackedRequestIdThisSession`) — draft re-sent after page reload, web side dedupes by `requestId` | ✅ |
| `FNB_WASTE_CREATED` — draft cleared, Alert shown, `router.back()` | ✅ |
| `FNB_WASTE_CANCELLED` — draft cleared, `router.back()` | ✅ |
| `FNB_WASTE_ERROR` — draft retained, error message surfaced, retry available | ✅ |
| Version mismatch check on every incoming message | ✅ |
| Leave guard: Alert with "Keep draft & leave" / "Discard draft" / "Stay" | ✅ |
| `parseWebMessage` strictly validates all incoming message shapes; malformed messages return `null` | ✅ |
| `voice-waste.tsx` user-facing strings (mic permission error, recording error, server error, state labels, button labels) — **hard-coded English** (no i18n keys) | ⚠️ observation, not blocking |
| `waste-web.tsx` loading/error/bridge-status copy — **hard-coded English** (no i18n keys) | ⚠️ observation, not blocking |

**Physical device status:** PENDING — requires a device with a microphone and live connectivity to `/api/mobile/voice/waste/interpret`.

---

### Flow 3 — Expo Go device login

**Files inspected:** `app/login.tsx`, `context/AuthContext.tsx`, `i18n/locales/en.json`, `i18n/locales/es.json`

| Check | Result |
|---|---|
| Email + password validation before network call | ✅ |
| Show/hide password toggle (eye icon) | ✅ |
| `POST /api/mobile/login` (production) / `/mobile/dev-login` (dev with `EXPO_PUBLIC_DOMAIN`) | ✅ |
| Error message extracted from `data.message` / `data.error` on non-200 | ✅ |
| Token stored in `SecureStore` (native) / `localStorage` (web) — correct platform branch | ✅ |
| User object stored alongside token | ✅ |
| Post-login `GET /api/auth/me` for preferred language — skipped when `AUTH_BASE !== PROD_BASE` | ✅ |
| Language applied to `i18n` and persisted to `SecureStore` | ✅ |
| `setAuthTokenGetter` wired on mount; 401 handler calls `secureDelete` + resets state | ✅ |
| Hydration on boot: both `storedToken` and `storedUser` required; falls back to logged-out | ✅ |
| `login.*` i18n keys — **English**: 11 keys, all form labels / error strings present | ✅ |
| `login.*` i18n keys — **Spanish**: 11 keys, full parity | ✅ |

**Physical device status:** PENDING — requires Expo Go (or dev build) on a real iOS/Android device with live connectivity to `https://app.fnbcostpro.com/api/mobile/login`.

---

### Flow 4 — Live WebView mobileToken auth round-trip

**Files inspected:** `components/WebSection.tsx`, `app/inventory-web.tsx` (spot-checked), `app/session/count-web.tsx` (spot-checked)

| Check | Result |
|---|---|
| Token fetched via `getToken()` on each `useFocusEffect` load (or when >5 min stale) | ✅ |
| URL built as `https://app.fnbcostpro.com<path>?embedded=true&mobileToken=<token>` | ✅ |
| `injectedJavaScriptBeforeContentLoaded` fires before page JS — token available at page load | ✅ |
| Token persisted to `sessionStorage` for in-page navigation (survives client-side route changes) | ✅ |
| Same-origin guard: `sameOrigin(url)` checked before attaching Bearer header to fetch/XHR | ✅ |
| Console + error forwarding to RN log via `window.ReactNativeWebView.postMessage` | ✅ |
| Auth redirect detection: `url.includes("fnbcostpro.com/login")` stops WebView, shows retry UI | ✅ |
| Android hardware back button handled via `BackHandler` → `goBack()` in WebView or pop stack | ✅ |
| Token/page/auth error states all have retry paths (`loadToken()`) | ✅ |

**Known limitation (pre-existing, recorded in `replit.md`):** No `/api/mobile/auth/web-token` endpoint exists in the codebase. The mobileToken injected into the WebView is the same opaque 30-day bearer token issued by `POST /api/mobile/login`. Whether `app.fnbcostpro.com` accepts this token for its embedded-page auth guard can only be verified on a live device against the deployed web app.

**Physical device status:** PENDING — requires live device and a deployed `app.fnbcostpro.com` that accepts the mobileToken bearer token for embedded pages.

---

### i18n coverage summary

The `camera.*` and `login.*` locale keys (15 and 11 keys respectively) are fully translated in both `en.json` and `es.json` and are correctly used in `app/camera.tsx` and `app/login.tsx`.

**The following screens have user-facing strings hard-coded in English and are not covered by the locale files:**

- `components/CatchWeightScanModal.tsx` — result sheet labels, error messages, button labels ("Camera Access Required", "Allow Camera", "Weight Applied", "Scan Failed", "Confirm Weight", "Apply Weight", "Discard", "Try Again", etc.)
- `app/voice-waste.tsx` — permission error, recording error, server error, state labels ("Listening…", "Transcribing…", "Interpreting…", "Ready to open"), action buttons ("Transcribe recording", "Open Waste Entry", "Retry", "Cancel")
- `app/waste-web.tsx` — loading/error/bridge-status copy ("Connecting to Waste Entry…", "Handing off your voice draft…", "Handoff problem", "Leave Waste Entry?", etc.)

These are observations, not regressions introduced by Task #986 (the historical base predates i18n in these screens). They do not block the device verification gate but should be tracked as a separate localization task.

---

### Summary

The code-path inspection found no defects that would cause runtime failures in the 4 device-dependent flows. The logic for permissions, auth token delivery, atomic count writes, waste bridge handshake, and session-scoped dedupe is correctly implemented. Two observations are noted above: the missing `Linking.openSettings()` deep-link on permanent camera denial (by-design text-only instruction), and the hard-coded English strings in `CatchWeightScanModal`, `voice-waste`, and `waste-web` (pre-existing localization gap).

**Physical device verification is the remaining open gate** (Task #991). This addendum records workspace-level code-path evidence only; it does not substitute for a live hardware pass. A developer with Expo Go on a real iOS or Android device against the production API must execute the 4 flows in English and Spanish, then append a second addendum confirming pass or listing failures to file.

The deferred cleanup of retained #981 duplicate files (Task #992) remains gated on that physical device pass.

| Flow | Code-path inspection | Physical device |
|---|---|---|
| Camera sweep scan | ✅ no defects | ⏳ PENDING (Task #991) |
| Camera catch-weight scan | ✅ no defects | ⏳ PENDING (Task #991) |
| Voice waste + bridge handoff | ✅ no defects | ⏳ PENDING (Task #991) |
| Expo Go device login | ✅ no defects | ⏳ PENDING (Task #991) |
| WebView mobileToken round-trip | ✅ no defects (token acceptance by deployed web app unverifiable without live device) | ⏳ PENDING (Task #991) |
| EN/ES i18n — camera + login screens | ✅ fully covered | — |
| EN/ES i18n — CatchWeightScanModal, voice-waste, waste-web | ⚠️ hard-coded English (pre-existing gap) | — |
