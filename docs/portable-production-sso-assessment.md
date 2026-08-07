# Portable Production SSO Assessment

**Audience:** Product Management, Engineering, Security Review  
**Status:** Decision document — no authentication changes implemented  
**Production application:** `https://app.fnbcostpro.com`  
**Objective:** Make production SSO portable to a standards-compliant external OpenID Connect (OIDC) provider while preserving FnB Cost Pro’s application-owned users, permissions, authorization, and session model.

## Executive conclusion

The existing SSO implementation already uses the standards-based `openid-client` library and receives ordinary OIDC claims. It can be generalized without replacing the FnB Cost Pro user, company, store, role, or authorization model.

The smallest safe target is an external OIDC client configured with:

```text
OIDC_ISSUER_URL
OIDC_CLIENT_ID
OIDC_CLIENT_SECRET
APP_BASE_URL=https://app.fnbcostpro.com
```

and a registered callback:

```text
https://app.fnbcostpro.com/api/sso/callback
```

However, the implementation should **not** be changed until Product Management approves the identity-linking policy. Current behavior matches an existing user by provider + subject first, then falls back to email; after an email match, it overwrites the saved provider + subject with the newly used identity. This preserves the user’s permissions but loses the previous provider linkage.

## 1. Current identity flow

```text
User selects enterprise SSO
  → browser requests GET /api/sso/login
  → Passport redirects to Replit OIDC
  → Replit redirects to GET /api/sso/callback
  → OIDC tokens and claims are received
  → FnB matches/creates an application user
  → Passport session is written to PostgreSQL
  → existing authorization reads the FnB user record
```

### Detailed behavior

1. The web login and Settings pages send the browser to `/api/sso/login`.
2. The server discovers the issuer and identifies the OIDC client with `REPL_ID`.
3. It builds a provider callback URL from the request host: `https://{hostname}/api/sso/callback`.
4. The OIDC library receives an authorization response and saves the returned claims, access token, refresh token, and token expiration in Passport session data.
5. The callback finds or creates a row in FnB Cost Pro’s `users` table:
   - first by `(sso_provider, sso_id)`;
   - then, if no match is found, by `email`.
6. Users who are not already known must present a valid invitation. The invitation provides company, role, and any store assignments.
7. Passport stores the authenticated SSO session in the PostgreSQL `sessions` table.
8. Request authorization obtains the FnB user row and continues to use its role, company, store assignments, and selected-company state.

The identity provider establishes identity only. FnB Cost Pro continues to own the application account and every business authorization decision.

## 2. Claims and identity storage

| OIDC value | Current source | Current destination | Use |
| --- | --- | --- | --- |
| Subject | `claims["sub"]` | `users.sso_id` | Stable provider-scoped identity lookup. |
| Email | `claims["email"]` | `users.email` for new SSO users; lookup key for existing users | Account linking and invitation-email verification. |
| Provider label | Hard-coded `"replit"` | `users.sso_provider` | Distinguishes provider + subject pairs. |
| First name | `claims["first_name"]` | `users.first_name` | Profile display; existing value is retained if the claim is absent. |
| Last name | `claims["last_name"]` | `users.last_name` | Profile display; existing value is retained if the claim is absent. |
| Profile image | `claims["profile_image_url"]` | `users.profile_image_url` | Profile display. |
| Access token | OIDC token response | Passport session data only | Used as current-provider session data; not used for application authorization. |
| Refresh token | OIDC token response | Passport session data only | Used to refresh an expired provider token. |
| Token expiry | OIDC `exp` claim | Passport session data only | Determines whether a refresh is attempted. |

### Claims not currently consumed

- No display-name claim is read.
- No Replit-specific claim beyond the ordinary OIDC profile fields above is read.
- No provider group, organization, team, role, or entitlement claim is used for application authorization.
- FnB Cost Pro does not use the access token to grant company, store, or feature access.

## 3. Replit-specific dependencies

The following dependencies are tied to Replit-managed Auth rather than portable OIDC:

| Dependency | Current role | Portability implication |
| --- | --- | --- |
| `REPL_ID` | OIDC client identifier during discovery and logout | Replace with `OIDC_CLIENT_ID`. |
| `ISSUER_URL`, defaulting to `https://replit.com/oidc` | OIDC issuer | Replace with required `OIDC_ISSUER_URL`. |
| Hard-coded `"replit"` provider label | Stored identity-provider discriminator | Derive a stable configured provider key or issuer-derived label. |
| Dynamic request-host callback URL | Builds `https://{hostname}/api/sso/callback` | Use the configured canonical application URL in production. |
| Dynamic request-host logout redirect | Builds the post-logout return URL | Use the configured canonical application URL and only if accepted by the selected provider. |
| Replit domain/client registration | Permits Replit development and Replit-published domains | An external OIDC client must register production and any approved development callbacks. |

The rest of the current OIDC callback, user lookup, invitation, database session, and authorization behavior is provider-neutral in concept.

## 4. Provider-neutral pieces to preserve

