# FnB Cost Pro Mobile Architecture Reconciliation

**Status:** Decision recommendation — pending user approval  
**Prepared:** 2026-08-07  
**Scope:** Architecture discovery only. This report does not approve or perform a migration, deletion, quarantine, API change, WebView contract change, or Floor Mode product decision.

## 1. Executive summary

FnB Cost Pro currently has two Expo mobile clients:

1. **Historical hybrid implementation** — `https://github.com/bloudon/FnB_mobile.git`, implementation baseline `c90f29cd99ae06ac3a3c004ca7724e9cdfb31b50`.
2. **Current Task #981 proof of concept** — `artifacts/fnb-cost-pro-mobile` in this workspace.

The historical client is the recommended functional migration base. It contains the established hybrid shell, SecureStore-backed native authentication, the `mobileToken` WebView handoff, embedded operational pages, native sweep and catch-weight scanning, voice-waste capture, the v1 waste bridge, localization, and shared brand assets. The current proof of concept contributes a simpler native Floor Mode flow for assigned-store count creation, manual line editing, and explicit scan-result review before writes.

**Recommendation:** create one consolidated Expo application based primarily on the historical hybrid client. Retain native, device-first workflows and selectively incorporate the #981 count/session/scan screens only after their API DTOs and UX are normalized. Do not retain two separate authentication systems, API client layers, embedded-route implementations, or voice-bridge dialects.

This conclusion is an architecture recommendation, **not an approved consolidation decision**.

## 2. Sources and commits reviewed

| Source | Reference | Purpose |
|---|---|---|
| Historical repository | `https://github.com/bloudon/FnB_mobile.git` | Existing mobile client |
| Historical implementation baseline | `c90f29cd99ae06ac3a3c004ca7724e9cdfb31b50` | File and workflow inventory |
| Historical architecture handoff | `d3d3ff83ebfe74c8da176e86b0ef4463a6455f82` | `MOBILE_ARCHITECTURE.md` |
| Historical contract | `docs/waste-voice-bridge.md` | Voice-waste WebView bridge v1 |
| Historical contract | `docs/embedded-route-whitelist.md` | Mobile-token embedded route requirements |
| Current mobile app | `artifacts/fnb-cost-pro-mobile` | Task #981 proof of concept |
| Current API | `artifacts/api-server/src/routes.ts`, `src/auth.ts` | Mobile routes and bearer authentication |

The main production web application remains a separate VPS codebase. Its embedded-mode implementation was assessed only through the historical contracts, not modified or independently verified here.

## 3. Historical application inventory

| Capability | Evidence | Implementation status |
|---|---|---|
| Native login and secure credential storage | `context/AuthContext.tsx`; architecture handoff §§4, 6 | Implemented |
| Native navigation chrome | `app/_layout.tsx`, `app/(tabs)/_layout.tsx` | Implemented |
| Embedded dashboard and counts | `app/(tabs)/index.tsx`, `app/(tabs)/counts.tsx`, `components/WebSection.tsx` | Implemented |
| Embedded recipes, reports, waste, inventory items, shelf scans, stores | `app/(tabs)/recipes.tsx`, `reports.tsx`, `waste.tsx`, `web-section.tsx` | Implemented, subject to web whitelist |
| Native session browsing and scan result review | `app/session/*`, `app/camera.tsx`, `app/results.tsx` | Implemented |
| Native catch-weight scanning with atomic increment | `components/CatchWeightScanModal.tsx`, `PATCH /api/mobile/sessions/:id/lines/:lineId` with `addQty` | Implemented |
| Voice waste capture and handoff | `app/voice-waste.tsx`, `app/waste-web.tsx`, `lib/wasteBridge.ts` | Native/API implemented; web acceptance contract pending |
| WebView token handoff | `components/WebSection.tsx`, `app/session/count-web.tsx` | Implemented; security hardening remains required |
| English and Spanish | `i18n/index.ts`, `i18n/locales/en.json`, `i18n/locales/es.json` | Implemented |
| Shared identity assets | `assets/images/fnb-logo.png`, `constants/colors.ts`, `hooks/useColors.ts` | Implemented |
| Automated mobile coverage | Architecture handoff §16 | Not found; only voice-normalization unit coverage exists |

The active historical pattern is **native chrome and device capture + embedded management and web workflow pages**. Its legacy native count editor and duplicate inventory wrapper should not become a second target implementation.

## 4. Task #981 proof-of-concept inventory

