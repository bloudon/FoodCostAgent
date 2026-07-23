/**
 * Extension Pilot — API Routes
 *
 * All routes live under /api/extension.
 * Authentication: web-session routes use requireAuth middleware.
 *                 extension-facing routes use requireExtensionToken (bearer).
 *
 * Route map:
 *   POST /api/extension/pair-code              — web session; create pairing code
 *   POST /api/extension/pair-code/claim        — extension; claim code → token
 *   GET  /api/extension/pair-status/:jobId     — web session; poll after pairing
 *   POST /api/extension/sync-jobs              — web session; create sync job
 *   GET  /api/extension/sync-jobs/:id          — web session OR ext bearer
 *   POST /api/extension/sync-jobs/:id/events   — ext bearer; send lifecycle event
 *   POST /api/extension/sync-jobs/:id/ingest   — ext bearer; submit captured batch
 *   POST /api/extension/tokens/:id/revoke      — web session; revoke token
 */

import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "../../db";
import { eq, and, lt, sql } from "drizzle-orm";
import {
  extensionPairingCodes,
  extensionTokens,
  extensionSyncJobs,
} from "../../../shared/schema";
import { ingestExtensionBatch } from "./extensionIngestionService";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAIRING_CODE_TTL_MS = 120_000; // 2 minutes
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_CLAIMS = 5; // per installationId per hour

// Allowed non-terminal statuses the extension may report
const EXTENSION_EVENTS = [
  "portal_opened",
  "capture_started",
  "ingestion_submitted",
  "auth_required",
  "capture_failed",
] as const;

type ExtensionEvent = typeof EXTENSION_EVENTS[number];

