/**
 * Admin chat-log routes
 *
 *  GET    /api/admin/chat-logs         — paginated Q&A history with aggregate metrics
 *  GET    /api/admin/chat-corrections  — list all corrections
 *  POST   /api/admin/chat-corrections  — create a correction
 *  PATCH  /api/admin/chat-corrections/:id — toggle isActive / update response
 *  DELETE /api/admin/chat-corrections/:id — remove a correction
 */

import type { Express } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { z } from "zod";

const TOPIC_KEYWORDS: Array<{ label: string; keywords: string[] }> = [
  { label: "Food Cost",       keywords: ["cost", "food cost", "cogs", "margin", "profit", "expensive", "price", "pricing"] },
  { label: "Recipes",         keywords: ["recipe", "recipes", "ingredient", "ingredients", "portion", "yield", "preparation"] },
  { label: "Inventory",       keywords: ["inventory", "stock", "on hand", "count", "par", "reorder", "item", "items"] },
  { label: "Vendors",         keywords: ["vendor", "vendors", "supplier", "order guide", "invoice", "purchase"] },
  { label: "Waste",           keywords: ["waste", "spoilage", "loss", "discard", "expire"] },
  { label: "Reports / TFC",   keywords: ["report", "tfc", "theoretical", "variance", "sales", "pos", "dashboard"] },
  { label: "Getting Started", keywords: ["how do i", "how to", "where", "setup", "start", "begin", "onboard", "add", "create"] },
  { label: "Transfers",       keywords: ["transfer", "move", "location", "store"] },
  { label: "Billing / Plan",  keywords: ["plan", "subscription", "tier", "upgrade", "billing", "pro", "basic", "premium"] },
];

/**
 * Parse and clamp the ?limit query param.
 * Default: 100. Minimum: 1. Maximum: 200. Non-numeric → default.
 */
export function parseChatLogsLimit(raw: string | undefined): number {
  const parsed = parseInt(raw || "100", 10);
  return isNaN(parsed) ? 100 : Math.min(Math.max(1, parsed), 200);
}

