/**
 * Report API routes
 *
 *  GET  /api/reports/run         — run a report and return rows
 *  GET  /api/reports/export      — run a report and stream as xlsx
 *
 *  GET  /api/saved-reports               — list saved report configs for company
 *  POST /api/saved-reports               — create
 *  PUT  /api/saved-reports/:id           — update
 *  DELETE /api/saved-reports/:id         — delete
 *
 *  GET  /api/report-subscriptions        — list scheduled subscriptions
 *  POST /api/report-subscriptions        — create
 *  PUT  /api/report-subscriptions/:id    — update
 *  DELETE /api/report-subscriptions/:id  — delete
 *  GET  /api/report-subscriptions/:id/logs — recent run logs
 */
import type { Express } from "express";
import { requireAuth } from "../auth";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getEffectiveCompanyId } from "../lib/milestonesHandler";
import { runReport, generateReportBuffer } from "../reportGenerators";
import { reloadReportScheduler } from "../reportScheduler";
import { reportFiltersSchema, insertSavedReportSchema, insertReportSubscriptionSchema } from "@shared/schema";
import { getAccessibleStores } from "../permissions";

const MANAGER_ROLES = ["store_manager", "company_admin", "global_admin"];

function requireManager(req: any, res: any): boolean {
  if (!MANAGER_ROLES.includes(req.user?.role ?? "")) {
    res.status(403).json({ error: "Manager or above required" });
    return false;
  }
  return true;
}

/**
 * Resolve accessible store IDs and validate a requested storeId.
 * Returns { accessibleStoreIds, error } — if error is set, send 403 and abort.
 *
 * For store_manager:  must restrict to their assigned stores
 * For company_admin / global_admin:  unrestricted (returns undefined = no extra filter)
 */
async function resolveStoreAccess(
  user: any,
  companyId: string,
  requestedStoreId?: string,
): Promise<{ accessibleStoreIds?: string[]; error?: string }> {
  const role = user?.role ?? "";

  // company_admin and global_admin have unrestricted access
  if (role === "company_admin" || role === "global_admin") {
    if (requestedStoreId) {
      // Still validate the store belongs to the company (basic sanity)
      const rows = await db.execute(sql`
        SELECT id FROM company_stores WHERE id = ${requestedStoreId} AND company_id = ${companyId} LIMIT 1
      `);
      if (!((rows as any).rows ?? []).length) {
        return { error: "Store not found in this company" };
      }
    }
    return {};
  }

  // store_manager: restrict to their assigned stores
  const accessibleStoreIds = await getAccessibleStores(user, companyId);

  if (requestedStoreId) {
    if (!accessibleStoreIds.includes(requestedStoreId)) {
      return { error: "You do not have access to this location" };
    }
    // Valid — return only the requested store (still enforce via accessibleStoreIds)
    return { accessibleStoreIds: [requestedStoreId] };
  }

  // No storeId requested — scope to all accessible stores
  return { accessibleStoreIds };
}