| Capability | Evidence | Status |
|---|---|---|
| Native login, route guard, and SecureStore token | `app/login.tsx`, `hooks/useAuth.tsx`, `components/AuthGuard.tsx`, `lib/api.ts` | Implemented |
| Native dashboard and active-session list | `app/(tabs)/index.tsx`, `hooks/useApi.ts` | Implemented |
| Assigned-store count creation | `GET /api/mobile/stores`, `POST /api/mobile/sessions`; `app/(tabs)/index.tsx` | Implemented |
| Manual count-line editing | `app/session/[id].tsx`, `PATCH /api/mobile/sessions/:id/lines/:lineId` | Implemented |
| Sweep scan with mandatory review before apply | `app/scan.tsx`, `/api/mobile/sweep-scan`, `/apply-scan` | Implemented |
| Settings and sign-out | `app/(tabs)/settings.tsx` | Basic implementation |
| Embedded WebView pages and `mobileToken` bridge | Project-wide search | Not present |
| Voice waste / waste bridge | Project-wide search | Not present |
| Catch-weight scanning | Project-wide search | Not present |
| Localization | Project-wide search | Not present |
| Mobile tests | Project-wide search | Not present |

Task #981 initially duplicated authentication and count flows with incorrect/unsafe gaps. Its completion work corrected the count-line route, required assigned-store selection, review-before-apply scan flow, and token storage using `expo-secure-store`. It remains a narrower proof of concept than the historical app.

## 5. Capability comparison

| Area | Historical client | #981 client | Recommendation |
|---|---|---|---|
| Authentication | SecureStore; established mobile auth conventions | SecureStore token, separate context/client | Preserve one native SecureStore auth implementation; reconcile to historical key and API conventions |
| Dashboard | Embedded `/dashboard/mobile` | Native summary and active-session list | Keep native shell option; decide dashboard ownership during consolidation |
| Count list and entry | Embedded primary path; native browsing; legacy native editor exists | Native store selection, sessions, line edit | Merge #981’s assigned-store UX only after schema/DTO contract alignment |
| Sweep scan | Native capture, review, apply | Native capture, review, apply | Merge carefully; preserve historical multi-frame/camera capabilities |
| Catch weight | Native and atomic `addQty` flow | Missing | Retain historical implementation |
| Voice waste | Native capture + v1 bridge to embedded Waste | Missing | Retain historical implementation and contract |
| Reports, recipes, items, stores | Embedded WebView | Missing | Retain embedded ownership initially |
| WebView route contract | `mobileToken`, session storage, whitelist | Missing | Retain as baseline; do not recreate a new dialect |
| i18n | English and Spanish | English hard-coded | Retain historical i18n |
| Brand assets | Logo and shared palette | Basic local icon/colors | Merge historical assets and reconcile to current web visual tokens |

## 6. Authentication and API-client comparison

### Historical baseline

- Native credential storage uses the established `fnb_auth_token` key in SecureStore.
- Embedded pages receive `mobileToken` on initial load, store it in web session storage, and attach a bearer header to page API requests.
- `GET /api/mobile/auth/web-token` is documented as a short-lived token option but was not adopted by the historical client.
- `WebSection.tsx` is mature but needs same-origin-only header injection before broader reuse.

### #981 implementation

- Native credential storage uses SecureStore with `fnb_auth_token` in `hooks/useAuth.tsx` and `lib/api.ts`.
- The local `fetchWithAuth` client reads the token per request and applies `Authorization: Bearer`.
- `hooks/useApi.ts` introduces an independent, local React Query API layer.
- There is no `mobileToken` WebView handoff, session-storage convention, embedded route registry, or short-lived embedded session strategy.

### Recommended target

1. Preserve the established native SecureStore key and bearer authentication model.
2. Adopt **one** shared mobile API client/token getter; remove duplicate per-app fetch layers only in a separately approved consolidation task.
3. Treat the historical `mobileToken` bridge, the `fnbMobileToken` web session-storage convention, and the web whitelist as the current baseline.
4. Before implementation, jointly decide whether the long-lived login token in WebView URLs must be replaced by a short-lived web-session token. This is a security decision requiring the web-side owner.
5. Do not change the production login contract from this workspace without verifying the VPS implementation.

## 7. Native-versus-embedded ownership matrix

