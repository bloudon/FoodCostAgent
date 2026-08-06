/**
 * AI usage metering + cost-plus billing math.
 *
 * Pricing model (per user decision, Aug 2026):
 *  - Each company gets INCLUDED_TOKENS_PER_PERIOD tokens per usage period at no extra cost.
 *  - Usage periods are ALWAYS UTC calendar months, identified by a canonical
 *    period key "YYYY-MM". This one key links usage, acknowledgment, and the
 *    Stripe billing ledger — no timestamp-equality matching anywhere.
 *  - Tokens beyond the threshold are billed at OpenAI cost + MARKUP (40%).
 *  - Overage is only billable after a company admin explicitly accepts it for
 *    the period (warning + acceptance when the threshold is crossed).
 *  - Accepted overage for closed months is added to the next Stripe renewal
 *    invoice (see billing.ts).
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

export const INCLUDED_TOKENS_PER_PERIOD = 2_000_000;
export const OVERAGE_MARKUP = 1.4; // cost + 40%

/** OpenAI list prices in USD per 1M tokens. Keep in sync with models used in AI features. */
const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10 },
};
/** Unknown models are priced at the MOST expensive known rate so we never underbill. */
const UNKNOWN_MODEL_PRICING = MODEL_PRICING["gpt-4o"];

export interface UsagePeriod {
  key: string; // "YYYY-MM"
  start: Date;
  end: Date;
}

/** Canonical period for a Date: the UTC calendar month containing it. */
export function periodForDate(d: Date): UsagePeriod {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { key, start, end };
}

export function currentUsagePeriod(): UsagePeriod {
  return periodForDate(new Date());
}

export interface UsageSummary {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  includedTokens: number;
  usedTokens: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  overageTokens: number;
  /** Accrued overage charge in cents (cost + markup), 0 until threshold crossed. */
  overageCents: number;
  /** Whether the company has accepted overage billing for this period. */
  overageAccepted: boolean;
  /** True when usage >= included and overage has NOT been accepted → AI features gated. */
  approvalRequired: boolean;
}

/** Raw OpenAI cost in cents for a per-model token breakdown. */
function rawCostCents(rows: Array<{ model: string; prompt: number; completion: number }>): number {
  let usd = 0;
  for (const r of rows) {
    let p = MODEL_PRICING[r.model];
    if (!p) {
      console.warn(`[AI Usage] Unknown model "${r.model}" — pricing at highest known rate`);
      p = UNKNOWN_MODEL_PRICING;
    }
    usd += (r.prompt / 1_000_000) * p.inputPerM + (r.completion / 1_000_000) * p.outputPerM;
  }
  return usd * 100;
}

export async function getUsageSummary(companyId: string, period?: UsagePeriod): Promise<UsageSummary> {
  const p = period ?? currentUsagePeriod();
  const result = await db.execute(sql`
    SELECT model,
           COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt,
           COALESCE(SUM(completion_tokens), 0)::bigint AS completion,
           COUNT(*)::int AS requests
    FROM ai_token_usage
    WHERE company_id = ${companyId}
      AND created_at >= ${p.start.toISOString()}
      AND created_at < ${p.end.toISOString()}
    GROUP BY model`);
  const rows = ((result as any).rows ?? []).map((r: any) => ({
    model: String(r.model),
    prompt: Number(r.prompt),
    completion: Number(r.completion),
    requests: Number(r.requests),
  }));

  const promptTokens = rows.reduce((s: number, r: any) => s + r.prompt, 0);
  const completionTokens = rows.reduce((s: number, r: any) => s + r.completion, 0);
  const requestCount = rows.reduce((s: number, r: any) => s + r.requests, 0);
  const usedTokens = promptTokens + completionTokens;
  const overageTokens = Math.max(0, usedTokens - INCLUDED_TOKENS_PER_PERIOD);

  // Cost-plus on the overage share of consumption: prorate the actual blended
  // cost by the fraction of tokens beyond the threshold, then apply markup.
  let overageCents = 0;
  if (overageTokens > 0 && usedTokens > 0) {
    const totalCost = rawCostCents(rows);
    overageCents = Math.ceil(totalCost * (overageTokens / usedTokens) * OVERAGE_MARKUP);
  }

  const ackResult = await db.execute(sql`
    SELECT 1 FROM ai_usage_acknowledgments
    WHERE company_id = ${companyId} AND period_key = ${p.key}
    LIMIT 1`);
  const overageAccepted = ((ackResult as any).rows ?? []).length > 0;

  return {
    periodKey: p.key,
    periodStart: p.start.toISOString(),
    periodEnd: p.end.toISOString(),
    includedTokens: INCLUDED_TOKENS_PER_PERIOD,
    usedTokens,
    promptTokens,
    completionTokens,
    requestCount,
    overageTokens,
    overageCents,
    overageAccepted,
    approvalRequired: usedTokens >= INCLUDED_TOKENS_PER_PERIOD && !overageAccepted,
  };
}

/** Record the company's acceptance of overage billing for the current period. Idempotent. */
export async function acceptOverage(companyId: string, userId: string | null): Promise<void> {
  const p = currentUsagePeriod();
  await db.execute(sql`
    INSERT INTO ai_usage_acknowledgments (company_id, period_key, period_start, period_end, accepted_by_user_id)
    VALUES (${companyId}, ${p.key}, ${p.start.toISOString()}, ${p.end.toISOString()}, ${userId})
    ON CONFLICT (company_id, period_key) DO NOTHING`);
}

export interface BillableOverageMonth {
  periodKey: string;
  period: UsagePeriod;
  overageTokens: number;
  overageCents: number;
}

/**
 * All CLOSED calendar months (strictly before the current month) for which the
 * company accepted overage billing and no successful Stripe charge exists yet.
 * Failed/pending ledger rows ARE returned again so charges can be retried.
 */
export async function getBillableOverageMonths(companyId: string): Promise<BillableOverageMonth[]> {
  const current = currentUsagePeriod();
  const acks = await db.execute(sql`
    SELECT a.period_key
    FROM ai_usage_acknowledgments a
    LEFT JOIN ai_overage_billings b
      ON b.company_id = a.company_id AND b.period_key = a.period_key AND b.status = 'billed'
    WHERE a.company_id = ${companyId}
      AND a.period_key < ${current.key}
      AND b.id IS NULL
    ORDER BY a.period_key`);

  const out: BillableOverageMonth[] = [];
  for (const row of ((acks as any).rows ?? [])) {
    const [y, m] = String(row.period_key).split("-").map(Number);
    const period = periodForDate(new Date(Date.UTC(y, m - 1, 15)));
    const usage = await getUsageSummary(companyId, period);
    if (usage.overageCents > 0) {
      out.push({ periodKey: period.key, period, overageTokens: usage.overageTokens, overageCents: usage.overageCents });
    }
  }
  return out;
}
