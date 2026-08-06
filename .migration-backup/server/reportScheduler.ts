/**
 * Report scheduler — manages node-cron jobs for scheduled report delivery.
 *
 * initReportScheduler()  — call once at server startup
 * reloadReportScheduler() — call after any report_subscriptions write
 */
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { generateReportBuffer } from "./reportGenerators";
import { sendReportEmail } from "./email";
import type { ReportFilters } from "@shared/schema";

// Active cron tasks keyed by subscription id
const activeTasks = new Map<string, ScheduledTask>();

interface SubRow {
  id: string;
  company_id: string;
  name: string;
  report_type: string;
  filters: ReportFilters | null;
  schedule_frequency: string;
  schedule_hour: number;
  email_recipients: string[];
  last_run_at: Date | null;
}

async function loadActiveSubscriptions(): Promise<SubRow[]> {
  const result = await db.execute(sql`
    SELECT id, company_id, name, report_type, filters,
           schedule_frequency, schedule_hour, email_recipients, last_run_at
    FROM report_subscriptions
    WHERE is_active = 1
  `);
  return ((result as any).rows ?? []) as SubRow[];
}

async function logRun(subscriptionId: string, status: "success" | "error", emailsSent: number, errorMessage?: string) {
  try {
    await db.execute(sql`
      INSERT INTO report_subscription_logs (subscription_id, status, emails_sent, error_message)
      VALUES (${subscriptionId}, ${status}, ${emailsSent}, ${errorMessage ?? null})
    `);
    await db.execute(sql`
      UPDATE report_subscriptions SET last_run_at = NOW() WHERE id = ${subscriptionId}
    `);
  } catch (err) {
    console.error("[ReportScheduler] Failed to write run log:", err);
  }
}

export async function runSubscription(sub: SubRow): Promise<void> {
  console.log(`[ReportScheduler] Running subscription "${sub.name}" (${sub.id})`);
  try {
    // Strip server-only metadata from the client-visible filters before passing to generators.
    // _accessibleStoreIds is persisted at subscription-creation time to enforce the creating
    // user's store scope without needing a live session at execution time.
    const rawFilters: any = { ...(sub.filters ?? {}) };
    const persistedAccessibleStoreIds: string[] | undefined = rawFilters._accessibleStoreIds;
    delete rawFilters._accessibleStoreIds;

    const filters: ReportFilters = {
      reportType: sub.report_type as ReportFilters["reportType"],
      ...rawFilters,
    };
    const { buffer, filename } = await generateReportBuffer(sub.company_id, filters, persistedAccessibleStoreIds);
    const recipients = sub.email_recipients ?? [];
    if (recipients.length === 0) {
      console.warn(`[ReportScheduler] Subscription ${sub.id} has no recipients — skipping`);
      await logRun(sub.id, "error", 0, "No recipients configured");
      return;
    }
    const sent = await sendReportEmail({
      to: recipients,
      subject: `Scheduled Report: ${sub.name}`,
      buffer,
      filename,
    });
    if (sent === 0) {
      await logRun(sub.id, "error", 0, "Email transport not configured — no emails sent");
      console.warn(`[ReportScheduler] ⚠️ "${sub.name}" delivered 0 emails — transport not configured`);
      return;
    }
    await logRun(sub.id, "success", sent);
    console.log(`[ReportScheduler] ✅ Delivered "${sub.name}" to ${sent} recipient(s)`);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error(`[ReportScheduler] ❌ Failed "${sub.name}":`, msg);
    await logRun(sub.id, "error", 0, msg);
  }
}

function buildCronExpression(frequency: string, hour: number): string {
  // weekly = every Monday at <hour> UTC; daily = every day at <hour> UTC
  return frequency === "weekly" ? `0 ${hour} * * 1` : `0 ${hour} * * *`;
}

export function isCatchUpNeeded(sub: SubRow): boolean {
  if (!sub.last_run_at) return true;
  const lastRun = new Date(sub.last_run_at).getTime();
  const cycleMs = sub.schedule_frequency === "weekly"
    ? 7 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  return Date.now() - lastRun > cycleMs;
}

export async function initReportScheduler(): Promise<void> {
  try {
    const subs = await loadActiveSubscriptions();
    console.log(`[ReportScheduler] Initializing — ${subs.length} active subscription(s)`);
    for (const sub of subs) {
      const expr = buildCronExpression(sub.schedule_frequency, sub.schedule_hour);
      const task = cron.schedule(expr, () => {
        runSubscription(sub).catch(console.error);
      }, { timezone: "UTC" });
      activeTasks.set(sub.id, task);

      if (isCatchUpNeeded(sub)) {
        console.log(`[ReportScheduler] Catch-up queued for "${sub.name}" (runs in 10s)`);
        setTimeout(() => runSubscription(sub).catch(console.error), 10_000);
      }
    }
    console.log(`[ReportScheduler] Ready`);
  } catch (err) {
    console.error("[ReportScheduler] Init error (non-fatal):", err);
  }
}

export async function reloadReportScheduler(): Promise<void> {
  const entries = Array.from(activeTasks.entries());
  for (const [id, task] of entries) {
    task.stop();
    activeTasks.delete(id);
  }
  await initReportScheduler();
  console.log("[ReportScheduler] Reloaded");
}
