/**
 * POS Connector Routes
 * Handles Square OAuth, connection CRUD, location/item mapping, sync triggers,
 * provider registry metadata, and setup-status.
 */
import type { Express } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { squarePosConnector, buildSquareAuthUrl, buildSquareRedirectUri } from "../integrations/pos/square";
import { runBackfill, runIncrementalSync } from "../services/posSyncJobs";
import {
  getConnector,
  getProviderMetadata,
  providerSupportsElectronic,
  isKnownProvider,
  type PosProviderPublicMetadata,
} from "../integrations/pos/registry";

// ── HMAC-signed state helpers (mirrors QB OAuth pattern) ─────────────────────
export function createSignedState(data: any): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64");
  const sig = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "fallback-secret")
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

export function verifySignedState(signedState: string): any {
  const dotIdx = signedState.lastIndexOf(".");
  if (dotIdx === -1) throw new Error("Invalid state format");
  const payload = signedState.slice(0, dotIdx);
  const sig = signedState.slice(dotIdx + 1);
  const expected = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "fallback-secret")
    .update(payload)
    .digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex")))
    throw new Error("Invalid state signature");
  return JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
}

// ── Single-use nonce registry (in-memory; expires after 90 min) ───────────────
// Prevents OAuth state replay attacks on the reconnect flow.
const consumedNonces = new Map<string, number>(); // nonce → consumedAt ms
const NONCE_TTL_MS = 90 * 60 * 1000;

function registerNonce(nonce: string): void {
  // Prune expired entries opportunistically
  const now = Date.now();
  consumedNonces.forEach((t, k) => {
    if (now - t > NONCE_TTL_MS) consumedNonces.delete(k);
  });
  consumedNonces.set(nonce, now);
}

