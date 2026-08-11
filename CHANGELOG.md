# Changelog

All notable changes to FnB Cost Pro are documented here.

## [1.15.0] — 2026-08-11

### Responsive Web / Mobile UX
- Reworked the authenticated responsive shell for phone widths from 320px through 430px.
- Removed the mobile blank gutter and document-level horizontal overflow.
- Added compact mobile utility-bar behavior while preserving access to search, store, account, theme, language, and logout controls.
- Confirmed mobile navigation opens as an overlay without shifting page content.
- Added safe-area-aware viewport and footer behavior.
- Updated the Menus mobile empty state so Create Menu is the primary action and Catalog / Scan remain secondary without duplicate header actions.

## [1.14.0] — 2026-08-08

### Authentication
- **Continue with Google** — optional Google sign-in added alongside existing email/password login. Existing accounts keep their password, company, role, and store access; Google only links as an additional identity when Google reports a verified email that exactly matches the account email.
- Unknown Google users cannot self-register; invited users follow the existing invitation rules, and a pending invitation never silently changes an existing user's access.
- Google sign-out ends only the FnB session and returns to the login screen (no Google-wide logout).
- Production SSO now uses explicit Google OIDC configuration with a fixed canonical callback (`/api/sso/callback`) — no dependency on Replit identity configuration or request hostname.

### Earlier releases

Changelog entries prior to 1.14.0 were not captured in this file; see Git history for details.