export function registerReportRoutes(app: Express) {
  // ── Run report (returns JSON rows) ────────────────────────────────────────
  app.get("/api/reports/run", requireAuth, async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      if (!companyId) return res.status(400).json({ error: "No company context" });

      const filters = reportFiltersSchema.parse({
        reportType: req.query.reportType,
        storeId:    req.query.storeId    || undefined,
        dateFrom:   req.query.dateFrom   || undefined,
        dateTo:     req.query.dateTo     || undefined,
        category:   req.query.category   || undefined,
      });

      const { accessibleStoreIds, error } = await resolveStoreAccess(user, companyId, filters.storeId);
      if (error) return res.status(403).json({ error });

      const { rows, reportType } = await runReport(companyId, filters, accessibleStoreIds);
      res.json({ rows, reportType, count: rows.length });
    } catch (err: any) {
      console.error("[Reports] Run error:", err);
      res.status(500).json({ error: err.message ?? "Failed to run report" });
    }
  });

  // ── Export report (xlsx download) ─────────────────────────────────────────
  app.get("/api/reports/export", requireAuth, async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      if (!companyId) return res.status(400).json({ error: "No company context" });

      const filters = reportFiltersSchema.parse({
        reportType: req.query.reportType,
        storeId:    req.query.storeId    || undefined,
        dateFrom:   req.query.dateFrom   || undefined,
        dateTo:     req.query.dateTo     || undefined,
        category:   req.query.category   || undefined,
      });

      const { accessibleStoreIds, error } = await resolveStoreAccess(user, companyId, filters.storeId);
      if (error) return res.status(403).json({ error });

      const { buffer, filename } = await generateReportBuffer(companyId, filters, accessibleStoreIds);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err: any) {
      console.error("[Reports] Export error:", err);
      res.status(500).json({ error: err.message ?? "Failed to export report" });
    }
  });

  // ── Saved reports CRUD ────────────────────────────────────────────────────
  app.get("/api/saved-reports", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      if (!companyId) return res.status(400).json({ error: "No company context" });
      const result = await db.execute(sql`
        SELECT * FROM saved_reports WHERE company_id = ${companyId} ORDER BY created_at DESC
      `);
      res.json((result as any).rows ?? []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/saved-reports", requireAuth, async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      if (!companyId) return res.status(400).json({ error: "No company context" });

      const parsed = insertSavedReportSchema.parse({ ...req.body, companyId });
      const result = await db.execute(sql`
        INSERT INTO saved_reports (company_id, name, report_type, filters, is_system, created_by)
        VALUES (
          ${companyId},
          ${parsed.name},
          ${parsed.reportType},
          ${JSON.stringify(parsed.filters ?? {})}::jsonb,
          ${parsed.isSystem ?? 0},
          ${user.id ?? null}
        )
        RETURNING *
      `);
      res.status(201).json(((result as any).rows ?? [])[0] ?? {});
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/saved-reports/:id", requireAuth, async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      const { id } = req.params;
      const { name, filters } = req.body;
      const result = await db.execute(sql`
        UPDATE saved_reports
        SET name    = ${name},
            filters = ${JSON.stringify(filters ?? {})}::jsonb
        WHERE id = ${id} AND company_id = ${companyId}
        RETURNING *
      `);
      const row = ((result as any).rows ?? [])[0];
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/saved-reports/:id", requireAuth, async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      const { id } = req.params;
      await db.execute(sql`DELETE FROM saved_reports WHERE id = ${id} AND company_id = ${companyId}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Report subscriptions CRUD ─────────────────────────────────────────────
  app.get("/api/report-subscriptions", requireAuth, async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      if (!companyId) return res.status(400).json({ error: "No company context" });
      const result = await db.execute(sql`
        SELECT * FROM report_subscriptions WHERE company_id = ${companyId} ORDER BY created_at DESC
      `);
      res.json((result as any).rows ?? []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/report-subscriptions", requireAuth, async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      if (!companyId) return res.status(400).json({ error: "No company context" });

      const parsed = insertReportSubscriptionSchema.parse({ ...req.body, companyId });

      // Validate + enforce store scope for the subscription filters
      const requestedStoreId = (parsed.filters as any)?.storeId;
      const { accessibleStoreIds, error: scopeError } = await resolveStoreAccess(user, companyId, requestedStoreId);
      if (scopeError) return res.status(403).json({ error: scopeError });

      // Build enforced filters: for store_manager, persist the validated scope so the
      // scheduler can enforce it at execution time without a live user session.
      const enforcedFilters: Record<string, any> = { ...(parsed.filters ?? {}) };
      if (accessibleStoreIds !== undefined) {
        // store_manager: store computed accessible scope in _accessibleStoreIds
        // (underscore prefix signals server-set; clients cannot override this)
        enforcedFilters._accessibleStoreIds = accessibleStoreIds;
      }

      const result = await db.execute(sql`
        INSERT INTO report_subscriptions
          (company_id, name, report_type, filters, saved_report_id,
           schedule_frequency, schedule_hour, email_recipients, is_active, created_by)
        VALUES (
          ${companyId},
          ${parsed.name},
          ${parsed.reportType},
          ${JSON.stringify(enforcedFilters)}::jsonb,
          ${parsed.savedReportId ?? null},
          ${parsed.scheduleFrequency},
          ${parsed.scheduleHour},
          ${parsed.emailRecipients}::text[],
          ${parsed.isActive ?? 1},
          ${user.id ?? null}
        )
        RETURNING *
      `);
      const row = ((result as any).rows ?? [])[0] ?? {};
      await reloadReportScheduler();
      res.status(201).json(row);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/report-subscriptions/:id", requireAuth, async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      const { id } = req.params;

      const parsed = insertReportSubscriptionSchema.partial().parse(req.body);

      // If filters are being updated, re-validate store scope
      let enforcedFilters: Record<string, any> | undefined;
      if (parsed.filters !== undefined) {
        const requestedStoreId = (parsed.filters as any)?.storeId;
        const { accessibleStoreIds, error: scopeError } = await resolveStoreAccess(user, companyId, requestedStoreId);
        if (scopeError) return res.status(403).json({ error: scopeError });
        enforcedFilters = { ...(parsed.filters ?? {}) };
        if (accessibleStoreIds !== undefined) {
          enforcedFilters._accessibleStoreIds = accessibleStoreIds;
        }
      }

      // Build update from provided fields
      const setters: any[] = [];
      if (parsed.name !== undefined)              setters.push(sql`name = ${parsed.name}`);
      if (parsed.reportType !== undefined)         setters.push(sql`report_type = ${parsed.reportType}`);
      if (enforcedFilters !== undefined)           setters.push(sql`filters = ${JSON.stringify(enforcedFilters)}::jsonb`);
      if (parsed.scheduleFrequency !== undefined)  setters.push(sql`schedule_frequency = ${parsed.scheduleFrequency}`);
      if (parsed.scheduleHour !== undefined)       setters.push(sql`schedule_hour = ${parsed.scheduleHour}`);
      if (parsed.emailRecipients !== undefined)    setters.push(sql`email_recipients = ${parsed.emailRecipients}::text[]`);
      if (parsed.isActive !== undefined)           setters.push(sql`is_active = ${parsed.isActive}`);
      if (setters.length === 0) return res.status(400).json({ error: "No fields to update" });

      const setClauses = sql.join(setters, sql`, `);
      const result = await db.execute(sql`
        UPDATE report_subscriptions SET ${setClauses} WHERE id = ${id} AND company_id = ${companyId} RETURNING *
      `);
      const row = ((result as any).rows ?? [])[0];
      if (!row) return res.status(404).json({ error: "Not found" });
      await reloadReportScheduler();
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/report-subscriptions/:id", requireAuth, async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      const { id } = req.params;
      await db.execute(sql`DELETE FROM report_subscriptions WHERE id = ${id} AND company_id = ${companyId}`);
      await reloadReportScheduler();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/report-subscriptions/:id/logs", requireAuth, async (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const user = req.user as any;
      const companyId = getEffectiveCompanyId(req) || user?.companyId;
      const { id } = req.params;
      // Verify subscription belongs to company
      const check = await db.execute(sql`
        SELECT id FROM report_subscriptions WHERE id = ${id} AND company_id = ${companyId}
      `);
      if (!((check as any).rows ?? []).length) return res.status(404).json({ error: "Not found" });
      const result = await db.execute(sql`
        SELECT * FROM report_subscription_logs
        WHERE subscription_id = ${id}
        ORDER BY triggered_at DESC LIMIT 50
      `);
      res.json((result as any).rows ?? []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
