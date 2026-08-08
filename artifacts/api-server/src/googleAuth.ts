/**
 * Google OIDC Authentication
 *
 * Implements approved optional Google Identity sign-in (#997).
 *
 * Guardrails enforced here:
 *  - Email must be present and email_verified must be explicitly true.
 *  - Linking to an existing FnB user by normalized email only after verified identity.
 *  - Existing user: only the Google provider identity fields may change.
 *    Company, role, stores, password credentials are NEVER touched.
 *  - Existing user + pending invitation: invitation is NOT applied.
 *    It is left unresolved for administrative action.
 *  - New user: requires a valid invitation (same rule as existing Replit SSO).
 *  - Logout: local FnB session only. No Google-wide logout.
 *  - Production callback is derived exclusively from APP_BASE_URL and uses the
 *    canonical /api/sso/callback path. req.hostname is never used.
 *    REPL_ID is never required.
 *
 * Route registration happens through setupSsoAuth (ssoAuth.ts), which mounts
 * these Google handlers on the canonical /api/sso/* routes when Google is
 * configured, and falls back to Replit OIDC for development otherwise.
 */

import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import type { Express, Request } from "express";
import { storage } from "./storage";

export const GOOGLE_STRATEGY_NAME = "google-oidc";

// ── Google-specific Strategy subclass ────────────────────────────────────────
//
// openid-client's Strategy.authorizationRequestParams() maps a fixed set of
// named options (scope, prompt, loginHint, …) to URLSearchParams. It does NOT
// handle `access_type`, which is a Google-specific extension parameter.
//
// Google requires access_type=offline in the authorization request to issue a
// refresh_token. The OIDC offline_access scope alone is not sufficient — Google
// ignores it and still omits the refresh token without this parameter.
// Subclassing and overriding authorizationRequestParams is the documented way
// to inject extra authorization URL parameters with openid-client v6+.
class GoogleStrategy extends Strategy {
  override authorizationRequestParams(req: Request, options: any): URLSearchParams {
    // The base class declares the return as URLSearchParams | Record<string, string> | undefined
    // but always returns a URLSearchParams at runtime (see passport.js source).
    // We normalise to URLSearchParams defensively.
    const base = super.authorizationRequestParams(req, options);
    const params: URLSearchParams =
      base instanceof URLSearchParams
        ? base
        : new URLSearchParams(
            base != null ? Object.entries(base) : [],
          );
    // Required by Google to receive a refresh_token. Without this, Google only
    // issues an access token (valid 1 hour) even when the user grants consent.
    // The OIDC offline_access scope alone is not sufficient for Google — this
    // Google-specific parameter must also be present in the authorization URL.
    params.set("access_type", "offline");
    return params;
  }
}

// ── Configuration ─────────────────────────────────────────────────────────────

function getGoogleEnvConfig() {
  return {
    issuerUrl: process.env.OIDC_ISSUER_URL ?? "https://accounts.google.com",
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    appBaseUrl: process.env.APP_BASE_URL,
  };
}

export function isGoogleConfigured(): boolean {
  const { clientId, clientSecret, appBaseUrl } = getGoogleEnvConfig();
  return !!(clientId && clientSecret && appBaseUrl);
}

// Cached OIDC discovery (1-hour TTL)
let cachedDiscovery: { config: client.Configuration; ts: number } | null = null;

export async function getGoogleOidcConfig(): Promise<client.Configuration> {
  if (cachedDiscovery && Date.now() - cachedDiscovery.ts < 3600 * 1000) {
    return cachedDiscovery.config;
  }
  const { issuerUrl, clientId, clientSecret } = getGoogleEnvConfig();
  const config = await client.discovery(
    new URL(issuerUrl),
    clientId!,
    clientSecret!,
  );
  cachedDiscovery = { config, ts: Date.now() };
  return config;
}

// ── Email normalization ────────────────────────────────────────────────────────

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.toLowerCase().trim();
}

// ── User upsert ───────────────────────────────────────────────────────────────

export type UpsertGoogleResult =
  | { ok: true; user: any }
  | {
      ok: false;
      reason:
        | "missing_email"
        | "unverified_email"
        | "no_invitation"
        | "invitation_conflict"
        | "error";
      detail?: string;
    };

/**
 * Safe Google identity upsert — all approved guardrails enforced.
 * Returns a discriminated union so callers handle every failure path explicitly.
 */
