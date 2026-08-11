/**
 * Pending-user admin routes
 *
 * GET  /api/admin/pending-users        — list users who authenticated but have no company
 * POST /api/admin/pending-users/:id/assign — assign a pending user to a company
 *
 * Extracted from routes.ts so the handlers can be imported and exercised in
 * integration tests without mounting the entire application.
 */
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth } from "../auth";

export function registerPendingUserAssignRoutes(app: Express): void {
  // GET /api/admin/pending-users — global_admin: all unassigned users; company_admin: only those matching their company's invitations
  // @ts-ignore
  app.get("/api/admin/pending-users", requireAuth, async (req, res) => {
    try {
      // @ts-ignore
      const reqUser = await storage.getUser(req.user!.id);
      if (!reqUser || (reqUser.role !== "global_admin" && reqUser.role !== "company_admin")) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      let pendingUsers: any[] = [];

      if (reqUser.role === "global_admin") {
        // Global admins see ALL users with no company assignment
        const result = await db.execute(
          sql`SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.active,
                     u.created_at, u.sso_provider, u.profile_image_url,
                     MAX(s.last_active_at) as last_login_at
              FROM users u
              LEFT JOIN auth_sessions s ON s.user_id = u.id
              WHERE u.company_id IS NULL
                AND u.role != 'global_admin'
              GROUP BY u.id, u.email, u.first_name, u.last_name, u.role, u.active,
                       u.created_at, u.sso_provider, u.profile_image_url
              ORDER BY u.created_at DESC`
        );
        const rawRows = (result as { rows?: any[] }).rows ?? (result as any[]);
        pendingUsers = Array.isArray(rawRows) ? rawRows : [];
      } else {
        // Company admins see only unassigned users whose email matches a pending invitation for their company
        if (!reqUser.companyId) {
          return res.json({ pendingUsers: [] });
        }
        const result = await db.execute(
          sql`SELECT DISTINCT u.id, u.email, u.first_name, u.last_name, u.role, u.active,
                     u.created_at, u.sso_provider, u.profile_image_url,
                     MAX(s.last_active_at) as last_login_at
              FROM users u
              LEFT JOIN auth_sessions s ON s.user_id = u.id
              INNER JOIN invitations i ON i.email = u.email
                AND i.company_id = ${reqUser.companyId}
                AND i.accepted_at IS NULL
                AND i.expires_at > NOW()
              WHERE u.company_id IS NULL
                AND u.role != 'global_admin'
              GROUP BY u.id, u.email, u.first_name, u.last_name, u.role, u.active,
                       u.created_at, u.sso_provider, u.profile_image_url
              ORDER BY u.created_at DESC`
        );
        const rawRows = (result as { rows?: any[] }).rows ?? (result as any[]);
        pendingUsers = Array.isArray(rawRows) ? rawRows : [];
      }

      // For each pending user, check if there's a matching pending invitation
      const enriched = await Promise.all(
        pendingUsers.map(async (u) => {
          // Company admins: restrict invitation lookup to their own company
          const companyFilter =
            reqUser.role === "company_admin" && reqUser.companyId
              ? sql`AND i.company_id = ${reqUser.companyId}`
              : sql``;
          const inviteResult = await db.execute(
            sql`SELECT i.id, i.email, i.company_id, i.role, i.store_ids, i.token, i.expires_at, i.created_at,
                       c.name as company_name
                FROM invitations i
                LEFT JOIN companies c ON i.company_id = c.id
                WHERE i.email = ${u.email}
                  AND i.accepted_at IS NULL
                  AND i.expires_at > NOW()
                  ${companyFilter}
                ORDER BY i.created_at DESC
                LIMIT 1`
          );
          const inviteRows = (inviteResult as { rows?: any[] }).rows ?? (inviteResult as any[]);
          const matchingInvitation = Array.isArray(inviteRows) && inviteRows.length > 0 ? inviteRows[0] : null;
          return { ...u, matchingInvitation };
        })
      );

      res.json({ pendingUsers: enriched });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("GET /api/admin/pending-users error:", err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/admin/pending-users/:id/assign — global_admin: any company; company_admin: own company only
  // @ts-ignore
  app.post("/api/admin/pending-users/:id/assign", requireAuth, async (req, res) => {
    try {
      // @ts-ignore
      const reqUser = await storage.getUser(req.user!.id);
      if (!reqUser || (reqUser.role !== "global_admin" && reqUser.role !== "company_admin")) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Explicitly cast to string — Express route params are always strings, never arrays
      const targetUserId: string = String(req.params.id);
      // @ts-ignore
      const targetUser = await storage.getUser(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      if (targetUser.companyId) {
        return res.status(409).json({ error: "User is already assigned to a company" });
      }
      if (targetUser.role === "global_admin") {
        return res.status(400).json({ error: "Cannot reassign a global admin" });
      }

      const { companyId, role, storeIds = [], revokeInvitationId } = req.body;

      if (!companyId || typeof companyId !== "string") {
        return res.status(400).json({ error: "companyId is required" });
      }
      // Company admins may only assign to their own company
      if (reqUser.role === "company_admin" && companyId !== reqUser.companyId) {
        return res.status(403).json({ error: "Company admins can only assign users to their own company" });
      }

      // For company_admin: the target user must have a valid, unexpired, unaccepted invitation
      // for the caller's company. This prevents a company_admin from claiming arbitrary unassigned
      // users who were never invited to their company.
      if (reqUser.role === "company_admin") {
        const inviteCheck = await db.execute(
          sql`SELECT id FROM invitations
              WHERE email = ${targetUser.email}
                AND company_id = ${companyId}
                AND accepted_at IS NULL
                AND expires_at > NOW()
              LIMIT 1`
        );
        const inviteRows = (inviteCheck as { rows?: any[] }).rows ?? (inviteCheck as any[]);
        if (!Array.isArray(inviteRows) || inviteRows.length === 0) {
          return res.status(403).json({
            error: "No valid invitation exists for this user at your company",
          });
        }
      }

      if (!role) {
        return res.status(400).json({ error: "role is required" });
      }
      if (!["company_admin", "store_manager", "store_user"].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      // Verify company exists
      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ error: "Company not found" });
      }

      // --- VALIDATE ALL STORES BEFORE ANY WRITES ---
      // Collect the final resolved store IDs upfront so we never write a partial state.
      let resolvedStoreIds: string[] = [];
      if (role === "company_admin") {
        // Company admins automatically get access to every store in the company.
        const companyStores = await storage.getCompanyStores(companyId);
        resolvedStoreIds = companyStores.map((s) => s.id);
      } else if (Array.isArray(storeIds) && storeIds.length > 0) {
        for (const storeId of storeIds) {
          if (typeof storeId !== "string") {
            return res.status(400).json({ error: "storeIds must be an array of strings" });
          }
          const store = await storage.getCompanyStore(storeId);
          if (!store || store.companyId !== companyId) {
            return res.status(400).json({ error: `Store ${storeId} not found or does not belong to company` });
          }
          resolvedStoreIds.push(storeId);
        }
      }

      // --- ALL VALIDATION PASSED — PERFORM WRITES ---

      // 1. Update user: assign company and role
      // @ts-ignore
      const updatedUser = await storage.updateUser(targetUserId, { companyId, role, active: 1 });

      // 2. Assign the pre-validated stores
      for (const storeId of resolvedStoreIds) {
        await storage.assignUserToStore(targetUserId, storeId);
      }

      // 3. Mark the matching invitation consumed, constrained to this user's email + chosen
      //    company so a tampered or stale revokeInvitationId cannot affect an unrelated invitation.
      if (revokeInvitationId && typeof revokeInvitationId === "string") {
        await db.execute(
          sql`UPDATE invitations
              SET accepted_at = NOW()
              WHERE id = ${revokeInvitationId}
                AND email = ${targetUser.email}
                AND company_id = ${companyId}
                AND accepted_at IS NULL`
        );
      }

      res.json({ user: updatedUser });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("POST /api/admin/pending-users/:id/assign error:", err);
      res.status(500).json({ error: message });
    }
  });
}
