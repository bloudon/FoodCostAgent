/**
 * Menu Portfolio Routes
 *
 * Tenant-safe CRUD for the multi-menu data model:
 *   Menus    — business containers (Dinner, Brunch, Holiday 2026, …)
 *   Sections — ordered presentation sections within one menu
 *   Entries  — placement of a canonical menu_item inside a specific menu
 *
 * All routes are scoped to the authenticated user's companyId.
 * No canonical menu_items, recipes, or POS mappings are modified here.
 */
import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { getAccessibleStores, isGlobalAdmin, isCompanyAdmin } from "../permissions";
import type { ReadinessReport } from "../services/menuReadinessService";

export function registerMenuRoutes(app: Express): void {

  // ── Menus ─────────────────────────────────────────────────────────────────

  /** List all menus for the active company, with entry counts included. */
  app.get("/api/menus", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const user = (req as any).user;
      if (!companyId) return res.status(400).json({ error: "No company selected" });

      // Global admins and company admins see all location names; store-level
      // staff see only the locations they are assigned to.
      let accessibleStoreIds: string[] | null = null;
      if (user && !isGlobalAdmin(user) && !isCompanyAdmin(user)) {
        accessibleStoreIds = await getAccessibleStores(user, companyId);
      }

      const menus = await storage.getMenusWithStats(companyId, accessibleStoreIds);
      res.json(menus);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a new menu (starts in Draft). */
  app.post("/api/menus", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const userId = (req as any).user?.id;
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const { name, menuType, description, effectiveStart, effectiveEnd } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });
      const menu = await storage.createMenu({
        companyId,
        name: name.trim(),
        menuType: menuType ?? null,
        description: description ?? null,
        effectiveStart: effectiveStart ? new Date(effectiveStart) : null,
        effectiveEnd: effectiveEnd ? new Date(effectiveEnd) : null,
        status: "draft",
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      });
      res.status(201).json(menu);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Get a single menu with its sections and entries. */
  app.get("/api/menus/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      const sections = await storage.getMenuSections(req.params.id, companyId);
      const entries  = await storage.getMenuEntries(req.params.id, companyId);
      res.json({ ...menu, sections, entries });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Update menu metadata (name, type, description, dates). */
  app.put("/api/menus/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const userId    = (req as any).user?.id;
      const { name, menuType, description, effectiveStart, effectiveEnd,
              recurrenceDays, recurrenceTimeStart, recurrenceTimeEnd } = req.body;
      const updates: Record<string, any> = { updatedBy: userId ?? null, updatedAt: new Date() };
      if (name !== undefined)                updates.name = name.trim();
      if (menuType !== undefined)            updates.menuType = menuType;
      if (description !== undefined)         updates.description = description;
      if (effectiveStart !== undefined)      updates.effectiveStart = effectiveStart ? new Date(effectiveStart) : null;
      if (effectiveEnd !== undefined)        updates.effectiveEnd = effectiveEnd ? new Date(effectiveEnd) : null;
      if (recurrenceDays !== undefined)      updates.recurrenceDays = Array.isArray(recurrenceDays) ? recurrenceDays : null;
      if (recurrenceTimeStart !== undefined) updates.recurrenceTimeStart = recurrenceTimeStart ?? null;
      if (recurrenceTimeEnd !== undefined)   updates.recurrenceTimeEnd = recurrenceTimeEnd ?? null;
      const menu = await storage.updateMenu(req.params.id, companyId, updates);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      res.json(menu);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Delete a menu — only allowed in draft or retired state. */
  app.delete("/api/menus/:id", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      if (menu.status === "live") {
        return res.status(409).json({ error: "Cannot delete a live menu. Retire it first." });
      }
      await storage.deleteMenu(req.params.id, companyId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Readiness report for a menu — blockers + warnings per entry. */
  app.get("/api/menus/:id/readiness", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      // Confirm menu exists and belongs to this company
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      const report = await storage.computeMenuReadiness(req.params.id, companyId);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Transition menu status.
   *
   * Allowed transitions (enforced at storage layer):
   *   draft → ready  (readiness check run first — 422 if blockers present)
   *   ready → live   (readiness check run first — 422 if blockers present)
   *   ready → draft
   *   live  → retired
   *   retired → draft
   */
  app.post("/api/menus/:id/status", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const userId    = (req as any).user?.id;
      const { status } = req.body;
      const allowed = ["draft", "ready", "scheduled", "live", "retired"];
      if (!status || !allowed.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
      }

      // Validate that effectiveStart is set before scheduling
      if (status === "scheduled") {
        const currentMenu = await storage.getMenu(req.params.id, companyId);
        if (!currentMenu?.effectiveStart) {
          return res.status(400).json({
            error: "effectiveStart is required to schedule a menu. Set it via PUT /api/menus/:id first.",
          });
        }
      }

      // Gate transitions targeting a published state with a readiness check.
      if (status === "ready" || status === "scheduled" || status === "live") {
        const report = await storage.computeMenuReadiness(req.params.id, companyId);
        if (!report.canTransitionToReady) {
          return res.status(422).json({
            error: "Menu has blockers that must be resolved before it can be published",
            report,
          });
        }
      }

      const menu = await storage.transitionMenuStatus(req.params.id, companyId, status, userId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      res.json(menu);
    } catch (err: any) {
      if (err.message?.startsWith("Invalid transition")) {
        return res.status(409).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  /** Duplicate a menu — copies sections, entries, pricing, and overrides. Does not copy canonical items or recipes. */
  app.post("/api/menus/:id/duplicate", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const userId    = (req as any).user?.id;
      const newName   = req.body.name?.trim() ?? null;
      const menu = await storage.duplicateMenu(req.params.id, companyId, newName, userId);
      res.status(201).json(menu);
    } catch (err: any) {
      if (err.message === "Menu not found") return res.status(404).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Menu Sections ─────────────────────────────────────────────────────────

  /** List sections for a menu. */
  app.get("/api/menus/:id/sections", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      const sections = await storage.getMenuSections(req.params.id, companyId);
      res.json(sections);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a new section. */
  app.post("/api/menus/:id/sections", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      const { name, displayOrder } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });
      const section = await storage.createMenuSection({
        menuId: req.params.id,
        companyId,
        name: name.trim(),
        displayOrder: displayOrder ?? 0,
      });
      res.status(201).json(section);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Update a section. */
  app.put("/api/menus/:id/sections/:sectionId", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { name, displayOrder } = req.body;
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (name !== undefined)         updates.name = name.trim();
      if (displayOrder !== undefined) updates.displayOrder = displayOrder;
      const section = await storage.updateMenuSection(req.params.sectionId, companyId, updates);
      if (!section) return res.status(404).json({ error: "Section not found" });
      res.json(section);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Delete a section (entries in this section become unsectioned). */
  app.delete("/api/menus/:id/sections/:sectionId", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      await storage.deleteMenuSection(req.params.sectionId, companyId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Reorder sections. Body: { orders: [{ id, displayOrder }] } */
  app.post("/api/menus/:id/sections/reorder", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { orders } = req.body;
      if (!Array.isArray(orders)) return res.status(400).json({ error: "orders must be an array" });
      await storage.reorderMenuSections(req.params.id, companyId, orders);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Menu Entries ──────────────────────────────────────────────────────────

  /** List entries for a menu (ordered by section + displayOrder). */
  app.get("/api/menus/:id/entries", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      const entries = await storage.getMenuEntries(req.params.id, companyId);
      res.json(entries);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Add a menu item to the menu as an entry. Price defaults to menu_items.price. */
  app.post("/api/menus/:id/entries", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      const { menuItemId, menuSectionId, displayOrder, price, displayNameOverride, descriptionOverride, featured } = req.body;
      if (!menuItemId) return res.status(400).json({ error: "menuItemId is required" });

      // Verify the menu item belongs to this company
      const menuItem = await storage.getMenuItem(menuItemId);
      if (!menuItem || menuItem.companyId !== companyId) {
        return res.status(404).json({ error: "Menu item not found" });
      }

      // Copy price from canonical item if not overridden
      const entryPrice = price !== undefined ? price : (menuItem.price ?? null);

      try {
        const entry = await storage.createMenuEntry({
          menuId: req.params.id,
          menuSectionId: menuSectionId ?? null,
          menuItemId,
          companyId,
          displayOrder: displayOrder ?? 0,
          price: entryPrice,
          displayNameOverride: displayNameOverride ?? null,
          descriptionOverride: descriptionOverride ?? null,
          featured: featured ? 1 : 0,
          active: 1,
        });
        res.status(201).json(entry);
      } catch (insertErr: any) {
        if (insertErr.message?.includes("unique") || insertErr.message?.includes("duplicate") || insertErr.code === "23505") {
          return res.status(409).json({ error: "This item is already on the menu." });
        }
        throw insertErr;
      }
    } catch (err: any) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /** Update an entry (price, overrides, section, displayOrder, featured, active). */
  app.put("/api/menus/:id/entries/:entryId", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const allowed = ["price", "displayNameOverride", "descriptionOverride", "menuSectionId", "displayOrder", "featured", "active", "forecastQty", "forecastPct"];
      const updates: Record<string, any> = { updatedAt: new Date() };
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          updates[key] = req.body[key];
        }
      }
      if (req.body.featured !== undefined) updates.featured = req.body.featured ? 1 : 0;
      if (req.body.active !== undefined)   updates.active   = req.body.active ? 1 : 0;
      const entry = await storage.updateMenuEntry(req.params.entryId, companyId, updates);
      if (!entry) return res.status(404).json({ error: "Entry not found" });
      res.json(entry);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Remove an item from a menu (does not delete the canonical item). */
  app.delete("/api/menus/:id/entries/:entryId", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      await storage.deleteMenuEntry(req.params.entryId, companyId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Reorder entries. Body: { orders: [{ id, displayOrder }] } */
  app.post("/api/menus/:id/entries/reorder", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { orders } = req.body;
      if (!Array.isArray(orders)) return res.status(400).json({ error: "orders must be an array" });
      await storage.reorderMenuEntries(req.params.id, companyId, orders);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Menu Location Assignments ─────────────────────────────────────────────

  /** List store locations assigned to a menu. */
  app.get("/api/menus/:id/locations", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const user = (req as any).user;
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });

      // Global admins and company admins see all location assignments; store-level
      // staff see only the locations they are assigned to.
      let accessibleStoreIds: string[] | null = null;
      if (user && !isGlobalAdmin(user) && !isCompanyAdmin(user)) {
        accessibleStoreIds = await getAccessibleStores(user, companyId);
      }

      const assignments = await storage.getMenuLocationAssignments(req.params.id, companyId, accessibleStoreIds);
      res.json(assignments);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Assign a store location to a menu. Body: { storeId } */
  app.post("/api/menus/:id/locations", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const { storeId } = req.body;
      if (!storeId) return res.status(400).json({ error: "storeId is required" });
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      const assignment = await storage.addMenuLocationAssignment(req.params.id, storeId, companyId);
      res.status(201).json(assignment);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Remove a store location from a menu. */
  app.delete("/api/menus/:id/locations/:storeId", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      await storage.removeMenuLocationAssignment(req.params.id, req.params.storeId, companyId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Menu Forecast ─────────────────────────────────────────────────────────

  /**
   * Weighted forecast for a menu: projected revenue, food cost, gross margin,
   * and per-entry POS history suggestions.
   *
   * Requires at least one entry to have a forecastQty; otherwise returns an
   * empty report indicating no forecast data has been entered yet.
   */
  app.get("/api/menus/:id/forecast", requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId;
      if (!companyId) return res.status(400).json({ error: "No company selected" });
      const menu = await storage.getMenu(req.params.id, companyId);
      if (!menu) return res.status(404).json({ error: "Menu not found" });
      const report = await storage.computeMenuForecast(req.params.id, companyId);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
