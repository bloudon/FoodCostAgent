/**
 * Extension Pilot — API Routes  (v2 — corrected pairing flow)
 *
 * Pairing establishes identity only. Sync jobs are created separately.
 * The server owns all sync-job status transitions; the extension sends events.
 *
 * Route map:
 *   POST /api/extension/pair-code              — web session; create pairing code → pairingId
 *   POST /api/extension/pair-code/claim        — extension; claim code → bearer token
 *   GET  /api/extension/pair-status/:pairingId — web session; poll until claimed
 *   POST /api/extension/sync-jobs              — web session; create sync job after pairing
 *   GET  /api/extension/sync-jobs/active       — ext bearer; fetch most recent PENDING job
 *   GET  /api/extension/sync-jobs/:id          — web session OR ext bearer
 *   POST /api/extension/sync-jobs/:id/events   — ext bearer; report lifecycle event
 *   POST /api/extension/sync-jobs/:id/ingest   — ext bearer; submit captured batch
 *   POST /api/extension/tokens/:id/revoke      — web session; revoke token
 */

import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "../../db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  extensionPairingCodes,
  extensionTokens,
  extensionSyncJobs,
} from "../../../shared/schema";
import { ingestExtensionBatch } from "./extensionIngestionService";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAIRING_CODE_TTL_MS   = 120_000;           // 2 min
const TOKEN_TTL_MS          = 8 * 60 * 60 * 1000; // 8 hr
const RATE_LIMIT_WINDOW_MS  = 60 * 60 * 1000;    // 1 hr
const RATE_LIMIT_MAX_CLAIMS = 5;                  // per installationId per hour

const ACTIVE_STATUSES = ["PENDING", "PORTAL_OPEN", "CAPTURING", "SUBMITTING"];

const EXTENSION_EVENTS = [
  "portal_opened",
  "capture_started",
  "ingestion_submitted",
  "auth_required",
  "capture_failed",
] as const;
type ExtensionEvent = typeof EXTENSION_EVENTS[number];

const EVENT_STATUS_MAP: Record<ExtensionEvent, string> = {
  portal_opened:       "PORTAL_OPEN",
  capture_started:     "CAPTURING",
  ingestion_submitted: "SUBMITTING",
  auth_required:       "AUTH_REQUIRED",
  capture_failed:      "FAILED",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(9);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
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
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Extension bearer token required" });

  const raw = header.slice(7).trim();
  if (!raw) return res.status(401).json({ error: "Empty token" });

  const [row] = await db
    .select()
    .from(extensionTokens)
    .where(eq(extensionTokens.token, raw))
    .limit(1);

  if (!row)          return res.status(401).json({ error: "Invalid token" });
  if (row.revokedAt) return res.status(401).json({ error: "Token revoked" });
  if (new Date() > row.expiresAt) return res.status(401).json({ error: "Token expired" });

  req.extensionToken = row;
  next();
}

