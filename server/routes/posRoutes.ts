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
function createSignedState(data: any): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64");
  const sig = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "fallback-secret")
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

function verifySignedState(signedState: string): any {
  const [payload, sig] = signedState.split(".");
  const expected = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "fallback-secret")
    .update(payload)
    .digest("hex");
  if (sig !== expected) throw new Error("Invalid state signature");
  return JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
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

  /** Square OAuth callback */
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

      const { companyId, userId } = stateData;

      // Exchange code for tokens
      const tokens = await squarePosConnector.exchangeCode(code);

      // Create connection record
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
              storeId: null, // user maps in the next step
            })),
          );
        }
      } catch (locErr: any) {
        console.warn("[POS] Failed to prefetch locations:", locErr.message);
      }

      // Redirect to the location mapping wizard
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

      const { type = "incremental", days = 30 } = req.body;

      // Run sync in background, return immediately
      res.json({ ok: true, message: `${type} sync started` });

      if (type === "backfill") {
        runBackfill(req.params.id, Number(days)).catch((err) =>
          console.error("[POS] Backfill error:", err.message),
        );
      } else {
        runIncrementalSync(req.params.id).catch((err) =>
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
