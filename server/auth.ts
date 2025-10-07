import { randomBytes, createHash } from "crypto";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import type { Request, Response, NextFunction } from "express";

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

  await storage.createAuthSession({
    userId,
    tokenHash,
    expiresAt,
    userAgent,
    ipAddress: ip,
  });

  return token;
}

/**
 * Middleware to require authentication
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await storage.getAuthSessionByToken(tokenHash);

  if (!session) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  const user = await storage.getUser(session.userId);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  // Attach user to request
  (req as any).user = user;
  (req as any).sessionId = session.id;
  
  next();
}

/**
 * Optional auth middleware - doesn't fail if not authenticated
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  
  if (!token) {
    return next();
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await storage.getAuthSessionByToken(tokenHash);

  if (session) {
    const user = await storage.getUser(session.userId);
    if (user) {
      (req as any).user = user;
      (req as any).sessionId = session.id;
    }
  }
  
  next();
}
