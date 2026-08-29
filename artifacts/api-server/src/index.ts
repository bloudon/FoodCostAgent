import 'dotenv/config';
import { app, initApp } from "./app";
import { registerRoutes, setupWebSocket } from "./routes";
import { logger } from "./lib/logger";
import { seedDatabase } from "./seed";
import { storage } from "./storage";
import { initObjectStorageCleanup } from "./objectStorageCleanup";
import { ensureAccountingClassificationSchema } from "./services/accountingClassificationMigration";
import { ensureInventoryItemRemediationSchema } from "./migrations/inventoryItemRemediation";
import { ensureHistoricalSessionUnresolvedRowsSchema } from "./migrations/historicalSessionUnresolvedRows";
import { ensureVendorItemUniquenessSchema } from "./migrations/vendorItemUniqueness";
import { ensureInventoryItemNumberSchema } from "./migrations/inventoryItemNumbers";
import { ensureOrderlyPackIdentityEvidenceSchema } from "./migrations/orderlyPackIdentityEvidence";
import { ensureOrderlyReviewDecisionsSchema } from "./migrations/orderlyReviewDecisions";
import { ensureOrderlyApprovalJobsSchema } from "./migrations/orderlyApprovalJobs";
import { db } from "./db";
import { startApprovalJobRecovery } from "./services/orderly/orderlyApprovalJobs";

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

  // The duplicate-remediation audit table and supersession columns are required
  // before the remediation apply path can run at all: it writes its audit row in
  // the SAME transaction as the repair, so a missing table would roll a repair
  // back mid-flight. Unlike the fire-and-forget migrations in routes.ts, this is
  // awaited and fatal — serving with this schema absent is a silent trap rather
  // than a degraded feature.
  try {
    await ensureInventoryItemNumberSchema(db);
    logger.info("[Migration] inventory item numbers ready");
  } catch (err) {
    logger.error({ err }, "Fatal: inventory item number schema initialization failed — refusing to start");
    process.exit(1);
  }

  try {
    await ensureInventoryItemRemediationSchema(db);
    logger.info("[Migration] inventory item remediation schema ready (supersession + audit)");
  } catch (err) {
    logger.error(
      { err },
      "Fatal: inventory item remediation schema initialization failed — refusing to start",
    );
    process.exit(1);
  }

  try {
    await ensureHistoricalSessionUnresolvedRowsSchema(db);
    logger.info("[Migration] historical unresolved-row schema ready");
  } catch (err) {
    logger.error({ err }, "Fatal: historical unresolved-row schema initialization failed");
    process.exit(1);
  }

  // Vendor-item uniqueness invariant (PM-approved after the Gate 2 duplicate
  // cleanup). Verifies live data BEFORE creating the partial unique index and
  // fails closed if violating rows exist — serving without the invariant would
  // silently re-open the duplicate-creation defect this closes.
  try {
    await ensureVendorItemUniquenessSchema(db);
    logger.info("[Migration] vendor item uniqueness index ready");
  } catch (err) {
    logger.error({ err }, "Fatal: vendor item uniqueness initialization failed — refusing to start");
    process.exit(1);
  }

  try {
    await ensureOrderlyPackIdentityEvidenceSchema(db);
    logger.info("[Migration] Orderly pack identity evidence schema ready");
  } catch (err) {
    logger.error({ err }, "Fatal: Orderly pack identity evidence schema initialization failed — refusing to start");
    process.exit(1);
  }

  try {
    await ensureOrderlyReviewDecisionsSchema(db);
    logger.info("[Migration] Orderly review decisions schema ready");
  } catch (err) {
    logger.error({ err }, "Fatal: Orderly review decisions schema initialization failed — refusing to start");
    process.exit(1);
  }

  try {
    await ensureOrderlyApprovalJobsSchema(db);
    logger.info("[Migration] Orderly approval jobs schema ready");
  } catch (err) {
    logger.error({ err }, "Fatal: Orderly approval jobs schema initialization failed — refusing to start");
    process.exit(1);
  }

  try {
    await ensureAccountingClassificationSchema();
    logger.info("[Migration] accounting classification and import schema ready");
  } catch (err) {
    logger.error({ err }, "Fatal: accounting schema initialization failed — refusing to start");
    process.exit(1);
  }
  // seedDatabase is optional; skip if it throws
  await seedDatabase().catch((e) => logger.warn({ err: e }, "seed skipped"));

  const server = await registerRoutes(app);
  await startApprovalJobRecovery();

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