// Status the server transitions to for each event
const EVENT_STATUS_MAP: Record<ExtensionEvent, string> = {
  portal_opened: "PORTAL_OPEN",
  capture_started: "CAPTURING",
  ingestion_submitted: "SUBMITTING",
  auth_required: "AUTH_REQUIRED",
  capture_failed: "FAILED",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateCode(): string {
  // 9-char base-32 ish (uppercase alpha + digits, no ambiguous chars)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(9);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex"); // 64-char hex
}

// ─── Extension Bearer Auth Middleware ─────────────────────────────────────────

interface ExtensionAuthRequest extends Request {
  extensionToken?: typeof extensionTokens.$inferSelect;
}

async function requireExtensionToken(
  req: ExtensionAuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Extension bearer token required" });
  }
  const raw = header.slice(7).trim();
  if (!raw) return res.status(401).json({ error: "Empty token" });

  const [row] = await db
    .select()
    .from(extensionTokens)
    .where(eq(extensionTokens.token, raw))
    .limit(1);

  if (!row) return res.status(401).json({ error: "Invalid token" });
  if (row.revokedAt) return res.status(401).json({ error: "Token revoked" });
  if (new Date() > row.expiresAt) return res.status(401).json({ error: "Token expired" });

  req.extensionToken = row;
  next();
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const createPairCodeSchema = z.object({
  connectorId: z.string().min(1),
  vendorId: z.string().optional(),
  storeId: z.string().optional(),
  customerSupplierConnectionId: z.string().optional(),
  externalSupplierId: z.string().optional(),
  externalSupplierName: z.string().optional(),
  externalLocationId: z.string().optional(),
  externalOrderGuideId: z.string().optional(),
});

const claimPairCodeSchema = z.object({
  code: z.string().min(6).max(16).transform((s) => s.trim().toUpperCase()),
  installationId: z.string().min(1).max(128),
});

const createSyncJobSchema = z.object({
  connectorId: z.string().min(1),
  vendorId: z.string().optional(),
  storeId: z.string().optional(),
  customerSupplierConnectionId: z.string().optional(),
  externalSupplierId: z.string().optional(),
  externalSupplierName: z.string().optional(),
  externalLocationId: z.string().optional(),
  externalOrderGuideId: z.string().optional(),
});

const sendEventSchema = z.object({
  event: z.enum(EXTENSION_EVENTS),
  detail: z.string().optional(),
});

const ingestSchema = z.object({
  batchId: z.string().min(1),
  extensionVersion: z.string().optional(),
  parserVersion: z.string().optional(),
  capturedAt: z.string(),
  sourceUrl: z.string().optional(),
  capturedExternalSupplierId: z.string().optional(),
  capturedExternalSupplierName: z.string().optional(),
  capturedExternalLocationId: z.string().optional(),
  capturedExternalOrderGuideId: z.string().optional(),
  items: z
    .array(
      z.object({
        supplierSku: z.string().min(1),
        rawDescription: z.string(),
        rawPackSize: z.string().nullable().optional(),
        rawCasePrice: z.string().nullable().optional(),
        rawUnitPrice: z.string().nullable().optional(),
        currency: z.string().default("USD"),
        priceEffective: z.string().nullable().optional(),
        sourceItemId: z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(2000),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerExtensionRoutes(router: Router) {
  /**
   * POST /api/extension/pair-code
   * Web session auth. Creates a short-lived pairing code and an associated
   * (empty) sync job so the extension can inherit context on claim.
   */
  router.post("/pair-code", async (req: any, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Authentication required" });

      const parsed = createPairCodeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      const { connectorId, vendorId, storeId, customerSupplierConnectionId,
              externalSupplierId, externalSupplierName, externalLocationId, externalOrderGuideId } = parsed.data;
      const companyId = req.user.companyId as string;
      const userId = req.user.id as string;

      const rawCode = generateCode();
      const codeHash = sha256hex(rawCode);
      const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

      // Create a pending sync job that the pairing code will bind to
      const [job] = await db
        .insert(extensionSyncJobs)
        .values({
          companyId,
          userId,
          connectorId,
          vendorId: vendorId ?? null,
          storeId: storeId ?? null,
          customerSupplierConnectionId: customerSupplierConnectionId ?? null,
          externalSupplierId: externalSupplierId ?? null,
          externalSupplierName: externalSupplierName ?? null,
          externalLocationId: externalLocationId ?? null,
          externalOrderGuideId: externalOrderGuideId ?? null,
          status: "PENDING",
        })
        .returning();

      await db.insert(extensionPairingCodes).values({
        companyId,
        userId,
        connectorId,
        codeHash,
        expiresAt,
        tokenId: job.id, // reuse this field to carry jobId until token is issued
      });

      return res.status(201).json({
        data: {
          code: rawCode,
          jobId: job.id,
          expiresIn: PAIRING_CODE_TTL_MS / 1000,
          connectorId,
        },
      });
    } catch (err) {
      console.error("[Extension] POST /pair-code error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/extension/pair-code/claim
   * No prior auth required. Extension submits code + installationId.
   * Returns a scoped bearer token and the sync job ID.
   */
  router.post("/pair-code/claim", async (req: Request, res: Response) => {
    try {
      const parsed = claimPairCodeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      const { code, installationId } = parsed.data;
      const codeHash = sha256hex(code);

      // Rate limit: max RATE_LIMIT_MAX_CLAIMS claims per installationId per hour
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
      const recentClaims = await db
        .select()
        .from(extensionPairingCodes)
        .where(
          and(
            eq(extensionPairingCodes.installationId, installationId),
            sql`${extensionPairingCodes.claimedAt} > ${windowStart}`
          )
        );
      if (recentClaims.length >= RATE_LIMIT_MAX_CLAIMS) {
        return res.status(429).json({ error: "Too many claim attempts. Try again later." });
      }

      // Look up by hash
      const [row] = await db
        .select()
        .from(extensionPairingCodes)
        .where(eq(extensionPairingCodes.codeHash, codeHash))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Invalid or expired code" });
      if (row.claimedAt) return res.status(409).json({ error: "Code already claimed" });
      if (new Date() > row.expiresAt) return res.status(410).json({ error: "Code expired" });

      // The job ID was stashed in tokenId field during creation
      const jobId = row.tokenId;
      if (!jobId) return res.status(500).json({ error: "Pairing code has no associated job" });

      // Load job for scope
      const [job] = await db
        .select()
        .from(extensionSyncJobs)
        .where(eq(extensionSyncJobs.id, jobId))
        .limit(1);
      if (!job) return res.status(404).json({ error: "Associated sync job not found" });

      // Issue token
      const rawToken = generateToken();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      const scope = {
        companyId: row.companyId,
        connectorId: row.connectorId,
        userId: row.userId,
        vendorId: job.vendorId ?? null,
        storeId: job.storeId ?? null,
        permissions: ["catalog:write"],
      };

      const [tokenRow] = await db
        .insert(extensionTokens)
        .values({
          companyId: row.companyId,
          userId: row.userId,
          connectorId: row.connectorId,
          installationId,
          token: rawToken,
          scope,
          expiresAt,
        })
        .returning();

      // Atomically mark the code as claimed and bind token + installationId
      await db
        .update(extensionPairingCodes)
        .set({
          claimedAt: new Date(),
          installationId,
          tokenId: tokenRow.id,
        })
        .where(eq(extensionPairingCodes.id, row.id));

      // Bind token to sync job
      await db
        .update(extensionSyncJobs)
        .set({ tokenId: tokenRow.id, updatedAt: new Date() })
        .where(eq(extensionSyncJobs.id, jobId));

      return res.status(200).json({
        data: {
          token: rawToken,
          tokenId: tokenRow.id,
          jobId,
          expiresAt: expiresAt.toISOString(),
          scope,
        },
      });
    } catch (err) {
      console.error("[Extension] POST /pair-code/claim error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/extension/pair-status/:jobId
   * Web session polls this after showing the pairing code to the user.
   */
  router.get("/pair-status/:jobId", async (req: any, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Authentication required" });

      const { jobId } = req.params;
      const companyId = req.user.companyId as string;

      const [job] = await db
        .select()
        .from(extensionSyncJobs)
        .where(
          and(
            eq(extensionSyncJobs.id, jobId),
            eq(extensionSyncJobs.companyId, companyId)
          )
        )
        .limit(1);

      if (!job) return res.status(404).json({ error: "Job not found" });

      const paired = !!job.tokenId;
      return res.json({ data: { status: job.status, paired, jobId: job.id } });
    } catch (err) {
      console.error("[Extension] GET /pair-status error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/extension/sync-jobs
   * Web session. Creates a sync job directly (used when extension is already paired
   * and the user initiates a new sync from the web app).
   */
  router.post("/sync-jobs", async (req: any, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Authentication required" });

      const parsed = createSyncJobSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      const companyId = req.user.companyId as string;
      const userId = req.user.id as string;

      const [job] = await db
        .insert(extensionSyncJobs)
        .values({
          companyId,
          userId,
          ...parsed.data,
          vendorId: parsed.data.vendorId ?? null,
          storeId: parsed.data.storeId ?? null,
          customerSupplierConnectionId: parsed.data.customerSupplierConnectionId ?? null,
          externalSupplierId: parsed.data.externalSupplierId ?? null,
          externalSupplierName: parsed.data.externalSupplierName ?? null,
          externalLocationId: parsed.data.externalLocationId ?? null,
          externalOrderGuideId: parsed.data.externalOrderGuideId ?? null,
          status: "PENDING",
        })
        .returning();

      return res.status(201).json({ data: job });
    } catch (err) {
      console.error("[Extension] POST /sync-jobs error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/extension/sync-jobs/:id
   * Web session OR extension bearer. Returns full job state.
   */
  router.get("/sync-jobs/:id", async (req: any, res: Response) => {
    try {
      const { id } = req.params;

      // Accept web session or extension bearer
      const webUser = req.user;
      const extToken: any = (req as any).extensionToken;

      // Try extension bearer first (middleware not applied here — check header manually)
      let companyId: string | null = null;
      if (webUser) {
        companyId = webUser.companyId;
      } else {
        // Attempt manual token check
        const header = req.headers.authorization;
        if (header?.startsWith("Bearer ")) {
          const raw = header.slice(7).trim();
          const [tokenRow] = await db
            .select()
            .from(extensionTokens)
            .where(eq(extensionTokens.token, raw))
            .limit(1);
          if (tokenRow && !tokenRow.revokedAt && new Date() <= tokenRow.expiresAt) {
            companyId = tokenRow.companyId;
          }
        }
      }

      if (!companyId) return res.status(401).json({ error: "Authentication required" });

      const [job] = await db
        .select()
        .from(extensionSyncJobs)
        .where(
          and(
            eq(extensionSyncJobs.id, id),
            eq(extensionSyncJobs.companyId, companyId)
          )
        )
        .limit(1);

      if (!job) return res.status(404).json({ error: "Job not found" });
      return res.json({ data: job });
    } catch (err) {
      console.error("[Extension] GET /sync-jobs/:id error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/extension/sync-jobs/:id/events
   * Extension bearer only. Extension reports a lifecycle event; server transitions status.
   */
  router.post(
    "/sync-jobs/:id/events",
    requireExtensionToken,
    async (req: ExtensionAuthRequest, res: Response) => {
      try {
        const { id } = req.params;
        const tokenRow = req.extensionToken!;

        const parsed = sendEventSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

        const { event, detail } = parsed.data;

        const [job] = await db
          .select()
          .from(extensionSyncJobs)
          .where(
            and(
              eq(extensionSyncJobs.id, id),
              eq(extensionSyncJobs.companyId, tokenRow.companyId)
            )
          )
          .limit(1);

        if (!job) return res.status(404).json({ error: "Job not found" });

        // Ignore events on terminal jobs
        if (["COMPLETE", "EXPIRED"].includes(job.status)) {
          return res.json({ data: { status: job.status, ignored: true } });
        }

        const newStatus = EVENT_STATUS_MAP[event];
        const now = new Date();
        const newEvent = { event, occurredAt: now.toISOString(), ...(detail ? { detail } : {}) };

        const errorMessage =
          event === "capture_failed"
            ? detail ?? "Capture failed"
            : event === "auth_required"
            ? "Sign-in required before prices can be refreshed."
            : job.errorMessage;

        await db
          .update(extensionSyncJobs)
          .set({
            status: newStatus,
            events: sql`${extensionSyncJobs.events} || ${JSON.stringify([newEvent])}::jsonb`,
            errorMessage: errorMessage ?? null,
            updatedAt: now,
          })
          .where(eq(extensionSyncJobs.id, id));

        return res.json({ data: { status: newStatus } });
      } catch (err) {
        console.error("[Extension] POST /sync-jobs/:id/events error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  /**
   * POST /api/extension/sync-jobs/:id/ingest
   * Extension bearer only. Submits captured catalog batch.
   * Idempotent: repeated calls with the same batchId are no-ops.
   */
  router.post(
    "/sync-jobs/:id/ingest",
    requireExtensionToken,
    async (req: ExtensionAuthRequest, res: Response) => {
      try {
        const { id } = req.params;
        const tokenRow = req.extensionToken!;

        const parsed = ingestSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

        // Verify job belongs to this token's company
        const [job] = await db
          .select()
          .from(extensionSyncJobs)
          .where(
            and(
              eq(extensionSyncJobs.id, id),
              eq(extensionSyncJobs.companyId, tokenRow.companyId)
            )
          )
          .limit(1);

        if (!job) return res.status(404).json({ error: "Job not found" });
        if (job.status === "COMPLETE") {
          return res.json({ data: { alreadyProcessed: true, status: "COMPLETE" } });
        }

        // Transition to SUBMITTING
        await db
          .update(extensionSyncJobs)
          .set({
            status: "SUBMITTING",
            events: sql`${extensionSyncJobs.events} || ${JSON.stringify([
              { event: "ingestion_submitted", occurredAt: new Date().toISOString() },
            ])}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(extensionSyncJobs.id, id));

        // Run ingestion
        const result = await ingestExtensionBatch({
          syncJobId: id,
          batchId: parsed.data.batchId,
          companyId: tokenRow.companyId,
          connectorId: tokenRow.connectorId,
          extensionVersion: parsed.data.extensionVersion,
          parserVersion: parsed.data.parserVersion,
          capturedAt: parsed.data.capturedAt,
          sourceUrl: parsed.data.sourceUrl,
          capturedExternalSupplierId: parsed.data.capturedExternalSupplierId,
          capturedExternalSupplierName: parsed.data.capturedExternalSupplierName,
          capturedExternalLocationId: parsed.data.capturedExternalLocationId,
          capturedExternalOrderGuideId: parsed.data.capturedExternalOrderGuideId,
          items: parsed.data.items.map((i) => ({
            supplierSku: i.supplierSku,
            rawDescription: i.rawDescription,
            rawPackSize: i.rawPackSize ?? null,
            rawCasePrice: i.rawCasePrice ?? null,
            rawUnitPrice: i.rawUnitPrice ?? null,
            currency: i.currency,
            priceEffective: i.priceEffective ?? null,
            sourceItemId: i.sourceItemId ?? null,
          })),
        });

        // Transition to COMPLETE (server owns this — only after validated ingestion)
        const now = new Date();
        await db
          .update(extensionSyncJobs)
          .set({
            status: "COMPLETE",
            orderGuideId: result.orderGuideId,
            itemCount: result.itemsUpdated,
            completedAt: now,
            updatedAt: now,
            events: sql`${extensionSyncJobs.events} || ${JSON.stringify([
              { event: "complete", occurredAt: now.toISOString() },
            ])}::jsonb`,
          })
          .where(eq(extensionSyncJobs.id, id));

        return res.status(result.alreadyProcessed ? 200 : 201).json({ data: result });
      } catch (err: any) {
        console.error("[Extension] POST /sync-jobs/:id/ingest error:", err);

        // Mark job as FAILED
        try {
          await db
            .update(extensionSyncJobs)
            .set({
              status: "FAILED",
              errorMessage: err?.message ?? "Ingestion failed",
              updatedAt: new Date(),
            })
            .where(eq(extensionSyncJobs.id, req.params.id));
        } catch (_) {}

        return res.status(500).json({ error: "Ingestion failed", detail: err?.message });
      }
    }
  );

  /**
   * POST /api/extension/tokens/:id/revoke
   * Web session. Revokes an extension token immediately.
   */
  router.post("/tokens/:id/revoke", async (req: any, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Authentication required" });

      const { id } = req.params;
      const companyId = req.user.companyId as string;

      const [row] = await db
        .select()
        .from(extensionTokens)
        .where(
          and(
            eq(extensionTokens.id, id),
            eq(extensionTokens.companyId, companyId)
          )
        )
        .limit(1);

      if (!row) return res.status(404).json({ error: "Token not found" });
      if (row.revokedAt) return res.json({ data: { alreadyRevoked: true } });

      await db
        .update(extensionTokens)
        .set({ revokedAt: new Date() })
        .where(eq(extensionTokens.id, id));

      return res.json({ data: { revoked: true } });
    } catch (err) {
      console.error("[Extension] POST /tokens/:id/revoke error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}
