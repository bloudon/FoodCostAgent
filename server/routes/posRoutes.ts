/**
 * POS Connector Routes
 * Handles Square OAuth, connection CRUD, location/item mapping, and sync triggers.
 */
import type { Express } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { squarePosConnector, buildSquareAuthUrl } from "../integrations/pos/square";
import { runBackfill, runIncrementalSync } from "../services/posSyncJobs";

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

export function registerPosRoutes(app: Express): void {

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

      const replitDomain = process.env.REPLIT_DEV_DOMAIN;
      const redirectUri = replitDomain
        ? `https://${replitDomain}/api/pos/oauth/square/callback`
        : `http://localhost:5000/api/pos/oauth/square/callback`;

      const authUrl = buildSquareAuthUrl(state, redirectUri);
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

      const replitDomain = process.env.REPLIT_DEV_DOMAIN;
      const redirectUri = replitDomain
        ? `https://${replitDomain}/api/pos/oauth/square/callback`
        : `http://localhost:5000/api/pos/oauth/square/callback`;

      const authUrl = buildSquareAuthUrl(state, redirectUri);
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

        console.info(`[POS] Connection ${connectionId} reconnected for merchant ${tokens.merchantId}`);
        return res.redirect("/settings?tab=connections&pos_reconnected=1");
      }

      // ── New connection path ────────────────────────────────────────────────
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

      // Fetch Square catalog
      const variations = await squarePosConnector.retrieveCatalog(connection.accessToken);

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
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
