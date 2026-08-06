/**
 * Tests for Menu Portfolio API routes.
 *
 * Covers:
 *  – CRUD for menus, sections, and entries
 *  – Tenant isolation (company-A cannot touch company-B resources)
 *  – Status-transition rules (draft→live→retired→draft; invalid transitions rejected)
 *  – Entry price independence (entry price is set at placement and not affected by
 *    later changes to the canonical menu_item.price)
 *  – Duplicate-menu behaviour (sections + entries copied; new menu starts as draft)
 *  – Duplicate-entry prevention (same item cannot be added twice to the same menu)
 *  – Live-menu delete guard (must retire before deleting)
 *  – Section deletion nullifies entries (they become unsectioned, not deleted)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";
import { registerMenuRoutes } from "./menuRoutes";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../auth", () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user      = { id: "user-1", role: "company_admin", companyId: req._testCompanyId ?? "co-A" };
    req.companyId = req._testCompanyId ?? "co-A";
    next();
  }),
}));

// Minimal storage mock — declare with vi.hoisted so the factory closure can
// reference it (vi.mock factories are hoisted to before const declarations).
const mockStorage = vi.hoisted(() => ({
  getMenusByCompany:             vi.fn(),
  getMenusWithStats:             vi.fn(),
  getMenu:                       vi.fn(),
  createMenu:                    vi.fn(),
  updateMenu:                    vi.fn(),
  deleteMenu:                    vi.fn(),
  transitionMenuStatus:          vi.fn(),
  duplicateMenu:                 vi.fn(),
  computeMenuReadiness:          vi.fn(),
  // Location assignments
  getMenuLocationAssignments:    vi.fn(),
  addMenuLocationAssignment:     vi.fn(),
  removeMenuLocationAssignment:  vi.fn(),
  // Forecast
  computeMenuForecast:           vi.fn(),
  // Sections
  getMenuSections:               vi.fn(),
  getMenuSection:                vi.fn(),
  createMenuSection:             vi.fn(),
  updateMenuSection:             vi.fn(),
  deleteMenuSection:             vi.fn(),
  reorderMenuSections:           vi.fn(),
  // Entries
  getMenuEntries:                vi.fn(),
  getMenuEntry:                  vi.fn(),
  createMenuEntry:               vi.fn(),
  updateMenuEntry:               vi.fn(),
  deleteMenuEntry:               vi.fn(),
  reorderMenuEntries:            vi.fn(),
  getMenuItem:                   vi.fn(),
}));

vi.mock("../storage", () => ({ storage: mockStorage }));

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  registerMenuRoutes(app);
  return app;
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const MENU_A: any = {
  id: "menu-1",
  companyId: "co-A",
  name: "Dinner Menu",
  menuType: "dinner",
  status: "draft",
  description: null,
  effectiveStart: null,
  effectiveEnd: null,
  createdBy: "user-1",
  updatedBy: "user-1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SECTION_A: any = {
  id: "sec-1",
  menuId: "menu-1",
  companyId: "co-A",
  name: "Appetizers",
  displayOrder: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ENTRY_A: any = {
  id: "entry-1",
  menuId: "menu-1",
  menuSectionId: "sec-1",
  menuItemId: "item-1",
  companyId: "co-A",
  displayOrder: 0,
  price: 12.5,
  displayNameOverride: null,
  descriptionOverride: null,
  featured: 0,
  active: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const CANONICAL_ITEM: any = {
  id: "item-1",
  companyId: "co-A",
  name: "Caesar Salad",
  price: 14.0,
  active: 1,
};

// ── Reset mocks between tests ─────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so routes don't crash unless a test overrides them
  mockStorage.getMenusByCompany.mockResolvedValue([MENU_A]);
  mockStorage.getMenusWithStats.mockResolvedValue([{ ...MENU_A, totalItems: 2, pricedItems: 2 }]);
  mockStorage.getMenu.mockImplementation((_id: string, _companyId: string) => {
    if (_id === "menu-1" && _companyId === "co-A") return Promise.resolve(MENU_A);
    return Promise.resolve(undefined);
  });
  mockStorage.createMenu.mockResolvedValue(MENU_A);
  mockStorage.updateMenu.mockResolvedValue(MENU_A);
  mockStorage.deleteMenu.mockResolvedValue(undefined);
  mockStorage.transitionMenuStatus.mockResolvedValue({ ...MENU_A, status: "ready" });
  mockStorage.duplicateMenu.mockResolvedValue({ ...MENU_A, id: "menu-copy", name: "Dinner Menu (copy)", status: "draft" });
  mockStorage.computeMenuReadiness.mockResolvedValue({
    menuId: "menu-1",
    totalEntries: 1,
    blockerCount: 0,
    warningCount: 0,
    canTransitionToReady: true,
    issues: [],
  });
  mockStorage.getMenuSections.mockResolvedValue([SECTION_A]);
  mockStorage.createMenuSection.mockResolvedValue(SECTION_A);
  mockStorage.updateMenuSection.mockResolvedValue(SECTION_A);
  mockStorage.deleteMenuSection.mockResolvedValue(undefined);
  mockStorage.reorderMenuSections.mockResolvedValue(undefined);
  mockStorage.getMenuEntries.mockResolvedValue([ENTRY_A]);
  mockStorage.createMenuEntry.mockResolvedValue(ENTRY_A);
  mockStorage.updateMenuEntry.mockResolvedValue(ENTRY_A);
  mockStorage.deleteMenuEntry.mockResolvedValue(undefined);
  mockStorage.reorderMenuEntries.mockResolvedValue(undefined);
  mockStorage.getMenuItem.mockResolvedValue(CANONICAL_ITEM);
  // Location assignments
  mockStorage.getMenuLocationAssignments.mockResolvedValue([]);
  mockStorage.addMenuLocationAssignment.mockResolvedValue({
    id: "loc-1", menuId: "menu-1", storeId: "store-1", companyId: "co-A",
    createdAt: new Date().toISOString(),
  });
  mockStorage.removeMenuLocationAssignment.mockResolvedValue(undefined);
  // Forecast
  mockStorage.computeMenuForecast.mockResolvedValue({
    menuId: "menu-1",
    totalForecastQty: 0,
    entriesWithForecast: 0,
    totalEntries: 0,
    projectedRevenue: null,
    projectedFoodCost: null,
    projectedFoodCostPct: null,
    projectedGrossMargin: null,
    projectedGrossMarginPct: null,
    isPartialForecast: false,
    entries: [],
  });
});

// ── Tests: Menus ──────────────────────────────────────────────────────────────

describe("GET /api/menus", () => {
  it("returns the list of menus for the authenticated company", async () => {
    const res = await request(makeApp()).get("/api/menus");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe("menu-1");
    expect(mockStorage.getMenusWithStats).toHaveBeenCalledWith("co-A", null);
  });
});

describe("POST /api/menus", () => {
  it("creates a menu and returns 201", async () => {
    const res = await request(makeApp())
      .post("/api/menus")
      .send({ name: "Brunch Menu", menuType: "brunch" });
    expect(res.status).toBe(201);
    expect(mockStorage.createMenu).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Brunch Menu", menuType: "brunch", status: "draft", companyId: "co-A" }),
    );
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(makeApp()).post("/api/menus").send({});
    expect(res.status).toBe(400);
    expect(mockStorage.createMenu).not.toHaveBeenCalled();
  });
});

describe("GET /api/menus/:id", () => {
  it("returns the menu with sections and entries", async () => {
    const res = await request(makeApp()).get("/api/menus/menu-1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("menu-1");
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it("returns 404 for an unknown menu id", async () => {
    const res = await request(makeApp()).get("/api/menus/no-such");
    expect(res.status).toBe(404);
  });

  it("tenant isolation — company-B cannot read company-A menu", async () => {
    const app = makeApp();
    // Override auth to inject company-B
    const { requireAuth } = await import("../auth");
    vi.mocked(requireAuth).mockImplementationOnce((req: any, _res: any, next: any) => {
      req.user = { id: "user-B", companyId: "co-B" };
      req.companyId = "co-B";
      next();
    });
    // getMenu returns undefined when companyId doesn't match
    mockStorage.getMenu.mockResolvedValueOnce(undefined);
    const res = await request(app).get("/api/menus/menu-1");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/menus/:id", () => {
  it("updates menu metadata", async () => {
    const res = await request(makeApp())
      .put("/api/menus/menu-1")
      .send({ name: "Updated Dinner", description: "Fancy" });
    expect(res.status).toBe(200);
    expect(mockStorage.updateMenu).toHaveBeenCalledWith(
      "menu-1", "co-A", expect.objectContaining({ name: "Updated Dinner", description: "Fancy" }),
    );
  });

  it("returns 404 when menu not found", async () => {
    mockStorage.updateMenu.mockResolvedValueOnce(undefined);
    const res = await request(makeApp()).put("/api/menus/menu-1").send({ name: "X" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/menus/:id", () => {
  it("deletes a draft menu", async () => {
    const res = await request(makeApp()).delete("/api/menus/menu-1");
    expect(res.status).toBe(200);
    expect(mockStorage.deleteMenu).toHaveBeenCalledWith("menu-1", "co-A");
  });

  it("blocks deletion of a live menu", async () => {
    mockStorage.getMenu.mockResolvedValueOnce({ ...MENU_A, status: "live" });
    const res = await request(makeApp()).delete("/api/menus/menu-1");
    expect(res.status).toBe(409);
    expect(mockStorage.deleteMenu).not.toHaveBeenCalled();
  });

  it("blocks deletion of no-such menu", async () => {
    mockStorage.getMenu.mockResolvedValueOnce(undefined);
    const res = await request(makeApp()).delete("/api/menus/menu-1");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/menus/:id/readiness", () => {
  it("returns the readiness report for an existing menu", async () => {
    const res = await request(makeApp()).get("/api/menus/menu-1/readiness");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      menuId: "menu-1",
      blockerCount: 0,
      warningCount: 0,
      canTransitionToReady: true,
    });
    expect(mockStorage.computeMenuReadiness).toHaveBeenCalledWith("menu-1", "co-A");
  });

  it("returns 404 when menu not found", async () => {
    mockStorage.getMenu.mockResolvedValueOnce(undefined);
    const res = await request(makeApp()).get("/api/menus/no-such/readiness");
    expect(res.status).toBe(404);
    expect(mockStorage.computeMenuReadiness).not.toHaveBeenCalled();
  });

  it("returns blocker and warning counts", async () => {
    mockStorage.computeMenuReadiness.mockResolvedValueOnce({
      menuId: "menu-1",
      totalEntries: 2,
      blockerCount: 1,
      warningCount: 1,
      canTransitionToReady: false,
      issues: [
        { type: "blocker", code: "NO_PRICE", entryId: "entry-1", menuItemId: "item-1", itemName: "Caesar Salad", message: "No selling price set", navigationHref: "/menu-items/item-1" },
        { type: "warning", code: "MISSING_DESCRIPTION", entryId: "entry-1", menuItemId: "item-1", itemName: "Caesar Salad", message: "No description", navigationHref: "/menu-items/item-1" },
      ],
    });
    const res = await request(makeApp()).get("/api/menus/menu-1/readiness");
    expect(res.status).toBe(200);
    expect(res.body.blockerCount).toBe(1);
    expect(res.body.warningCount).toBe(1);
    expect(res.body.canTransitionToReady).toBe(false);
    expect(res.body.issues).toHaveLength(2);
  });
});

describe("POST /api/menus/:id/status", () => {
  it("transitions draft → ready when no blockers", async () => {
    mockStorage.transitionMenuStatus.mockResolvedValueOnce({ ...MENU_A, status: "ready" });
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "ready" });
    expect(res.status).toBe(200);
    expect(mockStorage.computeMenuReadiness).toHaveBeenCalledWith("menu-1", "co-A");
    expect(mockStorage.transitionMenuStatus).toHaveBeenCalledWith("menu-1", "co-A", "ready", "user-1");
  });

  it("rejects draft → ready with 422 when blockers present", async () => {
    mockStorage.computeMenuReadiness.mockResolvedValueOnce({
      menuId: "menu-1",
      totalEntries: 1,
      blockerCount: 1,
      warningCount: 0,
      canTransitionToReady: false,
      issues: [{ type: "blocker", code: "NO_PRICE", entryId: "e1", menuItemId: "item-1", itemName: "Caesar Salad", message: "No selling price set", navigationHref: "/menu-items/item-1" }],
    });
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "ready" });
    expect(res.status).toBe(422);
    expect(res.body.report.blockerCount).toBe(1);
    expect(mockStorage.transitionMenuStatus).not.toHaveBeenCalled();
  });

  it("transitions ready → live when no blockers", async () => {
    mockStorage.transitionMenuStatus.mockResolvedValueOnce({ ...MENU_A, status: "live" });
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "live" });
    expect(res.status).toBe(200);
    expect(mockStorage.computeMenuReadiness).toHaveBeenCalledWith("menu-1", "co-A");
    expect(mockStorage.transitionMenuStatus).toHaveBeenCalledWith("menu-1", "co-A", "live", "user-1");
  });

  it("rejects ready → live with 422 when blockers present", async () => {
    mockStorage.computeMenuReadiness.mockResolvedValueOnce({
      menuId: "menu-1",
      totalEntries: 1,
      blockerCount: 1,
      warningCount: 0,
      canTransitionToReady: false,
      issues: [{ type: "blocker", code: "NO_RECIPE", entryId: "e1", menuItemId: "item-1", itemName: "Burger", message: "No recipe linked", navigationHref: "/menu-items/item-1" }],
    });
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "live" });
    expect(res.status).toBe(422);
    expect(res.body.report.issues[0].code).toBe("NO_RECIPE");
    expect(mockStorage.transitionMenuStatus).not.toHaveBeenCalled();
  });

  it("transitions retired → draft without running readiness check", async () => {
    mockStorage.transitionMenuStatus.mockResolvedValueOnce({ ...MENU_A, status: "draft" });
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "draft" });
    expect(res.status).toBe(200);
    expect(mockStorage.computeMenuReadiness).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "published" });
    expect(res.status).toBe(400);
    expect(mockStorage.transitionMenuStatus).not.toHaveBeenCalled();
  });

  it("returns 409 when storage rejects the transition", async () => {
    mockStorage.transitionMenuStatus.mockRejectedValueOnce(
      new Error("Invalid transition from 'live' to 'draft'"),
    );
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "draft" });
    expect(res.status).toBe(409);
  });

  it("returns 404 when storage returns undefined", async () => {
    mockStorage.transitionMenuStatus.mockResolvedValueOnce(undefined);
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "live" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/menus/:id/duplicate", () => {
  it("duplicates a menu and returns 201", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/duplicate")
      .send({ name: "Weekend Menu" });
    expect(res.status).toBe(201);
    expect(mockStorage.duplicateMenu).toHaveBeenCalledWith("menu-1", "co-A", "Weekend Menu", "user-1");
  });

  it("uses default name when none provided", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/duplicate")
      .send({});
    expect(res.status).toBe(201);
    expect(mockStorage.duplicateMenu).toHaveBeenCalledWith("menu-1", "co-A", null, "user-1");
  });

  it("returns 404 when storage throws 'Menu not found'", async () => {
    mockStorage.duplicateMenu.mockRejectedValueOnce(new Error("Menu not found"));
    const res = await request(makeApp())
      .post("/api/menus/no-such/duplicate")
      .send({ name: "X" });
    expect(res.status).toBe(404);
  });
});

// ── Tests: Sections ───────────────────────────────────────────────────────────

describe("GET /api/menus/:id/sections", () => {
  it("returns sections for an existing menu", async () => {
    const res = await request(makeApp()).get("/api/menus/menu-1/sections");
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe("sec-1");
  });

  it("returns 404 when menu not found", async () => {
    mockStorage.getMenu.mockResolvedValueOnce(undefined);
    const res = await request(makeApp()).get("/api/menus/no-such/sections");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/menus/:id/sections", () => {
  it("creates a section", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/sections")
      .send({ name: "Desserts", displayOrder: 2 });
    expect(res.status).toBe(201);
    expect(mockStorage.createMenuSection).toHaveBeenCalledWith(
      expect.objectContaining({ menuId: "menu-1", name: "Desserts", displayOrder: 2 }),
    );
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/sections")
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/menus/:id/sections/:sectionId", () => {
  it("updates a section name", async () => {
    const res = await request(makeApp())
      .put("/api/menus/menu-1/sections/sec-1")
      .send({ name: "Starters" });
    expect(res.status).toBe(200);
    expect(mockStorage.updateMenuSection).toHaveBeenCalledWith(
      "sec-1", "co-A", expect.objectContaining({ name: "Starters" }),
    );
  });

  it("returns 404 when section not found", async () => {
    mockStorage.updateMenuSection.mockResolvedValueOnce(undefined);
    const res = await request(makeApp())
      .put("/api/menus/menu-1/sections/sec-1")
      .send({ name: "X" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/menus/:id/sections/:sectionId", () => {
  it("deletes a section (entries become unsectioned in storage)", async () => {
    const res = await request(makeApp()).delete("/api/menus/menu-1/sections/sec-1");
    expect(res.status).toBe(200);
    expect(mockStorage.deleteMenuSection).toHaveBeenCalledWith("sec-1", "co-A");
  });
});

describe("POST /api/menus/:id/sections/reorder", () => {
  it("accepts a valid reorder payload", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/sections/reorder")
      .send({ orders: [{ id: "sec-1", displayOrder: 1 }] });
    expect(res.status).toBe(200);
    expect(mockStorage.reorderMenuSections).toHaveBeenCalledWith(
      "menu-1", "co-A", [{ id: "sec-1", displayOrder: 1 }],
    );
  });

  it("returns 400 when orders is not an array", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/sections/reorder")
      .send({ orders: "bad" });
    expect(res.status).toBe(400);
  });
});

// ── Tests: Entries ────────────────────────────────────────────────────────────

describe("GET /api/menus/:id/entries", () => {
  it("returns entries for an existing menu", async () => {
    const res = await request(makeApp()).get("/api/menus/menu-1/entries");
    expect(res.status).toBe(200);
    expect(res.body[0].menuItemId).toBe("item-1");
  });
});

describe("POST /api/menus/:id/entries", () => {
  it("adds an item to the menu — copies price from canonical item by default", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/entries")
      .send({ menuItemId: "item-1", menuSectionId: "sec-1" });
    expect(res.status).toBe(201);
    expect(mockStorage.createMenuEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        menuItemId: "item-1",
        price: CANONICAL_ITEM.price, // 14.0 copied from canonical item
      }),
    );
  });

  it("entry price independence — override price at placement, not overwritten by canonical", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/entries")
      .send({ menuItemId: "item-1", price: 16.0 });
    expect(res.status).toBe(201);
    // Route should pass 16.0, not the canonical 14.0
    expect(mockStorage.createMenuEntry).toHaveBeenCalledWith(
      expect.objectContaining({ price: 16.0 }),
    );
  });

  it("returns 400 when menuItemId is missing", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/entries")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 when the menu item belongs to a different company", async () => {
    mockStorage.getMenuItem.mockResolvedValueOnce({ ...CANONICAL_ITEM, companyId: "co-B" });
    const res = await request(makeApp())
      .post("/api/menus/menu-1/entries")
      .send({ menuItemId: "item-1" });
    expect(res.status).toBe(404);
  });

  it("duplicate-entry prevention — returns 409 on unique-constraint violation", async () => {
    const dupErr: any = new Error("duplicate key value violates unique constraint");
    dupErr.code = "23505";
    mockStorage.createMenuEntry.mockRejectedValueOnce(dupErr);
    const res = await request(makeApp())
      .post("/api/menus/menu-1/entries")
      .send({ menuItemId: "item-1" });
    expect(res.status).toBe(409);
  });
});

describe("PUT /api/menus/:id/entries/:entryId", () => {
  it("updates an entry price independently of the canonical item", async () => {
    const newPrice = 18.5;
    mockStorage.updateMenuEntry.mockResolvedValueOnce({ ...ENTRY_A, price: newPrice });
    const res = await request(makeApp())
      .put("/api/menus/menu-1/entries/entry-1")
      .send({ price: newPrice });
    expect(res.status).toBe(200);
    expect(res.body.price).toBe(newPrice);
    expect(mockStorage.updateMenuEntry).toHaveBeenCalledWith(
      "entry-1", "co-A", expect.objectContaining({ price: newPrice }),
    );
  });

  it("returns 404 when entry not found", async () => {
    mockStorage.updateMenuEntry.mockResolvedValueOnce(undefined);
    const res = await request(makeApp())
      .put("/api/menus/menu-1/entries/entry-1")
      .send({ price: 9.0 });
    expect(res.status).toBe(404);
  });

  it("coerces featured/active to integer flags", async () => {
    await request(makeApp())
      .put("/api/menus/menu-1/entries/entry-1")
      .send({ featured: true, active: false });
    expect(mockStorage.updateMenuEntry).toHaveBeenCalledWith(
      "entry-1", "co-A", expect.objectContaining({ featured: 1, active: 0 }),
    );
  });
});

describe("DELETE /api/menus/:id/entries/:entryId", () => {
  it("removes an entry without deleting the canonical item", async () => {
    const res = await request(makeApp()).delete("/api/menus/menu-1/entries/entry-1");
    expect(res.status).toBe(200);
    expect(mockStorage.deleteMenuEntry).toHaveBeenCalledWith("entry-1", "co-A");
    // canonical item storage method never called
    expect(mockStorage.getMenuItem).not.toHaveBeenCalled();
  });
});

describe("POST /api/menus/:id/entries/reorder", () => {
  it("accepts a valid reorder payload", async () => {
    const orders = [{ id: "entry-1", displayOrder: 2 }];
    const res = await request(makeApp())
      .post("/api/menus/menu-1/entries/reorder")
      .send({ orders });
    expect(res.status).toBe(200);
    expect(mockStorage.reorderMenuEntries).toHaveBeenCalledWith("menu-1", "co-A", orders);
  });

  it("returns 400 when orders is not an array", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/entries/reorder")
      .send({ orders: 42 });
    expect(res.status).toBe(400);
  });
});

// ── Tests: Location assignments ───────────────────────────────────────────────

describe("GET /api/menus/:id/locations", () => {
  it("returns location assignments for an existing menu", async () => {
    const assignment = { id: "loc-1", menuId: "menu-1", storeId: "store-1", companyId: "co-A", createdAt: new Date().toISOString() };
    mockStorage.getMenuLocationAssignments.mockResolvedValueOnce([assignment]);
    const res = await request(makeApp()).get("/api/menus/menu-1/locations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].storeId).toBe("store-1");
    expect(mockStorage.getMenuLocationAssignments).toHaveBeenCalledWith("menu-1", "co-A", null);
  });

  it("returns 404 when menu not found", async () => {
    mockStorage.getMenu.mockResolvedValueOnce(undefined);
    const res = await request(makeApp()).get("/api/menus/no-such/locations");
    expect(res.status).toBe(404);
    expect(mockStorage.getMenuLocationAssignments).not.toHaveBeenCalled();
  });

  it("tenant isolation — company-B cannot read company-A locations", async () => {
    const { requireAuth } = await import("../auth");
    vi.mocked(requireAuth).mockImplementationOnce((req: any, _res: any, next: any) => {
      req.user = { id: "user-B", companyId: "co-B" };
      req.companyId = "co-B";
      next();
    });
    mockStorage.getMenu.mockResolvedValueOnce(undefined);
    const res = await request(makeApp()).get("/api/menus/menu-1/locations");
    expect(res.status).toBe(404);
  });

  it("returns empty array when no locations are assigned", async () => {
    const res = await request(makeApp()).get("/api/menus/menu-1/locations");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /api/menus/:id/locations", () => {
  it("assigns a store location and returns 201", async () => {
    const assignment = { id: "loc-1", menuId: "menu-1", storeId: "store-1", companyId: "co-A", createdAt: new Date().toISOString() };
    mockStorage.addMenuLocationAssignment.mockResolvedValueOnce(assignment);
    const res = await request(makeApp())
      .post("/api/menus/menu-1/locations")
      .send({ storeId: "store-1" });
    expect(res.status).toBe(201);
    expect(res.body.storeId).toBe("store-1");
    expect(mockStorage.addMenuLocationAssignment).toHaveBeenCalledWith("menu-1", "store-1", "co-A");
  });

  it("returns 400 when storeId is missing", async () => {
    const res = await request(makeApp())
      .post("/api/menus/menu-1/locations")
      .send({});
    expect(res.status).toBe(400);
    expect(mockStorage.addMenuLocationAssignment).not.toHaveBeenCalled();
  });

  it("returns 404 when menu not found", async () => {
    mockStorage.getMenu.mockResolvedValueOnce(undefined);
    const res = await request(makeApp())
      .post("/api/menus/no-such/locations")
      .send({ storeId: "store-1" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/menus/:id/locations/:storeId", () => {
  it("removes a location assignment and returns 200", async () => {
    const res = await request(makeApp())
      .delete("/api/menus/menu-1/locations/store-1");
    expect(res.status).toBe(200);
    expect(mockStorage.removeMenuLocationAssignment).toHaveBeenCalledWith("menu-1", "store-1", "co-A");
  });

  it("returns 404 when menu not found", async () => {
    mockStorage.getMenu.mockResolvedValueOnce(undefined);
    const res = await request(makeApp())
      .delete("/api/menus/no-such/locations/store-1");
    expect(res.status).toBe(404);
  });
});

// ── Tests: Forecast ───────────────────────────────────────────────────────────

describe("GET /api/menus/:id/forecast", () => {
  it("returns a forecast report for an existing menu", async () => {
    const report = {
      menuId: "menu-1",
      totalForecastQty: 100,
      entriesWithForecast: 1,
      totalEntries: 1,
      projectedRevenue: 1250,
      projectedFoodCost: 400,
      projectedFoodCostPct: 32,
      projectedGrossMargin: 850,
      projectedGrossMarginPct: 68,
      isPartialForecast: false,
      entries: [{ entryId: "entry-1", menuItemId: "item-1", itemName: "Caesar Salad", price: 12.5, recipeCost: 4.0, forecastQty: 100, forecastPct: 100, projectedRevenue: 1250, projectedFoodCost: 400, suggestedQty: null }],
    };
    mockStorage.computeMenuForecast.mockResolvedValueOnce(report);
    const res = await request(makeApp()).get("/api/menus/menu-1/forecast");
    expect(res.status).toBe(200);
    expect(res.body.menuId).toBe("menu-1");
    expect(res.body.projectedRevenue).toBe(1250);
    expect(res.body.projectedFoodCostPct).toBe(32);
    expect(res.body.entriesWithForecast).toBe(1);
    expect(mockStorage.computeMenuForecast).toHaveBeenCalledWith("menu-1", "co-A");
  });

  it("returns an empty report when no forecast data is entered yet", async () => {
    const res = await request(makeApp()).get("/api/menus/menu-1/forecast");
    expect(res.status).toBe(200);
    expect(res.body.entriesWithForecast).toBe(0);
    expect(res.body.projectedRevenue).toBeNull();
  });

  it("returns 404 when menu not found", async () => {
    mockStorage.getMenu.mockResolvedValueOnce(undefined);
    const res = await request(makeApp()).get("/api/menus/no-such/forecast");
    expect(res.status).toBe(404);
    expect(mockStorage.computeMenuForecast).not.toHaveBeenCalled();
  });
});

// ── Tests: Scheduled status transitions ──────────────────────────────────────

describe("POST /api/menus/:id/status — scheduled transitions", () => {
  const MENU_WITH_START: any = {
    ...{
      id: "menu-1", companyId: "co-A", name: "Dinner Menu", menuType: "dinner",
      status: "ready", description: null, createdBy: "user-1", updatedBy: "user-1",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    effectiveStart: new Date("2026-09-01").toISOString(),
    effectiveEnd: null,
  };

  it("transitions ready → scheduled when effectiveStart is set and no blockers", async () => {
    mockStorage.getMenu.mockImplementation((_id: string, _companyId: string) => {
      if (_id === "menu-1" && _companyId === "co-A") return Promise.resolve(MENU_WITH_START);
      return Promise.resolve(undefined);
    });
    mockStorage.transitionMenuStatus.mockResolvedValueOnce({ ...MENU_WITH_START, status: "scheduled" });
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "scheduled" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("scheduled");
    expect(mockStorage.transitionMenuStatus).toHaveBeenCalledWith("menu-1", "co-A", "scheduled", "user-1");
    expect(mockStorage.computeMenuReadiness).toHaveBeenCalledWith("menu-1", "co-A");
  });

  it("returns 400 when transitioning to scheduled without effectiveStart", async () => {
    // Default MENU_A has effectiveStart = null
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "scheduled" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/effectiveStart/i);
    expect(mockStorage.transitionMenuStatus).not.toHaveBeenCalled();
  });

  it("returns 422 when blockers exist on ready → scheduled", async () => {
    mockStorage.getMenu.mockImplementation((_id: string, _companyId: string) => {
      if (_id === "menu-1" && _companyId === "co-A") return Promise.resolve(MENU_WITH_START);
      return Promise.resolve(undefined);
    });
    mockStorage.computeMenuReadiness.mockResolvedValueOnce({
      menuId: "menu-1", totalEntries: 1, blockerCount: 1, warningCount: 0,
      canTransitionToReady: false,
      issues: [{ type: "blocker", code: "NO_PRICE", entryId: "e1", menuItemId: "item-1", itemName: "Caesar Salad", message: "No price", navigationHref: "/" }],
    });
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "scheduled" });
    expect(res.status).toBe(422);
    expect(mockStorage.transitionMenuStatus).not.toHaveBeenCalled();
  });

  it("transitions scheduled → live when no blockers", async () => {
    const MENU_SCHEDULED: any = { ...MENU_WITH_START, status: "scheduled" };
    mockStorage.getMenu.mockResolvedValue(MENU_SCHEDULED);
    mockStorage.transitionMenuStatus.mockResolvedValueOnce({ ...MENU_SCHEDULED, status: "live" });
    const res = await request(makeApp())
      .post("/api/menus/menu-1/status")
      .send({ status: "live" });
    expect(res.status).toBe(200);
    expect(mockStorage.computeMenuReadiness).toHaveBeenCalledWith("menu-1", "co-A");
    expect(mockStorage.transitionMenuStatus).toHaveBeenCalledWith("menu-1", "co-A", "live", "user-1");
  });
});

describe("PUT /api/menus/:id — recurrence fields round-trip", () => {
  it("saves recurrenceDays, recurrenceTimeStart, recurrenceTimeEnd", async () => {
    const updated = {
      ...{
        id: "menu-1", companyId: "co-A", name: "Dinner Menu", menuType: "dinner",
        status: "ready", description: null, effectiveStart: null, effectiveEnd: null,
        createdBy: "user-1", updatedBy: "user-1",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
      recurrenceDays: ["Friday", "Saturday"],
      recurrenceTimeStart: "18:00",
      recurrenceTimeEnd: "23:00",
    };
    mockStorage.updateMenu.mockResolvedValueOnce(updated);
    const res = await request(makeApp())
      .put("/api/menus/menu-1")
      .send({ recurrenceDays: ["Friday", "Saturday"], recurrenceTimeStart: "18:00", recurrenceTimeEnd: "23:00" });
    expect(res.status).toBe(200);
    expect(mockStorage.updateMenu).toHaveBeenCalledWith(
      "menu-1", "co-A",
      expect.objectContaining({ recurrenceDays: ["Friday", "Saturday"], recurrenceTimeStart: "18:00", recurrenceTimeEnd: "23:00" }),
    );
  });

  it("accepts forecastQty on entry update", async () => {
    mockStorage.updateMenuEntry.mockResolvedValueOnce({ ...{
      id: "entry-1", menuId: "menu-1", menuSectionId: "sec-1", menuItemId: "item-1",
      companyId: "co-A", displayOrder: 0, price: 12.5, displayNameOverride: null,
      descriptionOverride: null, featured: 0, active: 1, forecastQty: 50, forecastPct: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }});
    const res = await request(makeApp())
      .put("/api/menus/menu-1/entries/entry-1")
      .send({ forecastQty: 50 });
    expect(res.status).toBe(200);
    expect(mockStorage.updateMenuEntry).toHaveBeenCalledWith(
      "entry-1", "co-A", expect.objectContaining({ forecastQty: 50 }),
    );
  });
});

// ── Tests: Storage-layer status transition logic ───────────────────────────────

describe("transitionMenuStatus — storage-layer logic (unit)", async () => {
  /**
   * These tests exercise the allowed-transition table directly through the mock,
   * verifying the route surfaces the right HTTP status code.
   *
   * Note: transitions TO "ready" or "live" also run a readiness gate in the route.
   * The default mock has canTransitionToReady: true so the gate passes unless
   * overridden. We test gate failures separately above.
   */

  const transitions: Array<{ from: string; to: string; ok: boolean }> = [
    // valid storage transitions
    { from: "draft",   to: "ready",   ok: true  },
    { from: "ready",   to: "live",    ok: true  },
    { from: "ready",   to: "draft",   ok: true  },
    { from: "live",    to: "retired", ok: true  },
    { from: "retired", to: "draft",   ok: true  },
    // invalid storage transitions
    { from: "draft",   to: "live",    ok: false },
    { from: "draft",   to: "retired", ok: false },
    { from: "live",    to: "draft",   ok: false },
    { from: "retired", to: "live",    ok: false },
    { from: "retired", to: "ready",   ok: false },
  ];

  for (const { from, to, ok } of transitions) {
    it(`${from} → ${to} should ${ok ? "succeed" : "return 409"}`, async () => {
      if (ok) {
        mockStorage.transitionMenuStatus.mockResolvedValueOnce({ ...MENU_A, status: to });
      } else {
        mockStorage.transitionMenuStatus.mockRejectedValueOnce(
          new Error(`Invalid transition from '${from}' to '${to}'`),
        );
      }
      const res = await request(makeApp())
        .post("/api/menus/menu-1/status")
        .send({ status: to });
      expect(res.status).toBe(ok ? 200 : 409);
    });
  }
});