function isNonceConsumed(nonce: string): boolean {
  const t = consumedNonces.get(nonce);
  if (!t) return false;
  if (Date.now() - t > NONCE_TTL_MS) { consumedNonces.delete(nonce); return false; }
  return true;
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ── PosSetupStatus builder ──────────────────────────────────────────────────

interface PosSetupStatus {
  providerSelected: boolean;
  primaryMethodSelected: boolean;
  connectorAvailable: boolean;
  connectionStatus: "not_configured" | "not_connected" | "connected" | "disconnected" | "error";
  locations: { total: number; mapped: number; ignored: number; unresolved: number };
  items: { total: number; mapped: number; ignored: number; unresolved: number };
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  latestSyncStatus: string | null;
  warningCount: number;
}

async function buildPosSetupStatus(companyId: string): Promise<PosSetupStatus> {
  const company = await storage.getCompany(companyId);

  const posProvider = company?.posProvider ?? null;
  const primarySalesMethod = (company as any)?.primarySalesMethod ?? null;

  const providerSelected = !!posProvider && posProvider !== "none" && posProvider !== null;
  const primaryMethodSelected = !!primarySalesMethod;
  const connectorAvailable = providerSelected ? providerSupportsElectronic(posProvider!) : false;

  // Find any retained (non-released) connection
  const conn = await storage.getRetainedPosConnectionForCompany(companyId);

  let connectionStatus: PosSetupStatus["connectionStatus"] = "not_configured";
  if (conn) {
    if (conn.status === "active") connectionStatus = "connected";
    else if (conn.status === "disconnected") connectionStatus = "disconnected";
    else if (conn.status === "error") connectionStatus = "error";
    else connectionStatus = "not_connected"; // released or unknown
  } else if (primarySalesMethod === "pos_connector") {
    connectionStatus = "not_connected";
  }

  // Location counts
  let locations = { total: 0, mapped: 0, ignored: 0, unresolved: 0 };
  let items = { total: 0, mapped: 0, ignored: 0, unresolved: 0 };
  let lastSuccessfulSyncAt: string | null = null;
  let lastAttemptedSyncAt: string | null = null;
  let latestSyncStatus: string | null = null;
  let warningCount = 0;

  if (conn && conn.status !== "released") {
    const locationMappings = await storage.getPosLocationMappings(conn.id);
    const total = locationMappings.length;
    const mapped = locationMappings.filter((m) => !!m.storeId).length;
    // "ignored" requires an explicit ignore flag not yet in the schema — 0 for now.
    // unresolved = rows the user has not acted on at all (neither mapped nor ignored)
    locations = { total, mapped, ignored: 0, unresolved: total - mapped };

    const itemMappings = await storage.getPosItemMappings(conn.id);
    const iTotal = itemMappings.length;
    const iMapped = itemMappings.filter((m) => !!m.menuItemId).length;
    items = { total: iTotal, mapped: iMapped, ignored: 0, unresolved: iTotal - iMapped };

    const recentJobs = await storage.getPosSyncJobs(conn.id, 20);
    if (recentJobs.length > 0) {
      // Most-recently-attempted (any status)
      lastAttemptedSyncAt = recentJobs[0].completedAt?.toISOString() ?? recentJobs[0].createdAt?.toISOString() ?? null;
      latestSyncStatus = recentJobs[0].status;

      // Last successful
      const successJob = recentJobs.find((j) => j.status === "completed");
      lastSuccessfulSyncAt = successJob?.completedAt?.toISOString() ?? null;

      // Warning count — jobs with errorMessage or non-empty adhocItems (last 20)
      warningCount = recentJobs.filter((j) => {
        if (j.errorMessage) return true;
        const adhoc = j.adhocItems as any;
        return Array.isArray(adhoc) && adhoc.length > 0;
      }).length;
    }
  }

  return {
    providerSelected,
    primaryMethodSelected,
    connectorAvailable,
    connectionStatus,
    locations,
    items,
    lastSuccessfulSyncAt,
    lastAttemptedSyncAt,
    latestSyncStatus,
    warningCount,
  };
}

export function registerPosRoutes(app: Express): void {

  // Log the computed Square callback URI at startup so VPS operators know exactly
  // what must be registered in the Square Developer Dashboard.
  console.info(
    `[POS] Square OAuth callback URI: ${buildSquareRedirectUri()}` +
    (process.env.APP_BASE_URL ? "" : " (set APP_BASE_URL in production)"),
  );

  // ── Provider registry (public) ────────────────────────────────────────────

  /** List all known POS providers with their availability and capabilities. */
  app.get("/api/pos/providers", (_req, res) => {
    res.json(getProviderMetadata());
  });

  // ── Setup status ──────────────────────────────────────────────────────────

  /** Full POS setup status for the active company. */
  app.get("/api/pos/setup-status", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const status = await buildPosSetupStatus(companyId);
      res.json(status);
    } catch (error: any) {
      console.error("[POS] Setup status error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ── OAuth ─────────────────────────────────────────────────────────────────

  /** Initiate Square OAuth */
  app.get("/api/pos/connect/square", requireAuth, (req, res) => {
    try {
      const companyId = (req as any).companyId;
      if (!companyId) {
        return res.status(400).json({ error: "No company selected" });
      }
      if (!process.env.SQUARE_APP_ID) {
        return res.status(503).json({ error: "Square integration is not configured on this server" });
      }

      const reqUser = (req as any).user;
      const stateData = {
        companyId,
        userId: reqUser?.id,
        timestamp: Date.now(),
      };
      const state = createSignedState(stateData);

      const authUrl = buildSquareAuthUrl(state, buildSquareRedirectUri());
      res.redirect(authUrl);
    } catch (error: any) {
      console.error("[POS] Square connect error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  /** Initiate Square OAuth for reconnecting an existing disconnected connection */
  app.get("/api/pos/connect/square/reconnect/:connectionId", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      if (!process.env.SQUARE_APP_ID) {
        return res.status(503).json({ error: "Square integration is not configured on this server" });
      }

      const connection = await storage.getPosConnectionById(req.params.connectionId);
      if (!connection || connection.companyId !== companyId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      const reqUser = (req as any).user;
      const nonce = generateNonce();
      const stateData = {
        companyId,
        userId: reqUser?.id,
        connectionId: connection.id,
        nonce,
        timestamp: Date.now(),
      };
      const state = createSignedState(stateData);

      const authUrl = buildSquareAuthUrl(state, buildSquareRedirectUri());
      res.redirect(authUrl);
    } catch (error: any) {
      console.error("[POS] Square reconnect error:", error.message);
      res.redirect("/settings?tab=connections&pos_error=reconnect_failed");
    }
  });

  /** Square OAuth callback — handles both new connections and reconnects */
  app.get("/api/pos/oauth/square/callback", async (req, res) => {
    try {
      const { code, state, error: oauthError } = req.query;

      if (oauthError) {
        console.error("[POS] Square OAuth denied:", oauthError);
        return res.redirect("/settings?tab=connections&pos_error=access_denied");
      }

      if (!code || typeof code !== "string" || !state || typeof state !== "string") {
        return res.redirect("/settings?tab=connections&pos_error=missing_params");
      }

      let stateData: any;
      try {
        stateData = verifySignedState(state);
      } catch {
        return res.redirect("/settings?tab=connections&pos_error=state_invalid");
      }

      if (Date.now() - stateData.timestamp > 60 * 60 * 1000) {
        return res.redirect("/settings?tab=connections&pos_error=state_expired");
      }

      const { companyId, userId, connectionId, nonce } = stateData;

      // ── Reconnect path ─────────────────────────────────────────────────────
      if (connectionId) {
        // Enforce single-use: reject replayed state tokens
        if (nonce && isNonceConsumed(nonce)) {
          return res.redirect("/settings?tab=connections&pos_error=state_replayed");
        }
        if (nonce) registerNonce(nonce);

        const existing = await storage.getPosConnectionById(connectionId);
        if (!existing || existing.companyId !== companyId) {
          return res.redirect("/settings?tab=connections&pos_error=connection_not_found");
        }

        // Exchange code for new tokens
        const tokens = await squarePosConnector.exchangeCode(code);

        // Verify the same merchant is reconnecting — reject mismatches silently
        if (tokens.merchantId !== existing.merchantId) {
          console.warn(
            `[POS] Reconnect merchant mismatch: expected ${existing.merchantId}, got ${tokens.merchantId}`,
          );
          return res.redirect("/settings?tab=connections&pos_error=merchant_mismatch");
        }

        // Restore the existing connection with fresh tokens; preserve all mappings
        await storage.updatePosConnection(connectionId, companyId, {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? existing.refreshToken,
          tokenExpiresAt: tokens.tokenExpiresAt,
          status: "active",
          updatedAt: new Date(),
        });

        // Refresh location timezone metadata so the nightly scheduler has accurate
        // IANA zones even if the merchant changed their Square location settings.
        try {
          const { backfillLocationTimezones } = await import("../services/posSyncJobs");
          await backfillLocationTimezones(connectionId);
        } catch (tzErr: any) {
          // Non-fatal — tokens are already updated, log and continue
          console.warn("[POS] Failed to refresh location timezones on reconnect:", tzErr.message);
        }

        console.info(`[POS] Connection ${connectionId} reconnected for merchant ${tokens.merchantId}`);
        return res.redirect("/settings?tab=connections&pos_reconnected=1");
      }

      // ── New connection path ────────────────────────────────────────────────
      // One-connection-per-company guard: if a retained (non-released) connection
      // already exists, redirect to the reconnect flow instead of creating a duplicate.
      const existingConn = await storage.getRetainedPosConnectionForCompany(companyId);
      if (existingConn) {
        console.warn(
          `[POS] Company ${companyId} already has a retained connection ${existingConn.id} ` +
          `(status: ${existingConn.status}) — redirecting to reconnect`,
        );
        return res.redirect(
          `/settings?tab=connections&pos_error=connection_already_exists`,
        );
      }

      const tokens = await squarePosConnector.exchangeCode(code);

      const connection = await storage.createPosConnection({
        companyId,
        provider: "square",
        merchantId: tokens.merchantId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.tokenExpiresAt,
        status: "active",
        connectedByUserId: userId,
      });

      // Auto-fetch and seed locations for this connection
      try {
        const locations = await squarePosConnector.listLocations(tokens.accessToken);
        if (locations.length > 0) {
          await storage.upsertPosLocationMappings(
            connection.id,
            companyId,
            locations.map((loc) => ({
              externalLocationId: loc.externalId,
              externalLocationName: loc.name,
              storeId: null,
              externalTimezone: loc.timezone ?? null,
            })),
          );
        }
      } catch (locErr: any) {
        console.warn("[POS] Failed to prefetch locations:", locErr.message);
      }

      res.redirect(`/pos/location-mapping/${connection.id}?connected=1`);
    } catch (error: any) {
      console.error("[POS] Square callback error:", error.message);
      res.redirect("/settings?tab=connections&pos_error=true");
    }
  });

  // ── Connection CRUD ────────────────────────────────────────────────────────

  app.get("/api/pos/connections", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      if (!companyId) return res.json([]);
      const connections = await storage.getPosConnections(companyId);
      res.json(connections.map((c) => ({
        id: c.id,
        provider: c.provider,
        merchantId: c.merchantId,
        status: c.status,
        lastSyncedAt: c.lastSyncedAt,
        createdAt: c.createdAt,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/pos/connections/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      await storage.deletePosConnection(req.params.id, companyId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Location Mappings ──────────────────────────────────────────────────────

  app.get("/api/pos/connections/:id/locations", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const connection = await storage.getPosConnectionById(req.params.id);
      if (!connection || connection.companyId !== companyId) {
        return res.status(404).json({ error: "Connection not found" });
      }
      // Return saved location mappings plus live Square locations
      const saved = await storage.getPosLocationMappings(req.params.id);
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/pos/connections/:id/location-mappings", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const connection = await storage.getPosConnectionById(req.params.id);
      if (!connection || connection.companyId !== companyId) {
        return res.status(404).json({ error: "Connection not found" });
      }
      const { mappings } = req.body;
      if (!Array.isArray(mappings)) {
        return res.status(400).json({ error: "mappings must be an array" });
      }
      const result = await storage.upsertPosLocationMappings(req.params.id, companyId, mappings);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Catalog / Item Mappings ────────────────────────────────────────────────

  app.get("/api/pos/connections/:id/catalog", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const connection = await storage.getPosConnectionById(req.params.id);
      if (!connection || connection.companyId !== companyId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      // Fetch catalog via the registry — works for any provider, not just Square
      const connectorResult = getConnector(connection.provider);
      if (connectorResult.kind !== "available") {
        return res.status(400).json({ error: `No electronic connector available for provider: ${connection.provider}` });
      }
      const variations = await connectorResult.connector.retrieveCatalog(connection.accessToken);

      // Load existing mappings and FnB menu items for auto-matching
      const existingMappings = await storage.getPosItemMappings(req.params.id);
      const mappingByVariation = new Map(existingMappings.map((m) => [m.externalVariationId, m]));
      const menuItems = await storage.getMenuItemsByCompany(companyId);

      // Auto-suggest by name similarity (exact or prefix match, case-insensitive)
      const suggestMenuItemId = (itemName: string, variationName: string): string | null => {
        const target = `${itemName} ${variationName}`.toLowerCase().trim();
        const nameOnly = itemName.toLowerCase().trim();

        let bestMatch: { id: string; score: number } | null = null;
        for (const mi of menuItems) {
          const miName = mi.name.toLowerCase().trim();
          let score = 0;
          if (miName === target) score = 3;
          else if (miName === nameOnly) score = 2;
          else if (miName.includes(nameOnly) || nameOnly.includes(miName)) score = 1;
          if (score > (bestMatch?.score ?? 0)) bestMatch = { id: mi.id, score };
        }
        return bestMatch?.score ? bestMatch.id : null;
      };

      const enriched = variations.map((v) => {
        const existing = mappingByVariation.get(v.externalVariationId);
        return {
          externalItemId: v.externalItemId,
          externalVariationId: v.externalVariationId,
          externalItemName: v.itemName,
          externalVariationName: v.variationName,
          menuItemId: existing?.menuItemId ?? suggestMenuItemId(v.itemName, v.variationName),
          isMapped: !!existing?.menuItemId,
          isModifier: v.isModifier ?? false,
        };
      });

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/pos/connections/:id/item-mappings", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const connection = await storage.getPosConnectionById(req.params.id);
      if (!connection || connection.companyId !== companyId) {
        return res.status(404).json({ error: "Connection not found" });
      }
      const { mappings } = req.body;
      if (!Array.isArray(mappings)) {
        return res.status(400).json({ error: "mappings must be an array" });
      }
      const result = await storage.upsertPosItemMappings(req.params.id, companyId, mappings);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Sync ──────────────────────────────────────────────────────────────────

  app.post("/api/pos/connections/:id/sync", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const connection = await storage.getPosConnectionById(req.params.id);
      if (!connection || connection.companyId !== companyId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      // Reject sync attempts on inactive/disconnected connections BEFORE acquiring the
      // lock — otherwise the lock row would be left stuck in `running` for 30 min.
      if (connection.status !== "active") {
        return res.status(400).json({ error: "Connection is not active — reconnect Square before syncing" });
      }

      const { type = "incremental", days = 30 } = req.body;

      // Atomically acquire the sync lock by inserting the job row.
      // The partial unique index on pos_sync_jobs(connection_id) WHERE status='running'
      // ensures only one running job per connection can ever exist — two concurrent
      // requests cannot both succeed here.
      const lock = await storage.tryAcquirePosSyncLock({
        connectionId: req.params.id,
        companyId,
        jobType: type === "backfill" ? "backfill" : "incremental",
        status: "running",
        startedAt: new Date(),
        ...(type === "backfill" ? { daysBackfilled: Number(days) } : {}),
      });

      if (!lock.acquired) {
        return res.status(409).json({
          error: "A sync is already in progress for this connection",
          alreadyRunning: true,
          jobId: lock.existingJobId,
          startedAt: lock.existingStartedAt,
        });
      }

      // Lock acquired — return 200 immediately and execute in background using the
      // pre-created job row (skipping the lock-acquisition step inside the functions).
      res.json({ ok: true, message: `${type} sync started` });

      if (type === "backfill") {
        runBackfill(req.params.id, Number(days), lock.job).catch((err) =>
          console.error("[POS] Backfill error:", err.message),
        );
      } else {
        runIncrementalSync(req.params.id, lock.job).catch((err) =>
          console.error("[POS] Incremental sync error:", err.message),
        );
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/pos/connections/:id/sync-jobs", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const connection = await storage.getPosConnectionById(req.params.id);
      if (!connection || connection.companyId !== companyId) {
        return res.status(404).json({ error: "Connection not found" });
      }
      const jobs = await storage.getPosSyncJobs(req.params.id, 10);

      // Derive a plain-English error category for each failed job so the UI
      // can surface specific guidance (reconnect vs fix mappings).
      const enriched = jobs.map((job) => {
        let errorCategory: "token_expired" | "mapping_gap" | "unknown" | null = null;
        if (job.status === "failed") {
          const msg = (job.errorMessage ?? "").toLowerCase();
          if (
            msg.includes("revoked") ||
            msg.includes("access_token") ||
            msg.includes("unauthorized") ||
            msg.includes("token expired") ||
            msg.includes("401")
          ) {
            errorCategory = "token_expired";
          } else if (
            (job.rowsSkipped ?? 0) > 0 ||
            msg.includes("no menu item") ||
            msg.includes("no mapped location") ||
            msg.includes("mapping")
          ) {
            errorCategory = "mapping_gap";
          } else {
            errorCategory = "unknown";
          }
        }
        return { ...job, errorCategory };
      });

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