export async function upsertGoogleUser(
  claims: Record<string, unknown>,
  invitationToken?: string,
): Promise<UpsertGoogleResult> {
  // ── 1. Email must be present ───────────────────────────────────────────────
  const email = normalizeEmail(claims["email"]);
  if (!email) {
    console.error("[Google SSO] Missing email claim — rejecting");
    return { ok: false, reason: "missing_email" };
  }

  // ── 2. email_verified must be explicitly true (strict boolean) ─────────────
  if (claims["email_verified"] !== true) {
    console.error(
      "[Google SSO] email_verified not explicitly true — rejecting:",
      claims["email_verified"],
    );
    return { ok: false, reason: "unverified_email" };
  }

  const sub = String(claims["sub"]);

  // ── 3. Lookup: provider+sub first, then verified email bridge ──────────────
  let user: any = await storage.getUserBySsoId("google", sub) ?? null;
  if (!user) {
    user = await storage.getUserByEmail(email) ?? null;
  }

  // ── 4. Resolve invitation token ────────────────────────────────────────────
  let invitation: any = undefined;
  if (invitationToken) {
    invitation = await storage.getInvitationByToken(invitationToken);
    if (invitation) {
      if (normalizeEmail(invitation.email) !== email) {
        console.error("[Google SSO] Invitation email mismatch — ignoring invitation");
        invitation = undefined;
      }
    }
  }

  // ── 5. Existing user branch ────────────────────────────────────────────────
  if (user) {
    // Existing user + conflicting pending invitation: block, leave unresolved.
    // Per approved spec: return controlled result, require admin action.
    if (invitation) {
      console.warn(
        "[Google SSO] Existing user has a conflicting pending invitation — leaving unresolved for admin action",
      );
      return {
        ok: false,
        reason: "invitation_conflict",
        detail: "Pending invitation requires administrative resolution",
      };
    }

    // Link Google identity.
    // ONLY the provider identity association may change.
    // company, role, stores, password credentials are NEVER modified here.
    const updates: Record<string, unknown> = {
      ssoProvider: "google",
      ssoId: sub,
      updatedAt: new Date(),
    };

    // Profile fields: add only when the existing value is absent
    const googleFirstName =
      typeof claims["given_name"] === "string" ? claims["given_name"] : undefined;
    const googleLastName =
      typeof claims["family_name"] === "string" ? claims["family_name"] : undefined;
    const googleImage =
      typeof claims["picture"] === "string" ? claims["picture"] : undefined;

    if (googleFirstName && !user.firstName) updates.firstName = googleFirstName;
    if (googleLastName && !user.lastName) updates.lastName = googleLastName;
    if (googleImage && !user.profileImageUrl) updates.profileImageUrl = googleImage;

    await storage.updateUser(user.id, updates);
    const refreshed = await storage.getUser(user.id);
    return { ok: true, user: refreshed ?? user };
  }

  // ── 6. New user branch ────────────────────────────────────────────────────
  // New users require a valid matching invitation — same rule as Replit SSO.
  if (!invitation) {
    console.log("[Google SSO] No existing user and no valid invitation — rejecting:", email);
    return { ok: false, reason: "no_invitation" };
  }

  const newUser = await storage.createUser({
    email,
    companyId: invitation.companyId,
    ssoProvider: "google",
    ssoId: sub,
    profileImageUrl:
      typeof claims["picture"] === "string" ? claims["picture"] : undefined,
    firstName:
      typeof claims["given_name"] === "string" ? claims["given_name"] : undefined,
    lastName:
      typeof claims["family_name"] === "string" ? claims["family_name"] : undefined,
    role: invitation.role,
    active: 1,
  });

  await storage.acceptInvitation(invitation.token);

  if (invitation.role === "company_admin") {
    const companyStores = await storage.getCompanyStores(invitation.companyId);
    for (const store of companyStores) {
      await storage.assignUserToStore(newUser.id, store.id);
    }
  } else if (Array.isArray(invitation.storeIds) && invitation.storeIds.length > 0) {
    for (const storeId of invitation.storeIds) {
      await storage.assignUserToStore(newUser.id, storeId);
    }
  }

  return { ok: true, user: newUser };
}

// ── Route registration ────────────────────────────────────────────────────────

/**
 * Build the canonical fixed callback URL from APP_BASE_URL.
 * Exported for tests. Never derived from req.hostname.
 */
export function getGoogleCallbackUrl(): string {
  const { appBaseUrl } = getGoogleEnvConfig();
  if (!appBaseUrl) throw new Error("APP_BASE_URL is not configured");
  return `${appBaseUrl.replace(/\/+$/, "")}/api/sso/callback`;
}

/**
 * Mount the Google OIDC handlers on the canonical /api/sso/* routes.
 * Only called by setupSsoAuth when isGoogleConfigured() is true.
 * Session middleware and passport initialization are owned by ssoAuth.ts.
 */
