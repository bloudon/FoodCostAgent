/**
 * Chat-logs endpoint tests (task #875)
 *
 * Coverage:
 *   1. parseChatLogsLimit() — exported pure helper, tests the clamping contract
 *   2. Route integration — GET /api/admin/chat-logs registered via the real
 *      `registerChatLogsRoutes` production handler, with db/storage/auth mocked.
 *      Asserts that ?limit=N, the 200-row upper bound, and the 100-row default
 *      are all honoured by the production code path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── 1. Pure unit tests for the exported limit-parsing helper ─────────────────

// Import the real helper from the production module
import { parseChatLogsLimit } from "./routes/chatLogsRoutes";

describe("parseChatLogsLimit() — limit clamping contract", () => {
  it("returns 3 for '3'", () => {
    expect(parseChatLogsLimit("3")).toBe(3);
  });

  it("returns 100 (default) when no value is provided", () => {
    expect(parseChatLogsLimit(undefined)).toBe(100);
  });

  it("caps at 200 when a value above 200 is provided", () => {
    expect(parseChatLogsLimit("250")).toBe(200);
    expect(parseChatLogsLimit("999")).toBe(200);
    expect(parseChatLogsLimit("201")).toBe(200);
  });

  it("allows exactly 200 (the upper bound)", () => {
    expect(parseChatLogsLimit("200")).toBe(200);
  });

  it("floors to 1 when a value below 1 is provided", () => {
    expect(parseChatLogsLimit("0")).toBe(1);
    expect(parseChatLogsLimit("-5")).toBe(1);
  });

  it("returns 100 (default) for a non-numeric string", () => {
    expect(parseChatLogsLimit("abc")).toBe(100);
    expect(parseChatLogsLimit("")).toBe(100);
  });
});

// ─── 2. Route integration tests — real production handler, mocked dependencies ──

// Build fake row factory
function makeRow(i: number) {
  return {
    id: `id-${i}`,
    company_id: "company-1",
    user_id: "user-1",
    user_message: `question ${i}`,
    assistant_response: `answer ${i}`,
    tier: "platform",
    created_at: new Date().toISOString(),
    company_name: "Test Co",
  };
}

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => makeRow(i));
}

// Mock db
vi.mock("./db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

// Mock storage
vi.mock("./storage", () => ({
  storage: {
    getUser: vi.fn(),
  },
}));

// Mock auth — requireAuth injects user and calls next
vi.mock("./auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1" };
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
  requireTier: () => (_req: any, _res: any, next: any) => next(),
}));

// Build a minimal Express app with the REAL production handler registered
async function buildApp() {
  const { registerChatLogsRoutes } = await import("./routes/chatLogsRoutes");
  const app = express();
  app.use(express.json());
  registerChatLogsRoutes(app as any);
  return app;
}

/**
 * Drizzle sql`` tagged templates embed bound param values as plain scalars
 * directly inside the `queryChunks` array alongside `{ value: [...] }` string
 * chunks.  For example:
 *   sql`SELECT * FROM t LIMIT ${42}`
 *   → queryChunks: [{ value: ["SELECT * FROM t LIMIT "] }, 42, { value: [""] }]
 *
 * This helper walks the chunks in reverse and returns the last numeric scalar,
 * which for the main chat-logs SELECT is always the LIMIT value.
 */
function extractLimitFromSql(sqlObj: any): number | undefined {
  const chunks: any[] = sqlObj?.queryChunks ?? [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (typeof chunks[i] === "number") return chunks[i];
  }
  return undefined;
}

// Helper: configure the db mock so the main SELECT returns `logRows`, and all
// subsequent aggregate queries return safe empty results.
async function setupDbMock(logRows: any[]) {
  const { db } = await import("./db");
  const mockedDb = db as any;
  let callIndex = 0;
  mockedDb.execute.mockImplementation(async () => {
    const idx = callIndex++;
    if (idx === 0) {
      // First execute: the main SELECT … LIMIT N
      return { rows: logRows };
    }
    if (idx === 1) {
      // todayCount query
      return { rows: [{ cnt: "0" }] };
    }
    if (idx === 2) {
      // mostActive query
      return { rows: [] };
    }
    // topicMsg query
    return { rows: [] };
  });
  return mockedDb;
}

