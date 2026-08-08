# Changelog

All notable changes to FnB Cost Pro are documented here.

## [1.14.0] — 2026-08-08

### Authentication
- **Continue with Google** — optional Google sign-in added alongside existing email/password login. Existing accounts keep their password, company, role, and store access; Google only links as an additional identity when Google reports a verified email that exactly matches the account email.
- Unknown Google users cannot self-register; invited users follow the existing invitation rules, and a pending invitation never silently changes an existing user's access.
- Google sign-out ends only the FnB session and returns to the login screen (no Google-wide logout).
- Production SSO now uses explicit Google OIDC configuration with a fixed canonical callback (`/api/sso/callback`) — no dependency on Replit identity configuration or request hostname.

### Earlier releases

Changelog entries prior to 1.14.0 were not captured in this file; see Git history for details.
