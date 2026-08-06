/**
 * Verifies that AI scan/import features record token usage into ai_token_usage
 * via recordAiTokenUsage, with the correct feature, model, and token counts —
 * and that getUsageSummary counts those rows (no feature filter) so non-chat
 * features appear in GET /api/ai-usage totals.
 *
 * OpenAI and the DB are mocked; no network or database required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// ── Mocks ────────────────────────────────────────────────────────────────────

const chatCreateMock = vi.fn();
const transcriptionCreateMock = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: chatCreateMock } };
    audio = { transcriptions: { create: transcriptionCreateMock } };
  }
  return { default: MockOpenAI };
});

interface CapturedQuery {
  sql: string;
  params: unknown[];
}
const executedQueries: CapturedQuery[] = [];
let summaryRows: any[] = [];

const dialect = new PgDialect();

vi.mock('./db', () => ({
  db: {
    execute: vi.fn(async (query: any) => {
      const q = dialect.sqlToQuery(query);
      executedQueries.push({ sql: q.sql, params: q.params });
      if (/from\s+ai_token_usage/i.test(q.sql)) {
        return { rows: summaryRows };
      }
      return { rows: [] };
    }),
  },
  pool: {},
}));

// Imported AFTER mocks so the services pick up the mocked OpenAI client + db.
import { getUsageSummary, INCLUDED_TOKENS_PER_PERIOD } from './aiUsage';

// ── Helpers ──────────────────────────────────────────────────────────────────

const METER = { companyId: 'company-1', userId: 'user-1' };
const USAGE = { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 };

function mockChatResponse(content: string) {
  chatCreateMock.mockResolvedValueOnce({
    choices: [{ message: { content } }],
    usage: { ...USAGE },
  });
}

/** Flush the fire-and-forget `void recordAiTokenUsage(...)` promise chain. */
async function flushAsync() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

function tokenUsageInserts(): CapturedQuery[] {
  return executedQueries.filter((q) => /insert\s+into\s+ai_token_usage/i.test(q.sql));
}

function expectTokenUsageInsert(feature: string, model: string) {
  const inserts = tokenUsageInserts();
  expect(inserts.length).toBeGreaterThanOrEqual(1);
  // Param order in recordAiTokenUsage's INSERT:
  // company_id, user_id, feature, model, prompt, completion, total, tool_calls, is_estimated
  const insert = inserts.find((q) => q.params[2] === feature);
  expect(insert, `no ai_token_usage insert with feature "${feature}"`).toBeDefined();
  expect(insert!.params[0]).toBe(METER.companyId);
  expect(insert!.params[1]).toBe(METER.userId);
  expect(insert!.params[2]).toBe(feature);
  expect(insert!.params[3]).toBe(model);
  expect(insert!.params[4]).toBe(USAGE.prompt_tokens);
  expect(insert!.params[5]).toBe(USAGE.completion_tokens);
  expect(insert!.params[6]).toBe(USAGE.prompt_tokens + USAGE.completion_tokens);
}

beforeEach(() => {
  executedQueries.length = 0;
  summaryRows = [];
  chatCreateMock.mockReset();
  transcriptionCreateMock.mockReset();
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
});

const IMG = Buffer.from('fake-image');

// ── Metered service paths ────────────────────────────────────────────────────