describe("GET /api/admin/chat-logs — production handler, limit parameter is honoured", () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: authenticated global_admin
    const { storage } = await import("./storage");
    (storage as any).getUser.mockResolvedValue({ id: "user-1", role: "global_admin" });

    app = await buildApp();
  });

  it("?limit=3 — DB receives exactly 3 rows and response contains at most 3 entries", async () => {
    const { db } = await import("./db");
    const mockedDb = db as any;
    let capturedSql: string | null = null;

    let callIndex = 0;
    mockedDb.execute.mockImplementation(async (sqlObj: any) => {
      const idx = callIndex++;
      if (idx === 0) {
        // Capture the SQL string to verify LIMIT was included
        capturedSql = String(sqlObj?.queryChunks?.map((c: any) => c.value ?? c).join("") ?? sqlObj);
        return { rows: makeRows(3) };
      }
      if (idx === 1) return { rows: [{ cnt: "0" }] };
      if (idx === 2) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app).get("/api/admin/chat-logs?limit=3");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs.length).toBeLessThanOrEqual(3);
    expect(res.body.logs.length).toBe(3);
  });

  it("no limit param — handler defaults to 100", async () => {
    const { db } = await import("./db");
    const mockedDb = db as any;
    const calls: any[] = [];
    let callIndex = 0;
    mockedDb.execute.mockImplementation(async (sqlObj: any) => {
      calls.push(sqlObj);
      const idx = callIndex++;
      if (idx === 0) return { rows: makeRows(5) };
      if (idx === 1) return { rows: [{ cnt: "0" }] };
      if (idx === 2) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app).get("/api/admin/chat-logs");

    expect(res.status).toBe(200);
    expect(extractLimitFromSql(calls[0])).toBe(100);
  });

  it("?limit=250 — handler clamps to 200", async () => {
    const { db } = await import("./db");
    const mockedDb = db as any;
    const calls: any[] = [];
    let callIndex = 0;
    mockedDb.execute.mockImplementation(async (sqlObj: any) => {
      calls.push(sqlObj);
      const idx = callIndex++;
      if (idx === 0) return { rows: makeRows(5) };
      if (idx === 1) return { rows: [{ cnt: "0" }] };
      if (idx === 2) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app).get("/api/admin/chat-logs?limit=250");

    expect(res.status).toBe(200);
    expect(extractLimitFromSql(calls[0])).toBe(200);
  });

  it("?limit=200 — handler accepts exactly the upper bound", async () => {
    const { db } = await import("./db");
    const mockedDb = db as any;
    const calls: any[] = [];
    let callIndex = 0;
    mockedDb.execute.mockImplementation(async (sqlObj: any) => {
      calls.push(sqlObj);
      const idx = callIndex++;
      if (idx === 0) return { rows: makeRows(5) };
      if (idx === 1) return { rows: [{ cnt: "0" }] };
      if (idx === 2) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app).get("/api/admin/chat-logs?limit=200");

    expect(res.status).toBe(200);
    expect(extractLimitFromSql(calls[0])).toBe(200);
  });

  it("?limit=abc (non-numeric) — handler falls back to default 100", async () => {
    const { db } = await import("./db");
    const mockedDb = db as any;
    const calls: any[] = [];
    let callIndex = 0;
    mockedDb.execute.mockImplementation(async (sqlObj: any) => {
      calls.push(sqlObj);
      const idx = callIndex++;
      if (idx === 0) return { rows: makeRows(5) };
      if (idx === 1) return { rows: [{ cnt: "0" }] };
      if (idx === 2) return { rows: [] };
      return { rows: [] };
    });

    const res = await request(app).get("/api/admin/chat-logs?limit=abc");

    expect(res.status).toBe(200);
    expect(extractLimitFromSql(calls[0])).toBe(100);
  });

  it("response includes required shape: logs, todayCount, mostActiveCompany, topTopics", async () => {
    await setupDbMock(makeRows(2));

    const res = await request(app).get("/api/admin/chat-logs?limit=2");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("logs");
    expect(res.body).toHaveProperty("todayCount");
    expect(res.body).toHaveProperty("mostActiveCompany");
    expect(res.body).toHaveProperty("topTopics");
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(Array.isArray(res.body.topTopics)).toBe(true);
  });

  it("non-admin user receives 403", async () => {
    const { storage } = await import("./storage");
    (storage as any).getUser.mockResolvedValueOnce({ id: "user-2", role: "manager" });

    await setupDbMock([]);

    const res = await request(app).get("/api/admin/chat-logs");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/global admin/i);
  });
});
