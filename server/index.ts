import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import { registerRoutes, setupWebSocket } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { seedDatabase } from "./seed";
import { storage } from "./storage";
import { cache } from "./cache";
import { setupSsoAuth } from "./ssoAuth";
import { db } from "./db";
import { sql } from "drizzle-orm";

const app = express();
app.disable('etag');

// Enable gzip compression for responses >1KB (Phase 2 optimization)
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Raw body parser for webhooks (must come before JSON parser to handle non-JSON EDI payloads)
app.use('/webhooks/edi', express.raw({
  type: '*/*',
  verify: (req: any, res, buf, encoding) => {
    // Store raw body for HMAC verification
    req.rawBody = buf.toString((encoding as BufferEncoding) || 'utf8');
  }
}));

// Raw body parser for Stripe webhook (must come before JSON parser — Stripe needs raw Buffer for signature verification)
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// JSON parser for all other routes
app.use(express.json());

app.use(express.urlencoded({ extended: false }));
// Use SESSION_SECRET for signing cookies (required for signed cookies like invitation tokens)
app.use(cookieParser(process.env.SESSION_SECRET));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

async function runStartupMigrations() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS background_images (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        object_path text,
        external_url text,
        label text,
        sort_order integer NOT NULL DEFAULT 0,
        is_active integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS instructions text`);
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS image_path text`);
    await db.execute(sql`ALTER TABLE recipe_import_sessions ADD COLUMN IF NOT EXISTS recipe_id text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand_image_path text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_customer_id text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_id text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_status text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_tier text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_term text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz`);
    // auth_sessions columns added incrementally
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS revoked_at timestamptz`);
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT now()`);
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_agent text`);
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ip_address text`);
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS selected_company_id varchar`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS auth_sessions_last_active_at_idx ON auth_sessions (last_active_at)`);
    console.log('✅ Startup migrations applied');
  } catch (err) {
    console.error('⚠️ Startup migrations error (non-fatal):', err);
  }
}

(async () => {
  // Apply schema migrations that may be missing on the VPS database
  await runStartupMigrations();

  // Setup SSO authentication (must be before registerRoutes) - skip on VPS with local auth
  if (process.env.AUTH_MODE !== 'local') {
    await setupSsoAuth(app);
  }
  
  const server = await registerRoutes(app);
  
  // Setup WebSocket for real-time POS streaming
  setupWebSocket(server);

  await seedDatabase();

  // Start background session cleanup job
  // Runs every hour to remove expired auth sessions and prevent table bloat
  const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const cleanupSessionsJob = async () => {
    try {
      await storage.cleanExpiredSessions();
      log('✅ Session cleanup completed');
    } catch (error) {
      console.error('❌ Session cleanup error:', error);
    }
  };
  
  // Run cleanup immediately on startup, then every hour
  cleanupSessionsJob();
  setInterval(cleanupSessionsJob, SESSION_CLEANUP_INTERVAL_MS);
  log(`🔄 Session cleanup job scheduled (every ${SESSION_CLEANUP_INTERVAL_MS / 1000 / 60} minutes)`);

  // Start QuickBooks token refresh job (if QB credentials configured)
  // Runs every hour with jitter to proactively refresh tokens before expiry
  const hasQuickBooksCredentials = !!process.env.QUICKBOOKS_CLIENT_ID && !!process.env.QUICKBOOKS_CLIENT_SECRET;
  if (hasQuickBooksCredentials) {
    const { refreshAllActiveConnections } = await import("./services/quickbooks");
    const QB_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    const QB_JITTER_MS = 10 * 60 * 1000; // ±10 minutes
    
    const refreshQuickBooksTokensJob = async () => {
      try {
        const results = await refreshAllActiveConnections();
        if (results.success > 0 || results.failed > 0) {
          log(`🔄 QuickBooks token refresh: ${results.success} success, ${results.failed} failed`);
        }
      } catch (error) {
        console.error('❌ QuickBooks token refresh job error:', error);
      }
    };
    
    // Run on startup, then every hour with random jitter
    refreshQuickBooksTokensJob();
    setInterval(() => {
      const jitter = Math.random() * QB_JITTER_MS * 2 - QB_JITTER_MS; // Random ±10min
      setTimeout(refreshQuickBooksTokensJob, jitter);
    }, QB_REFRESH_INTERVAL_MS);
    log(`🔄 QuickBooks token refresh job scheduled (every ${QB_REFRESH_INTERVAL_MS / 1000 / 60} minutes ±${QB_JITTER_MS / 1000 / 60}min)`);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    // In production, add a fast health check at root before serving static files
    // This ensures deployment health checks get quick 200 responses
    app.get('/', (req, res, next) => {
      // Health check probes typically:
      // 1. Have no User-Agent, or simple User-Agent (not a browser)
      // 2. Don't request HTML specifically (or use Accept: */*)
      // 3. Have no Referer header
      const userAgent = req.get('user-agent') || '';
      const hasReferer = !!req.get('referer');
      const accept = req.get('accept') || '';
      
      // If this looks like a health check probe, return immediately
      const isHealthCheck = 
        !hasReferer && 
        (!userAgent || !userAgent.includes('Mozilla')) &&
        (!accept || accept === '*/*' || !accept.includes('text/html'));
      
      if (isHealthCheck) {
        return res.status(200).send('OK');
      }
      
      // Otherwise, proceed to serve the SPA
      next();
    });
    
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