export async function setupGoogleSsoRoutes(app: Express): Promise<void> {
  // Fixed production callback — NEVER derived from req.hostname
  const callbackURL = getGoogleCallbackUrl();
  console.log("[Google SSO] Configured. Production callback:", callbackURL);

  const oidcConfig = await getGoogleOidcConfig();

  const verify: VerifyFunction = async (tokens, verified) => {
    // Warn loudly when Google omits the refresh_token. This should never
    // happen given access_type=offline + prompt=consent, but surfacing it
    // in logs makes regressions immediately visible.
    if (!tokens.refresh_token) {
      console.warn(
        "[Google SSO] WARNING: Google callback did not include a refresh_token. " +
        "Sessions will expire after 1 hour. Check that access_type=offline and " +
        "prompt=consent are present in the authorization request.",
      );
    }
    const sessionData: any = {
      provider: "google",
      claims: tokens.claims(),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.claims()?.exp,
    };
    verified(null, sessionData);
  };

  passport.use(
    new GoogleStrategy(
      {
        name: GOOGLE_STRATEGY_NAME,
        config: oidcConfig,
        // offline_access is the OIDC scope for offline access. Google also
        // requires access_type=offline in the authorization URL — that is
        // injected by GoogleStrategy.authorizationRequestParams above.
        scope: "openid email profile offline_access",
        callbackURL,
      },
      verify,
    ),
  );

  // GET /api/sso/provider — lets the login UI show the correct button
  app.get("/api/sso/provider", (_req, res) => {
    res.json({ provider: "google" });
  });

  // GET /api/sso/login — initiate Google login
  app.get("/api/sso/login", (req, res, next) => {
    console.log("[Google SSO] Starting Google login");
    passport.authenticate(GOOGLE_STRATEGY_NAME, {
      // offline_access is required to receive a refresh token so that
      // isSsoAuthenticated can silently renew sessions past the 1-hour
      // Google access-token expiry.
      scope: ["openid", "email", "profile", "offline_access"],
      // prompt=consent is required on every login, not just the first.
      // Google only issues a refresh_token when the user explicitly grants
      // consent. On repeat logins without this flag Google skips the consent
      // screen and omits the refresh_token entirely, leaving the user with
      // only a 1-hour access token. Forcing consent on every login guarantees
      // a fresh refresh_token so isSsoAuthenticated can silently renew
      // sessions indefinitely. The minor extra friction (one extra click on
      // repeat logins) is the accepted tradeoff.
      prompt: "consent",
    })(req, res, next);
  });

  // GET /api/sso/callback — handle Google OIDC response (canonical callback)
  app.get("/api/sso/callback", (req, res, next) => {
    passport.authenticate(
      GOOGLE_STRATEGY_NAME,
      async (err: any, sessionData: any) => {
        if (err) {
          console.error("[Google SSO] Auth error:", err);
          return res.redirect("/login?error=google-auth-failed");
        }
        if (!sessionData) {
          console.error("[Google SSO] No session data returned");
          return res.redirect("/login?error=google-auth-failed");
        }

        // Retrieve invitation token from signed cookie (set by /api/invitations/prepare-acceptance)
        let invitationToken: string | undefined;
        const cookieToken = (req as any).signedCookies?.pendingInvitation;
        if (cookieToken) {
          invitationToken = cookieToken;
          res.clearCookie("pendingInvitation");
          console.log("[Google SSO] Retrieved invitation from signed cookie");
        }

        const claims = sessionData.claims as Record<string, unknown>;
        const result = await upsertGoogleUser(claims, invitationToken);

        if (!result.ok) {
          const errorCodes: Record<string, string> = {
            missing_email: "google-missing-email",
            unverified_email: "google-unverified-email",
            no_invitation: "google-access-denied",
            invitation_conflict: "google-invitation-conflict",
            error: "google-auth-failed",
          };
          const code = errorCodes[result.reason] ?? "google-auth-failed";
          console.warn("[Google SSO] Upsert rejected:", result.reason, result.detail ?? "");
          return res.redirect(`/login?error=${code}`);
        }

        const user = result.user;
        sessionData.userId = user.id;

        req.login(sessionData, (loginErr) => {
          if (loginErr) {
            console.error("[Google SSO] Login error:", loginErr);
            return res.redirect("/login?error=google-auth-failed");
          }

          req.session.save((saveErr) => {
            if (saveErr) {
              console.error("[Google SSO] Session save error:", saveErr);
              return res.redirect("/login?error=google-auth-failed");
            }

            console.log(
              "[Google SSO] Authenticated:",
              user.email,
              "companyId:",
              user.companyId,
            );

            if (user.role === "global_admin") return res.redirect("/companies");
            if (user.companyId) return res.redirect("/");
            return res.redirect("/pending-approval");
          });
        });
      },
    )(req, res, next);
  });

  // GET /api/sso/logout — local FnB session only
  // Per approved spec: destroy the FnB application session and return to login.
  // Google-wide logout is NOT performed.
  app.get("/api/sso/logout", (req: any, res) => {
    req.logout(() => {
      req.session?.destroy((err: any) => {
        if (err) console.error("[Google SSO] Session destroy error:", err);
        res.redirect("/login");
      });
    });
  });
}
