---
name: Google OIDC product decision
description: Approved production SSO provider and non-negotiable account-linking safeguards.
---

Google Identity is the approved replacement production OIDC provider for Replit-managed SSO. FnB Cost Pro must retain email/password login and all application-owned users, sessions, companies, stores, roles, permissions, invitations, and authorization. Google is an additional identity method, not an authorization source.

**Why:** Product Management approved Google while explicitly rejecting an identity broker and requiring continuity for existing non-Google users.

**How to apply:** Production Google OIDC must use explicit `OIDC_ISSUER_URL=https://accounts.google.com`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `APP_BASE_URL=https://app.fnbcostpro.com`, and the existing `SESSION_SECRET`; it must not require `REPL_ID` or derive the callback from `req.hostname`. Link an existing FnB account only when Google supplies a present, explicitly verified email whose normalized value exactly matches the existing account. Preserve the FnB identity, company, role, stores, permissions, password credentials, and historical relationships; only the Google identity association may change. Missing or unverified email must fail safely. A pending invitation must remain unresolved and cannot reassign a known user. Local logout should destroy the FnB session and return to the FnB login page without requiring Google-wide logout. Significant auth work requires fresh Reviewer and QA passes, including password preservation and production configuration tests.