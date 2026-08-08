# Task #997 Report — Optional Google Sign-In with Release Versioning

**Date:** 2026-08-08 · **Release:** v1.14.0 · **Outcome:** Complete — Reviewer PASS, QA PASS

## What shipped

Optional "Continue with Google" sign-in added alongside existing email/password login, mounted on the canonical `/api/sso/*` routes. Google is an additional authentication method only — FnB Cost Pro remains the owner of users, roles, permissions, companies, stores, and invitations.

## Implementation

- `artifacts/api-server/src/googleAuth.ts` — Google OIDC adapter: discovery, strict claim validation, safe account linking (`upsertGoogleUser`), route handlers for `/api/sso/login`, `/api/sso/callback`, `/api/sso/logout`, `/api/sso/provider`.
- `artifacts/api-server/src/ssoAuth.ts` — provider selection: Google when `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET` + `APP_BASE_URL` are set; Replit OIDC dev fallback otherwise; disabled with a controlled redirect if neither. Replit fallback hardened: missing email now rejected; a pending invitation no longer silently reassigns an existing user.
- `artifacts/api-server/src/config/env.ts` — added `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `APP_BASE_URL` to validated env schema.
- `artifacts/fnb-cost-pro/src/pages/login.tsx` — Google button shown when `/api/sso/provider` reports `google`; existing email/password form and generic SSO button untouched otherwise.
- `artifacts/fnb-cost-pro/src/lib/app-translations.ts` — EN "Continue with Google" / ES "Continuar con Google".

## Account-linking guardrails (verified by tests)

- Email must be present; `email_verified === true` strict boolean (string `"true"`, `false`, absent all rejected).
- Linking only on exact normalized-email match; only provider identity fields (and absent profile fields) may change — password hash, company, role, and store assignments proven untouched.
- No duplicate user is created for a verified matching email.
- Unknown Google users are rejected without a valid matching invitation (no self-registration).
- Existing user + pending invitation → controlled `invitation_conflict` failure; invitation left unresolved for admin action.
- Logout destroys the local FnB session only; no Google-wide logout.

## Production configuration (no secret values)

- `OIDC_ISSUER_URL=https://accounts.google.com` (default), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `APP_BASE_URL=https://app.fnbcostpro.com`, existing `SESSION_SECRET`.
- Fixed canonical callback: `https://app.fnbcostpro.com/api/sso/callback` — derived exclusively from `APP_BASE_URL`; `req.hostname` and `REPL_ID` are never used on the Google path (test-enforced).
- Verified live in Google-simulated mode: `/api/sso/provider` → `{"provider":"google"}`; `/api/sso/login` → 302 to `accounts.google.com` with `redirect_uri=https://app.fnbcostpro.com/api/sso/callback`.

## Startup sequencing

- `artifacts/api-server/src/app.ts` exports async `initApp()`; `index.ts` awaits it before `registerRoutes`/`listen`, so the canonical `/api/sso/*` handlers (including async Google discovery) are fully registered before traffic is served. An SSO discovery/configuration failure is a fatal, logged startup error (`process.exit(1)`), never an unhandled rejection.
- `artifacts/api-server/src/appInit.test.ts` — 3 integration tests: Google-configured init serves `/api/sso/provider` = `google` and `/api/sso/login` 302 with the fixed callback; discovery failure rejects `initApp()`; Replit fallback registers when Google env is absent.

## Tests

- `artifacts/api-server/src/googleAuth.test.ts` — 19 tests, all pass (claim validation, linking preservation, invitation safety, configuration/callback rules).
- Full api-server suite: 1138 passed / 1 skipped; the only 4 failing files (xlsx/pdf parser suites) are pre-existing on baseline HEAD and unchanged (tracked by task #793).
- Typecheck deltas vs. baseline: zero (7 api-server and 19 web errors pre-exist unchanged).
- Regression: `POST /api/auth/login` intact (401 on bad credentials); dev Replit SSO still functions (`provider: replit`, 302 to Replit OIDC).

## Release versioning

- Version 1.14.0 in root, api-server, and fnb-cost-pro `package.json`, and the `App.tsx` version constant (banner/What's-New source).
- `CHANGELOG.md` created at repo root with the 1.14.0 Authentication entry; symlinked at `artifacts/api-server/CHANGELOG.md` so `/api/changelog` serves it.
- `/api/health` returns `version: 1.14.0`; `/api/changelog` returns the 1.14.0 entry (both verified live).

## Independent review results

- **Reviewer (fresh session, independence VERIFIED): PASS.** No blocking findings. Non-blocking notes: Google token-refresh path not wired (sessions degrade gracefully to re-login); pre-existing Replit-fallback session logging; Replit dev logout still uses `req.hostname` (out of scope).
- **QA (fresh session, independence VERIFIED): PASS.** 24/24 acceptance checks with evidence; no new test or typecheck failures vs. baseline.

## Git

- Base: `6fc1b3ad` (initial Google adapter draft). Completion commit contains the canonical-route integration, hardened Replit fallback, env validation, UI, translations, tests, versioning, and this report, committed on local `main`.
- Note: the `gitsafe-backup` remote holds an unrelated legacy (pre-monorepo) history, so a direct push is a non-fast-forward against foreign commits. The work is preserved on local `main` and by platform checkpoints; reconciling or repointing the backup remote needs an explicit decision before any force-push.