The following should remain owned by FnB Cost Pro and should not be delegated to an identity provider:

- `users` records and their stable FnB user IDs.
- Company membership and company selection.
- Store assignment and store-level permissions.
- Application roles, including global administrator behavior.
- Invitation issuance, acceptance, and invitation-email checks.
- Application authorization middleware and API permission checks.
- Existing password authentication while it remains a supported login method.
- Mobile bearer-token authentication and its secure storage behavior.
- Application session lifecycle, including session revocation and logout behavior where provider-independent.

This means the OIDC migration is an **identity-source substitution**, not a migration of authorization data to a provider.

## 5. Minimum production OIDC contract

### Required provider capabilities

| Requirement | Why FnB needs it |
| --- | --- |
| Standards-compliant OIDC Authorization Code flow with PKCE | The existing `openid-client`/Passport approach is based on standard browser OIDC. |
| Issuer discovery document | Enables configuration from `OIDC_ISSUER_URL`. |
| Stable, immutable subject (`sub`) | Supports identity matching across sessions. |
| Email claim | Required for current invitation checks and existing-user linking. |
| Verified-email assurance | The current flow treats a matching email as sufficient to link an existing account; this is safe only when the provider guarantees the email identity. |
| `openid`, `email`, and `profile` scopes | Supplies the existing minimum identity data. |
| Client ID and client secret for a confidential server-side client | Required for production OIDC code exchange. |
| Exact callback registration | Must allow `https://app.fnbcostpro.com/api/sso/callback`. |
| Multiple callback URLs or separate environment clients | Needed if Replit development stays on a different identity provider or if both development and production use the external provider. |
| Session/logout documentation | Needed to preserve a predictable application logout and, if supported, provider logout. |

### Optional capabilities

- First/last-name and profile-image claims. The application can preserve existing profile values if those are absent.
- Google, Microsoft, social, or enterprise-IdP federation. These are provider selection criteria only if FnB’s product requirements call for them.
- SCIM, group claims, or organization claims. They are not required for the current application architecture.

### Required application configuration

```text
OIDC_ISSUER_URL=<provider issuer URL>
OIDC_CLIENT_ID=<production OIDC client ID>
OIDC_CLIENT_SECRET=<production OIDC client secret>
APP_BASE_URL=https://app.fnbcostpro.com
SESSION_SECRET=<existing application session secret>
```

The external provider must register:

```text
https://app.fnbcostpro.com/api/sso/callback
```

If the provider requires a post-logout URI, it must also permit:

```text
https://app.fnbcostpro.com
```

Production must terminate HTTPS correctly, preserve the original host and protocol through the reverse proxy, and use a persistent PostgreSQL-backed session store.

## 6. Replit development versus production

### Option A — Replit Auth for development; external OIDC for production

**Approach:** Select the provider/client from environment configuration. Replit development continues using the existing Replit issuer/client; production selects the external provider and canonical production callback.

**Benefits**

- Lowest immediate disruption to the Replit workspace workflow.
- No need to configure external-provider development callbacks before production portability is restored.
- Preserves existing Replit developer sign-in behavior while the external provider is procured or configured.

**Risks and cost**

- Two identity sources must use the same mapping policy.
- Development needs explicit regression coverage for both configurations.
- A user logging in through Replit development and external-provider production may have different provider subjects; email-linking policy becomes essential.
- Production-only problems are more likely unless a non-production external-provider client is later introduced.

### Option B — One external OIDC provider for development and production

**Approach:** Configure distinct provider clients or approved redirect URIs for Replit development and the VPS production domain, but use the same external provider integration everywhere.

**Benefits**

- One provider behavior, one claim contract, one provider-key policy, and closer development/production parity.
- Enables testing the production identity-linking behavior before release.
- Removes the Replit Auth production dependency completely.

**Risks and cost**

- Requires the external provider to support Replit-development callback domains or a stable development URL/client configuration.
- Requires earlier provider setup and secret management for development.
- May make casual Replit preview testing less convenient.

### Recommendation

Choose **Option B** when the external provider can safely support a stable non-production callback/client. It is the lower long-term risk because it eliminates environment-specific identity behavior.

Choose **Option A** only as a time-bounded transition if provider setup cannot support development immediately. It should share one provider-neutral SSO implementation and one identity-linking policy; it must not create a second application user/session/authorization system.

## 7. Existing-user migration implications

### How matching works today

The current order is:

1. Find a user using the stored provider key plus OIDC subject.
2. If no such user exists, find a user by email.
3. If an existing user is found, update their stored provider, subject, and profile fields.
4. If no user exists, create one only when there is a valid matching invitation.

### Effective identity key

For a returning user on the same provider, the effective key is **provider + subject**.

For a user coming from a different provider, the effective bridge is **email**. The application relies on email because a new provider will necessarily issue a different `sub`.

### Will users keep their permissions?

Yes, if an existing user is correctly identified by email and no pending invitation is being accepted. The existing FnB user row remains the same row, so its:

- company assignment,
- store assignments,
- role,
- active state,
- preferences, and
- other application relationships