export function registerChatLogsRoutes(app: Express): void {
  // GET /api/admin/chat-logs — global admin: recent Q&A pairs with optional companyId filter
  // @ts-ignore
  app.get("/api/admin/chat-logs", requireAuth, async (req, res) => {
    try {
      // @ts-ignore
      const user = await storage.getUser(req.user!.id);
      if (user?.role !== "global_admin") {
        return res.status(403).json({ error: "Only global admins can access chat logs" });
      }
      const filterCompanyId = req.query.companyId as string | undefined;
      const limit = parseChatLogsLimit(req.query.limit as string | undefined);

      const rows = filterCompanyId
        ? await db.execute(
            sql`SELECT cl.id, cl.company_id, cl.user_id, cl.user_message, cl.assistant_response, cl.tier, cl.created_at,
                       c.name as company_name
                FROM chat_logs cl LEFT JOIN companies c ON cl.company_id = c.id
                WHERE cl.company_id = ${filterCompanyId}
                ORDER BY cl.created_at DESC LIMIT ${limit}`
          )
        : await db.execute(
            sql`SELECT cl.id, cl.company_id, cl.user_id, cl.user_message, cl.assistant_response, cl.tier, cl.created_at,
                       c.name as company_name
                FROM chat_logs cl LEFT JOIN companies c ON cl.company_id = c.id
                ORDER BY cl.created_at DESC LIMIT ${limit}`
          );

      const allRows = ((rows as any).rows || rows) as any[];

      // True aggregate metrics from DB (not limited by the paged result set)
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayStartISO = todayStart.toISOString();

      const todayCountResult = filterCompanyId
        ? await db.execute(
            sql`SELECT COUNT(*) as cnt FROM chat_logs WHERE company_id = ${filterCompanyId} AND created_at >= ${todayStartISO}`
          )
        : await db.execute(
            sql`SELECT COUNT(*) as cnt FROM chat_logs WHERE created_at >= ${todayStartISO}`
          );
      const todayCount = Number(((todayCountResult as any).rows?.[0] ?? (todayCountResult as any)[0])?.cnt ?? 0);

      const mostActiveResult = filterCompanyId
        ? await db.execute(
            sql`SELECT cl.company_id, c.name as company_name, COUNT(*) as cnt
                FROM chat_logs cl LEFT JOIN companies c ON cl.company_id = c.id
                WHERE cl.company_id = ${filterCompanyId}
                GROUP BY cl.company_id, c.name ORDER BY cnt DESC LIMIT 1`
          )
        : await db.execute(
            sql`SELECT cl.company_id, c.name as company_name, COUNT(*) as cnt
                FROM chat_logs cl LEFT JOIN companies c ON cl.company_id = c.id
                GROUP BY cl.company_id, c.name ORDER BY cnt DESC LIMIT 1`
          );
      const mostActiveRow = ((mostActiveResult as any).rows?.[0] ?? (mostActiveResult as any)[0]);
      const mostActiveCompany = mostActiveRow
        ? { name: mostActiveRow.company_name ?? mostActiveRow.company_id, count: Number(mostActiveRow.cnt) }
        : null;

      // Common question topics — keyword bucket analysis bounded to last 30 days to avoid full-table scans
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const topicMsgResult = filterCompanyId
        ? await db.execute(sql`SELECT user_message FROM chat_logs WHERE company_id = ${filterCompanyId} AND created_at >= ${thirtyDaysAgo}`)
        : await db.execute(sql`SELECT user_message FROM chat_logs WHERE created_at >= ${thirtyDaysAgo}`);
      const allMessages = ((topicMsgResult as any).rows || topicMsgResult) as Array<{ user_message: string }>;
      const topicCounts: Record<string, number> = {};
      for (const r of allMessages) {
        const msg = (r.user_message ?? "").toLowerCase();
        for (const topic of TOPIC_KEYWORDS) {
          if (topic.keywords.some(kw => msg.includes(kw))) {
            topicCounts[topic.label] = (topicCounts[topic.label] ?? 0) + 1;
          }
        }
      }
      const topTopics = Object.entries(topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => ({ label, count }));

      res.json({ logs: allRows, todayCount, mostActiveCompany, topTopics });
    } catch (err: any) {
      console.error("GET /api/admin/chat-logs error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/chat-corrections — global admin: list all corrections
  // @ts-ignore
  app.get("/api/admin/chat-corrections", requireAuth, async (req, res) => {
    try {
      // @ts-ignore
      const user = await storage.getUser(req.user!.id);
      if (user?.role !== "global_admin") {
        return res.status(403).json({ error: "Only global admins can access chat corrections" });
      }
      const rows = await db.execute(
        sql`SELECT id, chat_log_id, user_message, corrected_response, is_active, created_at
            FROM chat_corrections ORDER BY created_at DESC`
      );
      res.json(((rows as any).rows || rows) as any[]);
    } catch (err: any) {
      console.error("GET /api/admin/chat-corrections error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/chat-corrections — create a correction
  // @ts-ignore
  app.post("/api/admin/chat-corrections", requireAuth, async (req, res) => {
    try {
      // @ts-ignore
      const user = await storage.getUser(req.user!.id);
      if (user?.role !== "global_admin") {
        return res.status(403).json({ error: "Only global admins can create chat corrections" });
      }
      const parseResult = z.object({
        chatLogId: z.string().nullable().optional(),
        userMessage: z.string().min(1),
        correctedResponse: z.string().min(1),
      }).safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid request", details: parseResult.error.flatten() });
      }
      const { chatLogId, userMessage, correctedResponse } = parseResult.data;

      const result = await db.execute(
        sql`INSERT INTO chat_corrections (chat_log_id, user_message, corrected_response, is_active)
            VALUES (${chatLogId ?? null}, ${userMessage}, ${correctedResponse}, 1)
            RETURNING id, chat_log_id, user_message, corrected_response, is_active, created_at`
      );
      const row = ((result as any).rows?.[0] || (result as any)[0]);
      res.status(201).json(row);
    } catch (err: any) {
      console.error("POST /api/admin/chat-corrections error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/admin/chat-corrections/:id — toggle isActive or update response
  // @ts-ignore
  app.patch("/api/admin/chat-corrections/:id", requireAuth, async (req, res) => {
    try {
      // @ts-ignore
      const user = await storage.getUser(req.user!.id);
      if (user?.role !== "global_admin") {
        return res.status(403).json({ error: "Only global admins can update chat corrections" });
      }
      const parseResult = z.object({
        isActive: z.number().int().min(0).max(1).optional(),
        correctedResponse: z.string().min(1).optional(),
      }).safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid request", details: parseResult.error.flatten() });
      }
      const { isActive, correctedResponse } = parseResult.data;

      if (isActive === undefined && correctedResponse === undefined) {
        return res.status(400).json({ error: "Request must include at least one of: isActive, correctedResponse" });
      }

      if (isActive !== undefined && correctedResponse !== undefined) {
        await db.execute(
          sql`UPDATE chat_corrections SET is_active = ${isActive}, corrected_response = ${correctedResponse} WHERE id = ${req.params.id}`
        );
      } else if (isActive !== undefined) {
        await db.execute(
          sql`UPDATE chat_corrections SET is_active = ${isActive} WHERE id = ${req.params.id}`
        );
      } else if (correctedResponse !== undefined) {
        await db.execute(
          sql`UPDATE chat_corrections SET corrected_response = ${correctedResponse} WHERE id = ${req.params.id}`
        );
      }

      const result = await db.execute(
        sql`SELECT id, chat_log_id, user_message, corrected_response, is_active, created_at FROM chat_corrections WHERE id = ${req.params.id}`
      );
      const row = ((result as any).rows?.[0] || (result as any)[0]);
      if (!row) return res.status(404).json({ error: "Correction not found" });
      res.json(row);
    } catch (err: any) {
      console.error("PATCH /api/admin/chat-corrections/:id error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/chat-corrections/:id — remove a correction
  // @ts-ignore
  app.delete("/api/admin/chat-corrections/:id", requireAuth, async (req, res) => {
    try {
      // @ts-ignore
      const user = await storage.getUser(req.user!.id);
      if (user?.role !== "global_admin") {
        return res.status(403).json({ error: "Only global admins can delete chat corrections" });
      }
      await db.execute(sql`DELETE FROM chat_corrections WHERE id = ${req.params.id}`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("DELETE /api/admin/chat-corrections/:id error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}