| Workflow | Recommended owner | Notes |
|---|---|---|
| Authentication | Native | SecureStore token; one provider and one client strategy |
| App shell, tabs, navigation | Native | Device-first navigation |
| Home/dashboard | Transitional: embedded historical page, with native #981 dashboard evaluated for merge | No second dashboard should remain long-term |
| Assigned store/company context | Native selector + API-provided scope | Keep company, store/property, operating unit/outlet, and storage location distinct |
| Inventory session browsing | Transitional: embedded primary route with native scan support | Consolidation decides final native list/detail UX |
| Manual count entry | Embedded initially; #981 native editor is a merge candidate | Historical legacy native count editor is not the target |
| Sweep and shelf scanning | Native | Require review and explicit apply |
| Catch weight | Native | Preserve atomic `addQty` server contract |
| Voice waste capture | Native | Capture/transcribe only |
| Waste resolution and submission | Embedded | Web wizard remains source of truth for catalog/unit/reason/costing confirmation |
| Recipes, menus, vendors, reports, billing, complex settings | Embedded | Management workflows; label as transitional where a native alternative is later approved |
| Notifications and retry queues | Native infrastructure, not yet implemented | Design later; do not add as part of reconciliation |

## 8. Contract baseline

### Waste voice bridge v1

Treat the historical `docs/waste-voice-bridge.md` as the authoritative baseline:

- Native owns capture, transcript display, and bridge transport.
- Mobile API owns transcription and spoken-intent extraction only.
- The web Waste wizard owns catalog/unit/reason resolution, costing, confirmation, and write submission.
- The required lifecycle is `FNB_WASTE_BRIDGE_READY` → `FNB_WASTE_DRAFT` → `FNB_WASTE_DRAFT_RECEIVED` → terminal created/cancelled/error message.
- Version remains `1`; `requestId` is the idempotency key.

Any contract change requires a separate approved architecture decision. This task does not approve a change.

### Embedded-route whitelist

Treat `docs/embedded-route-whitelist.md` as the baseline for the web owner. The historical embedded client needs mobile-token support and embedded treatment for dashboard, inventory sessions/items, recipes, shelf scans, variance, stores, and waste. A route must not be worked around from mobile if the web app has not whitelisted it.

## 9. Duplicate-component disposition table

| Capability | Historical implementation | #981 implementation | Recommended source | Disposition | Rationale | Risk |
|---|---|---|---|---|---|---|
| Auth storage/provider | `context/AuthContext.tsx` | `hooks/useAuth.tsx` | Historical conventions + #981 SecureStore correction | Merge | Same native secure-storage goal, but one provider/key/client only | Session loss or duplicate token semantics |
| Authenticated API client | Shared token getter / historical request paths | `lib/api.ts`, `hooks/useApi.ts` | One shared generated or common client | Replace later | Avoid parallel transport/auth handling | Inconsistent 401 and token behavior |
| Home dashboard | Embedded `dashboard/mobile` | Native `app/(tabs)/index.tsx` | Pending UX decision | Investigate | #981 offers Floor Mode utility; history offers broad web parity | Duplicate dashboards and inconsistent data |
| Session listing/count creation | Embedded Counts + native scan picker | Native assigned-store session creation | Merge | #981’s store picker is a useful native Floor Mode capability | Store/property scope confusion |
| Manual count edit | Historical embedded active path; legacy native editor | Native `session/[id].tsx` | Embedded initially, #981 candidate later | Replace later | Do not revive historical legacy editor; test #981 against complete count UX | Different line DTO names and count semantics |
| Sweep scan / results apply | `camera.tsx` + `results.tsx` | `scan.tsx` | Historical capture + shared reviewed apply contract | Merge | Both protect writes via review; historical is more mature | Double counting or mismatched line identifiers |
| Catch-weight scan | `CatchWeightScanModal.tsx` | None | Historical | Keep historical | Device-native capability with atomic `addQty` | Loss of critical workflow |
| WebView wrapper | `components/WebSection.tsx` | None | Historical, security-hardened | Keep historical | Established bridge/navigation/error handling | Broad bearer-header injection needs hardening |
| Voice waste bridge | `lib/wasteBridge.ts`, `waste-web.tsx` | None | Historical | Keep historical | Versioned web-team contract | Breaking an external web dependency |
| Waste web page | Embedded `/waste` | None | Historical | Keep historical | Web owns final resolution/submission | Embedded whitelist dependency |
| i18n | `i18n/*` | None | Historical | Keep historical | Existing Spanish support | Partial localization |
| Colors/assets | logo + local tokens | icon + local tokens | Merge carefully | Merge | Preserve brand assets and align to current web | Visual drift |
| Settings | Native language/backend/account screen | Basic sign-out settings | Historical | Merge | Historical is more complete | Different backend configuration expectations |

## 10. One-sided functionality

### Historical only

