---
name: Google OIDC product decision
description: Approved production SSO provider and non-negotiable account-linking safeguards.
---

Google Identity is the approved replacement production OIDC provider for Replit-managed SSO. FnB Cost Pro must retain email/password login and all application-owned users, sessions, companies, stores, roles, permissions, invitations, and authorization. Google is an additional identity method, not an authorization source.

**Why:** Product Management approved Google while explicitly rejecting an identity broker and requiring continuity for existing non-Google users.

**How to apply:** Link an existing FnB account only when Google supplies a present, explicitly verified email whose normalized value exactly matches the existing account. Preserve company, role, store access, and permissions. Missing or unverified email must fail safely, invitations must not silently reassign known users, logout should destroy the local FnB session by default, and production callbacks must use the configured canonical application URL.