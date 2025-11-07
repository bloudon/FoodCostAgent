import { randomBytes, createHash } from "crypto";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import { cache, CacheKeys, CacheTTL } from "./cache";
import type { Request, Response, NextFunction } from "express";
import type { AuthSession, User } from "@shared/schema";

const TOKEN_LENGTH = 32;
const SESSION_DURATION_DAYS = 30;

/**
 * Generate a random token and its hash
 */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_LENGTH).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Create an authentication session
 */
export async function createSession(userId: string, userAgent?: string, ip?: string) {
  const { token, tokenHash } = generateToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

  const session = await storage.createAuthSession({
    userId,
    tokenHash,
    expiresAt,
    userAgent,
    ipAddress: ip,
  });

  // Cache the session for fast lookups (Phase 2 optimization)
  await cache.set(CacheKeys.session(tokenHash), session, CacheTTL.SESSION);

  return token;
}

/**
 * Middleware to require authentication (supports both SSO and username/password)
 * Hybrid authentication: checks Passport SSO session first, then falls back to cookie-based session
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Check if authenticated via Passport (SSO)
  if ((req as any).isAuthenticated && (req as any).isAuthenticated()) {
    const passportUser = (req as any).user;
    
    if (passportUser && passportUser.userId) {
      // Fetch full user object from database with caching
      let user: User | null | undefined = await cache.get<User>(CacheKeys.user(passportUser.userId));
      
      if (!user) {
        user = await storage.getUser(passportUser.userId);
        if (user) {
          await cache.set(CacheKeys.user(user.id), user, CacheTTL.USER);
        }
      }
      
      if (user) {
        // Attach user to request
        (req as any).user = user;
        (req as any).ssoAuth = true;
        
        // Resolve company context
        // For global admins, use selectedCompanyId from Passport session if available
        // For company-bound users, use their companyId
        let companyId = user.companyId || null;
        if (user.role === "global_admin" && (req as any).session?.selectedCompanyId) {
          companyId = (req as any).session.selectedCompanyId;
        }
        (req as any).companyId = companyId;
        (req as any).selectedCompanyId = (req as any).session?.selectedCompanyId || null;
        
        return next();
      }
    }
  }
  
  // Not SSO authenticated, try username/password session cookie
  const token = req.cookies?.session;
  
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  
  // Try cache first (Phase 2 optimization - eliminates DB lookup on every request)
  let session: AuthSession | null | undefined = await cache.get<AuthSession>(CacheKeys.session(tokenHash));
  
  if (!session) {
    // Cache miss - fetch from database
    session = await storage.getAuthSessionByToken(tokenHash);
    
    if (session) {
      // Cache for future requests
      await cache.set(CacheKeys.session(tokenHash), session, CacheTTL.SESSION);
    }
  }

  if (!session) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // Try cache for user lookup (Phase 2 optimization)
  let user: User | null | undefined = await cache.get<User>(CacheKeys.user(session.userId));
  
  if (!user) {
    // Cache miss - fetch from database
    user = await storage.getUser(session.userId);
    
    if (user) {
      // Cache for future requests
      await cache.set(CacheKeys.user(user.id), user, CacheTTL.USER);
    }
  }
  
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  // Attach user and auth session to request
  // Note: Using 'authSession' instead of 'session' to avoid conflict with express-session
  (req as any).user = user;
  (req as any).authSession = session;
  (req as any).sessionId = session.id;
  
  // Resolve company context: use user.companyId for regular users, session.selectedCompanyId for global_admin
  const companyId = user.companyId || session.selectedCompanyId || null;
  (req as any).companyId = companyId;
  
  next();
}

/**
 * Optional auth middleware - doesn't fail if not authenticated (with Phase 2 caching)
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  
  if (!token) {
    return next();
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  
  // Try cache first (Phase 2 optimization)
  let session: AuthSession | null | undefined = await cache.get<AuthSession>(CacheKeys.session(tokenHash));
  
  if (!session) {
    session = await storage.getAuthSessionByToken(tokenHash);
    if (session) {
      await cache.set(CacheKeys.session(tokenHash), session, CacheTTL.SESSION);
    }
  }

  if (session) {
    // Try cache for user lookup
    let user: User | null | undefined = await cache.get<User>(CacheKeys.user(session.userId));
    
    if (!user) {
      user = await storage.getUser(session.userId);
      if (user) {
        await cache.set(CacheKeys.user(user.id), user, CacheTTL.USER);
      }
    }
    
    if (user) {
      (req as any).user = user;
      (req as any).sessionId = session.id;
    }
  }
  
  next();
}

/**
 * Middleware to require global admin role
 */
export function requireGlobalAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  
  if (user.role !== "global_admin") {
    return res.status(403).json({ error: "Global admin access required" });
  }
  
  next();
}

/**
 * Middleware to require company admin or global admin role
 */
export function requireCompanyAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  const companyId = (req as any).companyId;
  
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  
  // Global admins have full access
  if (user.role === "global_admin") {
    return next();
  }
  
  // Company admins need to match the company
  if (user.role === "company_admin" && user.companyId === companyId) {
    return next();
  }
  
  return res.status(403).json({ error: "Company admin access required" });
}

/**
 * Middleware to validate store access
 */
export async function requireStoreAccess(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  const storeId = req.params.storeId || req.body.storeId || req.query.storeId;
  
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  
  if (!storeId) {
    return res.status(400).json({ error: "Store ID required" });
  }
  
  // Global admins have full access
  if (user.role === "global_admin") {
    return next();
  }
  
  // Check if store belongs to user's company
  const store = await storage.getCompanyStore(storeId);
  if (!store) {
    return res.status(404).json({ error: "Store not found" });
  }
  
  // Company admins can access all stores in their company
  if (user.role === "company_admin" && user.companyId === store.companyId) {
    return next();
  }
  
  // Store managers and users need explicit assignment
  if (user.role === "store_manager" || user.role === "store_user") {
    const userStores = await storage.getUserStores(user.id);
    const hasAccess = userStores.some(us => us.storeId === storeId);
    
    if (hasAccess) {
      return next();
    }
  }
  
  return res.status(403).json({ error: "Store access denied" });
}