remain unchanged.

**Important exception:** When a pending invitation is present, the current SSO path updates an existing user's company and role to the invitation values and may add all company stores or selected invitation stores. This is existing invitation behavior, not an external-provider requirement. Its interaction with a provider switch requires explicit approval: an invitation must never accidentally reassign a known user during an identity-linking migration.

### Duplicate-user risk

A duplicate can be created only when the external provider presents an email that does not match an existing FnB user. The current code also requires an invitation before it creates a new SSO user, which limits uninvited account creation.

The higher-risk case is not a duplicate; it is **incorrect account takeover through unverified or recycled email**. Because email matching can rewrite the stored provider + subject, the external provider must offer verified email, and the implementation must explicitly validate that assurance before linking.

Missing email also needs an explicit safe failure path. Today, a callback without an email cannot link an existing user; when a pending invitation is present, the current invitation-email comparison assumes an email exists and can fail unexpectedly rather than returning a controlled denial. An external-provider rollout must reject missing or unverified email cleanly before attempting a link or invitation acceptance.

### Current provider-linkage risk

When a user is found by email, the current code overwrites:

```text
users.sso_provider
users.sso_id
```

with the new provider identity. This makes a one-time switch straightforward, but:

- the original Replit subject is no longer retained;
- the same user cannot concurrently sign in through both providers using separate retained links;
- rollback to Replit Auth would need email matching again;
- a provider change must be audited and deliberately approved.

### Minimal migration posture

No bulk migration is required to preserve application roles and permissions. A controlled first external-provider login can link each user by verified email.

Before enabling that path, the implementation should choose one of these explicit policies:

1. **Cutover policy:** after a verified email match, replace the old provider + subject. Suitable for a one-way move after a defined rollback window.
2. **Dual-link policy:** retain more than one identity link per FnB user. Safer for a transition/rollback period, but requires a small identity-link model rather than overwriting one pair of fields.
3. **Admin-approved link policy:** require an administrator or a pre-migration mapping confirmation before a new provider subject can be attached to an existing user. Highest assurance, highest operational cost.

The current single-pair schema naturally implements the cutover policy, but Product Management and Security should approve that policy before it is used in production.

## 8. Smallest implementation surface after approval

The smallest change should generalize the existing SSO adapter rather than replace authentication architecture.

1. Replace Replit-specific issuer/client configuration with explicit OIDC environment configuration and validate it at startup.
2. Derive the production callback and post-logout return from `APP_BASE_URL`, never from an arbitrary incoming host.
3. Introduce an explicit provider key and claim-normalization layer for `sub`, verified email, name, and profile image.
4. Preserve the current invitation, user lookup, company/store assignment, and application authorization path.
5. Decide and implement the approved account-link policy before allowing email-based provider switching.
6. Add tests for valid login, callback mismatch, verified-email linking, missing-email rejection, subject change, invitation acceptance, logout, and existing permissions after linking.
7. Configure the chosen provider’s exact production callback and secrets on the VPS; configure an approved development path according to Option A or B.

## 9. Minimal files expected to change

These files are the verified starting points for an implementation task. The final set may expand only if the approved linking policy requires schema support.

- `artifacts/api-server/src/ssoAuth.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/config/env.ts`
- `artifacts/api-server/src/auth.ts`
- `artifacts/api-server/src/routes.ts`
- `lib/db/src/schema/schema.ts`
- `artifacts/fnb-cost-pro/src/pages/login.tsx`
- `artifacts/fnb-cost-pro/src/pages/settings.tsx`

## 10. PM and Product Owner decisions required

1. **Identity provider selection criteria:** Confirm the minimum contract in Section 5 and any required workforce/social provider options. Provider selection should follow these requirements, not popularity.
2. **Development strategy:** Approve Option A as a temporary split or Option B as the unified provider path.
3. **Account-link policy:** Approve cutover, dual-link, or admin-approved linking for existing users.
4. **Verified-email rule:** Confirm that an unverified, missing, or changed email must never automatically link to an existing FnB user.
5. **Rollback window:** Decide whether Replit Auth must remain usable after the external provider launches, and for how long.
6. **New-user eligibility:** Confirm that invitation-only SSO creation remains the intended rule.
7. **Provider logout expectation:** Decide whether signing out of FnB should also sign out at the external provider or only end the FnB application session.
8. **Invitation precedence:** Confirm whether accepting an invitation may change a known user’s company, role, or store assignments during an external-provider identity link. The safe default is to block and require an explicit account-management action.

## Source evidence

- `artifacts/api-server/src/ssoAuth.ts`
- `artifacts/api-server/src/auth.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/routes.ts`
- `artifacts/api-server/src/storage.ts`
- `lib/db/src/schema/schema.ts`
- `artifacts/fnb-cost-pro/src/pages/login.tsx`
- `artifacts/fnb-cost-pro/src/pages/settings.tsx`
- `attached_assets/Pasted--Scope-Portable-Production-SSO-We-have-confirmed-that-R_1786142816046.txt`