- Catch-weight scanning.
- Voice waste capture and v1 handoff bridge.
- WebView shell, embedded management modules, URL-token lifecycle, and error/back handling.
- English and Spanish translations.
- More menu and broader native settings.
- Production web-app integration knowledge and whitelist documentation.

### #981 only

- Simpler native Floor Mode dashboard with active-session cards.
- Required assigned-store selector for session creation.
- Local native manual count-line editor using the corrected `lines/:lineId` endpoint.
- Explicit editable scan match selection before `/apply-scan`.

## 11. Recommended authoritative client

**Recommendation: Historical app as the migration base, with selected #981 components merged deliberately.**

Why:

- It provides significantly wider functional coverage and existing real-device workflow evidence.
- It already contains the shared contracts that the production web app expects: `mobileToken`, embedded routes, and voice-waste bridge v1.
- It retains native workflows where device capabilities matter: camera capture, catch weight, and voice.
- #981 has valuable but narrow improvements, and it has already shown integration defects that required post-review correction.

The future deliverable should be **one consolidated Expo application**, not the historical client plus a continuing #981 parallel app.

## 12. Floor Mode recommendation

**Recommendation: shared shell with role-based modes — pending product approval.**

### Evidence

- #981’s login describes itself as a “Floor inventory companion,” and its design focuses on assigned-store sessions, count lines, camera review, and simple native navigation.
- The historical app has on-floor capabilities but is also a broad hybrid management companion.
- No Floor Mode references were found in the historical repository, so no direct code-level evidence confirms whether it is commercially separate.

### Assumptions

- Floor Mode serves an overlapping user base and shares company/store inventory data with FnB Cost Pro.
- A single device shell can offer a focused default experience for floor staff while exposing broader pages according to role.

### Missing information

- Whether Floor Mode has separate pricing, branding, support, or device deployment requirements.
- Whether it must work offline independently of the broader FnB Cost Pro app.
- Whether a separate Floor Mode app already has a customer-facing release commitment.

The user must approve or revise this recommendation; it is not recorded as a final product decision.

## 13. Security and migration risks

1. **URL token exposure:** historical embedded pages append `mobileToken` to URLs. Logs, analytics, and history must strip it; decide whether to use short-lived web-session tokens.
2. **WebView header scope:** historical wrappers include older broad Authorization injection. Consolidation must use same-origin-only injection.
3. **Duplicate auth/API paths:** two contexts and client strategies risk mismatched logout, refresh, and error handling.
4. **Count-line DTO mismatch:** `id` versus `lineId`, `quantity` versus `qty`, and `name` versus `itemName` must be normalized before merging native count screens.
5. **Scan mutation safety:** preserve review-before-apply and atomic add semantics. Never auto-apply AI name matches.
6. **Company/store/storage vocabulary:** preserve distinct company, store/property, operating unit/outlet, and storage-location context; do not reuse “location” ambiguously.
7. **Voice bridge dependency:** web-side support is contractual and must be deployed before voice can complete a waste record.
8. **No mobile flow tests:** add contract and UI coverage before deleting a legacy route.

## 14. Proposed consolidation sequence

1. Obtain user approval of the authoritative client, Floor Mode direction, and embedded-token decision.
2. Freeze and test API DTOs for login, assigned stores, sessions, count lines, sweep scan, apply scan, catch weight, and voice interpretation.
3. Move the historical hybrid client into the authoritative artifact location, preserving assets, i18n, native capture flows, and bridge contracts.
4. Consolidate native auth and API transport into a single implementation. Migrate #981’s SecureStore changes and remove any obsolete token storage only after a sign-in regression test.
5. Merge selected #981 native Floor Mode screens: assigned-store count start, simple session list, manual line edit, and reviewed scan matching.
6. Harden `WebSection` to same-origin bearer injection and implement the approved short-lived embedded-session strategy.
7. Reconfirm each embedded route against the web whitelist and bridge contracts.
8. Remove legacy/duplicated screens only after flow-level tests prove each replacement works.

## 15. Decisions requiring user approval

1. Approve the historical hybrid app as the consolidation base.
2. Approve, reject, or revise the shared role-based shell recommendation for Floor Mode.
3. Decide whether embedded WebViews must move from a long-lived login token to a short-lived session token.
4. Confirm which management workflows may remain embedded during the transition.
5. Approve the future consolidation scope and deletion plan after tests are defined.

## 16. Proposed `replit.md` records

See the draft entries added to `replit.md`. They are marked **pending approval** and must not be treated as implementation authorization.