/** Resolve companyId from web session OR extension bearer — used on dual-auth routes. */
async function resolveCompanyId(req: any): Promise<string | null> {
  if (req.user?.companyId) return req.user.companyId as string;

  const header = req.headers?.authorization as string | undefined;
  if (header?.startsWith("Bearer ")) {
    const raw = header.slice(7).trim();
    const [tokenRow] = await db
      .select()
      .from(extensionTokens)
      .where(eq(extensionTokens.token, raw))
      .limit(1);
    if (tokenRow && !tokenRow.revokedAt && new Date() <= tokenRow.expiresAt)
      return tokenRow.companyId;
  }
  return null;
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const createPairCodeSchema = z.object({
  connectorId: z.string().min(1),
});

const claimPairCodeSchema = z.object({
  code:           z.string().min(6).max(16).transform((s) => s.trim().toUpperCase()),
  installationId: z.string().min(1).max(128),
});

const createSyncJobSchema = z.object({
  connectorId:                    z.string().min(1),
  vendorId:                       z.string().optional(),
  storeId:                        z.string().optional(),
  customerSupplierConnectionId:   z.string().optional(),
  externalSupplierId:             z.string().optional(),
  externalSupplierName:           z.string().optional(),
  externalLocationId:             z.string().optional(),
  externalOrderGuideId:           z.string().optional(),
});

const sendEventSchema = z.object({
  event:  z.enum(EXTENSION_EVENTS),
  detail: z.string().optional(),
});

const ingestSchema = z.object({
  batchId:                         z.string().min(1),
  extensionVersion:                z.string().min(1),   // required per spec
  parserVersion:                   z.string().min(1),   // required per spec
  capturedAt:                      z.string(),
  sourceUrl:                       z.string().optional(),
  capturedExternalSupplierId:      z.string().optional(),
  capturedExternalSupplierName:    z.string().optional(),
  capturedExternalLocationId:      z.string().optional(),
  capturedExternalOrderGuideId:    z.string().optional(),
  captureCompleteness: z.object({
    paginatedPages:   z.number().int().optional(),
    expectedRowCount: z.number().int().nullable().optional(),
    visibleRowCount:  z.number().int(),
    capturedRowCount: z.number().int(),
  }).optional(),
  items: z
    .array(
      z.object({
        supplierSku:     z.string().min(1),
        rawDescription:  z.string(),
        rawPackSize:     z.string().nullable().optional(),
        rawCasePrice:    z.string().nullable().optional(),
        rawUnitPrice:    z.string().nullable().optional(),
        currency:        z.string().default("USD"),
        priceEffective:  z.string().nullable().optional(),
        sourceItemId:    z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(2000),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerExtensionRoutes(router: Router) {

  // ── POST /pair-code ──────────────────────────────────────────────────────────
  /**
   * Web session auth. Creates a short-lived pairing code.
   * Pairing establishes identity only — no sync job is created here.
   * Returns pairingId (safe to expose for polling) + code (secret, shown once).
   */
  router.post("/pair-code", async (req: any, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Authentication required" });

      const parsed = createPairCodeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      const companyId  = req.user.companyId as string;
      const userId     = req.user.id as string;
      const { connectorId } = parsed.data;

      const rawCode   = generateCode();
      const codeHash  = sha256hex(rawCode);
      const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

      const [row] = await db
        .insert(extensionPairingCodes)
        .values({ companyId, userId, connectorId, codeHash, expiresAt })
        .returning();

      return res.status(201).json({
        data: {
          pairingId:  row.id,
          code:       rawCode,
          expiresIn:  PAIRING_CODE_TTL_MS / 1000,
          connectorId,
        },
      });
    } catch (err) {
      console.error("[Extension] POST /pair-code error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── POST /pair-code/claim ────────────────────────────────────────────────────
  /**
   * No prior auth required. Extension submits the secret code + its installationId.
   * Returns a scoped bearer token. No sync job context is included — the web app
   * creates the sync job separately after pairing is confirmed.
   */
  router.post("/pair-code/claim", async (req: Request, res: Response) => {
    try {
      const parsed = claimPairCodeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      const { code, installationId } = parsed.data;
      const codeHash = sha256hex(code);

      // Rate limit: max 5 claims per installationId per hour
      const windowStart  = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
      const recentClaims = await db
        .select()
        .from(extensionPairingCodes)
        .where(
          and(
            eq(extensionPairingCodes.installationId, installationId),
            sql`${extensionPairingCodes.claimedAt} > ${windowStart}`
          )
        );
      if (recentClaims.length >= RATE_LIMIT_MAX_CLAIMS)
        return res.status(429).json({ error: "Too many claim attempts. Try again later." });

      const [row] = await db
        .select()
        .from(extensionPairingCodes)
        .where(eq(extensionPairingCodes.codeHash, codeHash))
        .limit(1);

      if (!row)            return res.status(404).json({ error: "Invalid or expired code" });
      if (row.claimedAt)   return res.status(409).json({ error: "Code already claimed" });
      if (new Date() > row.expiresAt) return res.status(410).json({ error: "Code expired" });

      // Issue scoped token — scope contains only identity, not job context
      const rawToken  = generateToken();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      const scope     = {
        companyId:   row.companyId,
        connectorId: row.connectorId,
        userId:      row.userId,
        permissions: ["catalog:write"],
      };

      const [tokenRow] = await db
        .insert(extensionTokens)
        .values({
          companyId:      row.companyId,
          userId:         row.userId,
          connectorId:    row.connectorId,
          installationId,
          token:          rawToken,
          scope,
          expiresAt,
        })
        .returning();

      // Atomically mark code as claimed — store real tokenId now
      await db
        .update(extensionPairingCodes)
        .set({ claimedAt: new Date(), installationId, tokenId: tokenRow.id })
        .where(eq(extensionPairingCodes.id, row.id));

      return res.status(200).json({
        data: {
          token:     rawToken,
          tokenId:   tokenRow.id,
          expiresAt: expiresAt.toISOString(),
          scope,
        },
      });
    } catch (err) {
      console.error("[Extension] POST /pair-code/claim error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── GET /pair-status/:pairingId ──────────────────────────────────────────────
  /**
   * Web session polls this by pairingId (non-secret row ID).
   * Pairing happens before any sync job exists — returns claimed status only.
   */
  router.get("/pair-status/:pairingId", async (req: any, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Authentication required" });

      const { pairingId } = req.params;
      const companyId     = req.user.companyId as string;

      const [row] = await db
        .select()
        .from(extensionPairingCodes)
        .where(
          and(
            eq(extensionPairingCodes.id, pairingId),
            eq(extensionPairingCodes.companyId, companyId)
          )
        )
        .limit(1);

      if (!row) return res.status(404).json({ error: "Pairing code not found" });

      const expired = !row.claimedAt && new Date() > row.expiresAt;
      const status  = row.claimedAt ? "claimed" : expired ? "expired" : "pending";

      return res.json({ data: { status, pairingId: row.id } });
    } catch (err) {
      console.error("[Extension] GET /pair-status error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── POST /sync-jobs ──────────────────────────────────────────────────────────
  /**
   * Web session. Created after pairing is confirmed.
   * The extension discovers the active job via GET /sync-jobs/active.
   */
  router.post("/sync-jobs", async (req: any, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Authentication required" });

      const parsed = createSyncJobSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      const companyId = req.user.companyId as string;
      const userId    = req.user.id as string;

      const [job] = await db
        .insert(extensionSyncJobs)
        .values({
          companyId,
          userId,
          connectorId:                  parsed.data.connectorId,
          vendorId:                     parsed.data.vendorId              ?? null,
          storeId:                      parsed.data.storeId               ?? null,
          customerSupplierConnectionId: parsed.data.customerSupplierConnectionId ?? null,
          externalSupplierId:           parsed.data.externalSupplierId    ?? null,
          externalSupplierName:         parsed.data.externalSupplierName  ?? null,
          externalLocationId:           parsed.data.externalLocationId    ?? null,
          externalOrderGuideId:         parsed.data.externalOrderGuideId  ?? null,
          status: "PENDING",
        })
        .returning();

      return res.status(201).json({ data: job });
    } catch (err) {
      console.error("[Extension] POST /sync-jobs error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── GET /sync-jobs/active ────────────────────────────────────────────────────
  /**
   * Extension bearer only. Returns the most recent non-terminal sync job for
   * this token's company + connector. Extension uses this to discover the jobId
   * after the web app creates the sync job.
   *
   * IMPORTANT: this route must be registered BEFORE /sync-jobs/:id so Express
   * doesn't treat "active" as an :id parameter.
   */
  router.get(
    "/sync-jobs/active",
    requireExtensionToken,
    async (req: ExtensionAuthRequest, res: Response) => {
      try {
        const tokenRow = req.extensionToken!;

        const [job] = await db
          .select()
          .from(extensionSyncJobs)
          .where(
            and(
              eq(extensionSyncJobs.companyId,   tokenRow.companyId),
              eq(extensionSyncJobs.connectorId, tokenRow.connectorId),
              inArray(extensionSyncJobs.status,  ACTIVE_STATUSES)
            )
          )
          .orderBy(desc(extensionSyncJobs.createdAt))
          .limit(1);

        if (!job) return res.status(404).json({ error: "No active sync job" });
        return res.json({ data: job });
      } catch (err) {
        console.error("[Extension] GET /sync-jobs/active error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ── GET /sync-jobs/:id ───────────────────────────────────────────────────────
  /** Web session OR extension bearer. Returns full job state. */
  router.get("/sync-jobs/:id", async (req: any, res: Response) => {
    try {
      const { id }      = req.params;
      const companyId   = await resolveCompanyId(req);
      if (!companyId) return res.status(401).json({ error: "Authentication required" });

      const [job] = await db
        .select()
        .from(extensionSyncJobs)
        .where(
          and(
            eq(extensionSyncJobs.id,        id),
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

  // ── POST /sync-jobs/:id/events ───────────────────────────────────────────────
  /**
   * Extension bearer only. Reports a lifecycle event; server drives the status
   * transition. Extension cannot set COMPLETE directly.
   */
  router.post(
    "/sync-jobs/:id/events",
    requireExtensionToken,
    async (req: ExtensionAuthRequest, res: Response) => {
      try {
        const { id }    = req.params;
        const tokenRow  = req.extensionToken!;
        const parsed    = sendEventSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

        const { event, detail } = parsed.data;

        const [job] = await db
          .select()
          .from(extensionSyncJobs)
          .where(
            and(
              eq(extensionSyncJobs.id,        id),
              eq(extensionSyncJobs.companyId, tokenRow.companyId)
            )
          )
          .limit(1);

        if (!job) return res.status(404).json({ error: "Job not found" });

        if (["COMPLETE", "EXPIRED"].includes(job.status))
          return res.json({ data: { status: job.status, ignored: true } });

        const newStatus    = EVENT_STATUS_MAP[event];
        const now          = new Date();
        const newEventObj  = { event, occurredAt: now.toISOString(), ...(detail ? { detail } : {}) };

        const errorMessage =
          event === "capture_failed"  ? (detail ?? "Capture failed") :
          event === "auth_required"   ? "Sign-in required before prices can be refreshed." :
          job.errorMessage;

        await db
          .update(extensionSyncJobs)
          .set({
            status:       newStatus,
            events:       sql`${extensionSyncJobs.events} || ${JSON.stringify([newEventObj])}::jsonb`,
            errorMessage: errorMessage ?? null,
            updatedAt:    now,
          })
          .where(eq(extensionSyncJobs.id, id));

        return res.json({ data: { status: newStatus } });
      } catch (err) {
        console.error("[Extension] POST /sync-jobs/:id/events error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ── POST /sync-jobs/:id/ingest ───────────────────────────────────────────────
  /**
   * Extension bearer only. Submits captured catalog batch.
   * Idempotent by (syncJobId, batchId). COMPLETE is set only after validated ingestion.
   */
  router.post(
    "/sync-jobs/:id/ingest",
    requireExtensionToken,
    async (req: ExtensionAuthRequest, res: Response) => {
      try {
        const { id }   = req.params;
        const tokenRow = req.extensionToken!;
        const parsed   = ingestSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

        const [job] = await db
          .select()
          .from(extensionSyncJobs)
          .where(
            and(
              eq(extensionSyncJobs.id,        id),
              eq(extensionSyncJobs.companyId, tokenRow.companyId)
            )
          )
          .limit(1);

        if (!job) return res.status(404).json({ error: "Job not found" });

        if (job.status === "COMPLETE")
          return res.json({ data: { alreadyProcessed: true, status: "COMPLETE" } });

        // Transition to SUBMITTING
        await db
          .update(extensionSyncJobs)
          .set({
            status:    "SUBMITTING",
            events:    sql`${extensionSyncJobs.events} || ${JSON.stringify([
              { event: "ingestion_submitted", occurredAt: new Date().toISOString() },
            ])}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(extensionSyncJobs.id, id));

        const d = parsed.data;
        const result = await ingestExtensionBatch({
          syncJobId:                    id,
          batchId:                      d.batchId,
          companyId:                    tokenRow.companyId,
          connectorId:                  tokenRow.connectorId,
          extensionVersion:             d.extensionVersion,
          parserVersion:                d.parserVersion,
          capturedAt:                   d.capturedAt,
          sourceUrl:                    d.sourceUrl,
          capturedExternalSupplierId:   d.capturedExternalSupplierId,
          capturedExternalSupplierName: d.capturedExternalSupplierName,
          capturedExternalLocationId:   d.capturedExternalLocationId,
          capturedExternalOrderGuideId: d.capturedExternalOrderGuideId,
          captureCompleteness:          d.captureCompleteness,
          items: d.items.map((i) => ({
            supplierSku:    i.supplierSku,
            rawDescription: i.rawDescription,
            rawPackSize:    i.rawPackSize    ?? null,
            rawCasePrice:   i.rawCasePrice   ?? null,
            rawUnitPrice:   i.rawUnitPrice   ?? null,
            currency:       i.currency,
            priceEffective: i.priceEffective ?? null,
            sourceItemId:   i.sourceItemId   ?? null,
          })),
        });

        // Server owns COMPLETE — only after successful ingestion
        const now = new Date();
        await db
          .update(extensionSyncJobs)
          .set({
            status:        "COMPLETE",
            orderGuideId:  result.orderGuideId,
            itemCount:     result.itemsUpdated,
            captureWarning: result.captureWarning ?? null,
            completedAt:   now,
            updatedAt:     now,
            events:        sql`${extensionSyncJobs.events} || ${JSON.stringify([
              { event: "complete", occurredAt: now.toISOString() },
            ])}::jsonb`,
          })
          .where(eq(extensionSyncJobs.id, id));

        return res.status(result.alreadyProcessed ? 200 : 201).json({ data: result });
      } catch (err: any) {
        console.error("[Extension] POST /sync-jobs/:id/ingest error:", err);
        try {
          await db
            .update(extensionSyncJobs)
            .set({ status: "FAILED", errorMessage: err?.message ?? "Ingestion failed", updatedAt: new Date() })
            .where(eq(extensionSyncJobs.id, req.params.id));
        } catch (_) {}
        return res.status(500).json({ error: "Ingestion failed", detail: err?.message });
      }
    }
  );

  // ── POST /tokens/:id/revoke ──────────────────────────────────────────────────
  /** Web session. Revokes an extension token immediately. */
  router.post("/tokens/:id/revoke", async (req: any, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Authentication required" });

      const { id }    = req.params;
      const companyId = req.user.companyId as string;

      const [row] = await db
        .select()
        .from(extensionTokens)
        .where(
          and(
            eq(extensionTokens.id,        id),
            eq(extensionTokens.companyId, companyId)
          )
        )
        .limit(1);

      if (!row)         return res.status(404).json({ error: "Token not found" });
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
