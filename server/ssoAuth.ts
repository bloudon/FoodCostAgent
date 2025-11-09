import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // Allow cookies to be sent on redirects from OAuth
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertSsoUser(
  claims: any,
  invitationToken?: string,
) {
  // Check if user exists by SSO ID
  const ssoId = claims["sub"];
  const email = claims["email"];
  const ssoProvider = "replit"; // Could be extracted from issuer if supporting multiple providers
  
  let user = await storage.getUserBySsoId(ssoProvider, ssoId);
  
  if (!user && email) {
    // Check if user exists by email (for account linking)
    user = await storage.getUserByEmail(email);
  }
  
  if (user) {
    // Update existing user with SSO info
    await storage.updateUser(user.id, {
      ssoProvider,
      ssoId,
      profileImageUrl: claims["profile_image_url"],
      firstName: claims["first_name"] || user.firstName,
      lastName: claims["last_name"] || user.lastName,
      updatedAt: new Date(),
    });
  } else {
    // Check for pending invitation token
    let invitation;
    
    if (invitationToken) {
      // Use token to get the specific invitation
      invitation = await storage.getInvitationByToken(invitationToken);
      
      // Validate that the invitation email matches the SSO email
      if (invitation && invitation.email !== email) {
        console.error("Invitation email mismatch:", invitation.email, "vs", email);
        invitation = undefined; // Reject invitation if email doesn't match
      }
    }
    
    if (invitation) {
      // Create user with company and role from invitation
      user = await storage.createUser({
        email,
        companyId: invitation.companyId,
        ssoProvider,
        ssoId,
        profileImageUrl: claims["profile_image_url"],
        firstName: claims["first_name"],
        lastName: claims["last_name"],
        role: invitation.role,
        active: 1,
      });
      
      // Mark invitation as accepted
      await storage.acceptInvitation(invitation.token);
      
      // If company admin, auto-assign to all stores
      if (invitation.role === "company_admin") {
        const companyStores = await storage.getCompanyStores(invitation.companyId);
        for (const store of companyStores) {
          await storage.assignUserToStore(user.id, store.id);
        }
      } else if (invitation.storeIds && invitation.storeIds.length > 0) {
        // Assign user to stores specified in invitation
        for (const storeId of invitation.storeIds) {
          await storage.assignUserToStore(user.id, storeId);
        }
      }
    } else {
      // No valid invitation - SSO access requires an invitation
      // Return null to signal access denied
      return null;
    }
  }
  
  return user;
}

export async function setupSsoAuth(app: Express) {
  app.set("trust proxy", 1);
  
  // Apply session middleware globally so Passport can deserialize sessions on all routes
  app.use(getSession());
  
  // Initialize passport and enable session support globally
  app.use(passport.initialize());
  app.use(passport.session());
  
  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const sessionData = {};
    updateUserSession(sessionData, tokens);
    // Store claims in session data for callback handler to access
    (sessionData as any).claims = tokens.claims();
    
    verified(null, sessionData);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/sso/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  // SSO Login route
  app.get("/api/sso/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  // SSO Callback route
  app.get("/api/sso/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, async (err: any, sessionData: any) => {
      if (err) {
        console.error("SSO auth error:", err);
        return res.redirect("/login");
      }
      
      if (!sessionData) {
        console.error("No session data from SSO");
        return res.redirect("/login");
      }
      
      console.log("SSO sessionData:", sessionData);
      
      // Process invitation if token exists in session
      const invitationToken = (req.session as any).pendingInvitationToken;
      const claims = sessionData.claims;
      
      // Create or update user with invitation if applicable
      const user = await upsertSsoUser(claims, invitationToken);
      
      // Check if user creation was denied (no valid invitation)
      if (!user) {
        // Clear invitation token from session
        if (invitationToken) {
          delete (req.session as any).pendingInvitationToken;
        }
        console.log("SSO access denied - no valid invitation for:", claims["email"]);
        return res.redirect("/sso-access-denied");
      }
      
      // Clear invitation token from session
      if (invitationToken) {
        delete (req.session as any).pendingInvitationToken;
      }
      
      // Store user ID in session data
      sessionData.userId = user.id;
      
      // Log the user in
      req.login(sessionData, async (loginErr) => {
        if (loginErr) {
          console.error("Login error:", loginErr);
          return res.redirect("/login");
        }
        
        console.log("User logged in via Passport, session ID:", req.session?.id);
        console.log("User authenticated:", user.email, "companyId:", user.companyId);
        
        // Save session before redirecting
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.redirect("/login");
          }
          
          console.log("Session saved successfully");
          
          // Check if user has company assignment
          if (user.companyId) {
            // User has company - redirect to dashboard
            if (user.role === "global_admin") {
              return res.redirect("/companies");
            } else {
              return res.redirect("/");
            }
          } else {
            // No company assignment - redirect to pending approval page
            return res.redirect("/pending-approval");
          }
        });
      });
    })(req, res, next);
  });

  // SSO Logout route
  app.get("/api/sso/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy((err) => {
        if (err) console.error("Session destroy error:", err);
        res.redirect(
          client.buildEndSessionUrl(config, {
            client_id: process.env.REPL_ID!,
            post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
          }).href
        );
      });
    });
  });
}

/**
 * Middleware to check if user is authenticated via SSO
 */
export const isSsoAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return next(); // Not SSO authenticated, let other auth methods handle it
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    // Token is still valid, attach user to request
    const userId = user.userId;
    if (userId) {
      const dbUser = await storage.getUser(userId);
      if (dbUser) {
        (req as any).user = dbUser;
        (req as any).companyId = dbUser.companyId || null;
        (req as any).ssoAuth = true; // Mark as SSO authenticated
      }
    }
    return next();
  }

  // Token expired, try to refresh
  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    return next(); // No refresh token, let other auth methods handle it
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    
    // Attach user to request
    const userId = user.userId;
    if (userId) {
      const dbUser = await storage.getUser(userId);
      if (dbUser) {
        (req as any).user = dbUser;
        (req as any).companyId = dbUser.companyId || null;
        (req as any).ssoAuth = true;
      }
    }
    return next();
  } catch (error) {
    // Refresh failed, let other auth methods handle it
    return next();
  }
};
