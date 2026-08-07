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
- **Final evidence:** api-server suite 1112 passed, 1 skipped; same 4 pre-existing unrelated failing files. Mobile typecheck exit 0. The 7 api-server typecheck errors are pre-existing (identical with the change stashed).

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
