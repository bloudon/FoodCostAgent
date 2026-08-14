import 'dotenv/config';
import { app, initApp } from "./app";
import { registerRoutes, setupWebSocket } from "./routes";
import { logger } from "./lib/logger";
import { seedDatabase } from "./seed";
import { storage } from "./storage";
import { initObjectStorageCleanup } from "./objectStorageCleanup";
import { ensureAccountingClassificationSchema } from "./services/accountingClassificationMigration";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

(async () => {
  // Auth/SSO initialization must complete before any routes are registered
  // or traffic is served. A failure here (e.g. OIDC discovery/config error)
  // is fatal by design — never serve with authentication half-initialized.
  try {
    await initApp();
  } catch (err) {
    logger.error({ err }, "Fatal: SSO/auth initialization failed — refusing to start");
    process.exit(1);
  }

  try {
    await ensureAccountingClassificationSchema();
    // seedDatabase is optional; skip if it throws
    await seedDatabase().catch((e) => logger.warn({ err: e }, "seed skipped"));
  } catch (_) {}

  const server = await registerRoutes(app);

  // Initialize WebSocket for real-time POS streaming (/ws/pos)
  setupWebSocket(server);

  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    logger.error({ err }, "Unhandled error");
  });

  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    logger.info({ port }, "Server listening");
  });

  // Start periodic cleanup of abandoned (unclaimed) object-storage uploads.
  initObjectStorageCleanup();
})();