describe('scan features record ai_token_usage rows', () => {
  it("invoice scan records feature 'invoice_scan' with model gpt-4o", async () => {
    mockChatResponse('{"vendorName":"Sysco","items":[]}');
    const { scanVendorReceipt } = await import('./services/vendorReceiptScanner');
    await scanVendorReceipt(IMG, 'image/jpeg', METER);
    await flushAsync();
    expectTokenUsageInsert('invoice_scan', 'gpt-4o');
  });

  it("recipe scan records feature 'recipe_scan' with model gpt-4o", async () => {
    mockChatResponse('{"name":"Test","ingredients":[]}');
    const { scanRecipeImage } = await import('./services/recipeScanner');
    await scanRecipeImage(IMG, 'image/jpeg', METER).catch(() => {});
    await flushAsync();
    expectTokenUsageInsert('recipe_scan', 'gpt-4o');
  });

  it("recipe instruction extraction also records 'recipe_scan'", async () => {
    mockChatResponse('{"instructions":"Mix well"}');
    const { extractRecipeInstructions } = await import('./services/recipeScanner');
    await extractRecipeInstructions(IMG, 'image/jpeg', METER).catch(() => {});
    await flushAsync();
    expectTokenUsageInsert('recipe_scan', 'gpt-4o');
  });

  it("shelf scan records feature 'shelf_scan' with model gpt-4o", async () => {
    mockChatResponse('{"items":[]}');
    const { scanShelfImage } = await import('./services/shelfScanner');
    await scanShelfImage(IMG, 'image/jpeg', undefined, METER).catch(() => {});
    await flushAsync();
    expectTokenUsageInsert('shelf_scan', 'gpt-4o');
  });

  it("catch-weight label scan also records 'shelf_scan'", async () => {
    mockChatResponse('{}');
    const { scanCatchWeightLabel } = await import('./services/shelfScanner');
    await scanCatchWeightLabel(IMG, 'image/jpeg', undefined, METER).catch(() => {});
    await flushAsync();
    expectTokenUsageInsert('shelf_scan', 'gpt-4o');
  });

  it("menu scan records feature 'menu_scan' with model gpt-4o", async () => {
    mockChatResponse(
      '{"items":[],"intelligence":{"phones":[],"addresses":[],"locationCount":1,"multiLocationSignal":false}}',
    );
    const { scanMenuImage } = await import('./services/menuScanner');
    await scanMenuImage(IMG, 'image/jpeg', METER);
    await flushAsync();
    expectTokenUsageInsert('menu_scan', 'gpt-4o');
  });

  it("waste voice interpretation records feature 'waste_interpret'", async () => {
    mockChatResponse('{"entries":[]}');
    const { extractSpokenWasteEntries, INTERPRETATION_MODEL } = await import(
      './services/wasteInterpreter'
    );
    await extractSpokenWasteEntries('two pounds of chicken dropped', METER);
    await flushAsync();
    expectTokenUsageInsert('waste_interpret', INTERPRETATION_MODEL);
  });

  it("AI inventory import column mapping records feature 'inventory_import' with gpt-4o-mini", async () => {
    mockChatResponse('{"mappings":[]}');
    const { analyzeColumns } = await import('./services/aiInventoryImporter');
    await analyzeColumns('Name,Price\nChicken,4.99\n', METER).catch(() => {});
    await flushAsync();
    expectTokenUsageInsert('inventory_import', 'gpt-4o-mini');
  });

  it('records nothing when no meter is provided', async () => {
    mockChatResponse(
      '{"items":[],"intelligence":{"phones":[],"addresses":[],"locationCount":1,"multiLocationSignal":false}}',
    );
    const { scanMenuImage } = await import('./services/menuScanner');
    await scanMenuImage(IMG, 'image/jpeg');
    await flushAsync();
    expect(tokenUsageInserts()).toHaveLength(0);
  });

  it('records nothing when the response has no usage block', async () => {
    chatCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"vendorName":null,"items":[]}' } }],
      usage: undefined,
    });
    const { scanVendorReceipt } = await import('./services/vendorReceiptScanner');
    await scanVendorReceipt(IMG, 'image/jpeg', METER);
    await flushAsync();
    expect(tokenUsageInserts()).toHaveLength(0);
  });
});

// ── getUsageSummary counts non-chat feature rows ─────────────────────────────

describe('getUsageSummary includes non-chat feature usage', () => {
  it('sums tokens across models with no feature filter', async () => {
    // Rows as the group-by-model query would return them when the underlying
    // table contains invoice_scan / shelf_scan / inventory_import rows.
    summaryRows = [
      { model: 'gpt-4o', prompt: '3000', completion: '1500', requests: '3' }, // scans
      { model: 'gpt-4o-mini', prompt: '800', completion: '200', requests: '2' }, // inventory_import
    ];
    const summary = await getUsageSummary('company-1');

    expect(summary.promptTokens).toBe(3800);
    expect(summary.completionTokens).toBe(1700);
    expect(summary.usedTokens).toBe(5500);
    expect(summary.requestCount).toBe(5);
    expect(summary.includedTokens).toBe(INCLUDED_TOKENS_PER_PERIOD);
    expect(summary.overageTokens).toBe(0);

    // The aggregation query must not filter by feature — every feature's rows
    // (chat and non-chat alike) count toward the meter.
    const usageQuery = executedQueries.find((q) => /from\s+ai_token_usage/i.test(q.sql));
    expect(usageQuery).toBeDefined();
    expect(usageQuery!.sql.toLowerCase()).not.toContain('feature');
  });
});
