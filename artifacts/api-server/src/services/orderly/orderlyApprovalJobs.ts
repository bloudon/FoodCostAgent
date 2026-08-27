import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { logger } from '../../lib/logger';
import {
  inventoryImportBatches,
  orderlyImportApprovalJobs,
  type OrderlyImportApprovalJob,
} from '@workspace/db';
import {
  applyBatchApproval,
  authorizeOrderlyApprovalJobAccess,
  ImportApprovalError,
  type ApprovalResult,
} from './orderlyDomain';

/** Bay Hill completed in 104–129s; the public budget intentionally allows 3 minutes. */
export const ORDERLY_APPROVAL_TIMEOUT_MS = 180_000;

export type ApprovalJobStatus = 'running' | 'timed_out' | 'failed' | 'completed';

export interface ApprovalJobView {
  jobId: string;
  batchId: string;
  status: ApprovalJobStatus;
  phase: string;
  progressPercent: number;
  attemptCount: number;
  startedAt: string;
  updatedAt: string;
  timeoutAt: string;
  completedAt: string | null;
  timeoutBudgetMs: number;
  result: ApprovalResult | null;
  error: { code: string | null; message: string } | null;
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  return new Date(value).toISOString();
}

function toView(job: OrderlyImportApprovalJob): ApprovalJobView {
  return {
    jobId: job.id,
    batchId: job.batchId,
    status: job.status as ApprovalJobStatus,
    phase: job.phase,
    progressPercent: job.progressPercent,
    attemptCount: job.attemptCount,
    startedAt: toIso(job.startedAt)!,
    updatedAt: toIso(job.updatedAt)!,
    timeoutAt: toIso(job.timeoutAt)!,
    completedAt: toIso(job.completedAt),
    timeoutBudgetMs: ORDERLY_APPROVAL_TIMEOUT_MS,
    result: (job.result as ApprovalResult | null) ?? null,
    error: job.errorMessage
      ? { code: job.errorCode ?? null, message: job.errorMessage }
      : null,
  };
}

async function findJob(batchId: string, companyId: string): Promise<OrderlyImportApprovalJob | null> {
  const [job] = await db
    .select()
    .from(orderlyImportApprovalJobs)
    .where(and(
      eq(orderlyImportApprovalJobs.batchId, batchId),
      eq(orderlyImportApprovalJobs.companyId, companyId),
    ))
    .limit(1);
  return job ?? null;
}

export async function getApprovalJob(batchId: string, companyId: string): Promise<ApprovalJobView | null> {
  let job = await findJob(batchId, companyId);
  if (!job) return null;

  if (job.status === 'running' && new Date(job.timeoutAt).getTime() <= Date.now()) {
    job = await db.transaction(async (tx: any) => {
      // Lock and re-read so a poll cannot time out a lease reclaimed by a
      // concurrent retry. The observed attempt and timeout are both fenced.
      const [locked] = await tx
        .select()
        .from(orderlyImportApprovalJobs)
        .where(and(
          eq(orderlyImportApprovalJobs.id, job!.id),
          eq(orderlyImportApprovalJobs.batchId, batchId),
          eq(orderlyImportApprovalJobs.companyId, companyId),
        ))
        .for('update');
      if (
        !locked ||
        locked.status !== 'running' ||
        new Date(locked.timeoutAt).getTime() > Date.now()
      ) {
        return locked ?? job;
      }
      const now = new Date();
      const [timedOut] = await tx
        .update(orderlyImportApprovalJobs)
        .set({
          status: 'timed_out',
          phase: 'stalled',
          updatedAt: now,
          errorCode: 'TIMEOUT_BUDGET_EXCEEDED',
          errorMessage: 'Approval exceeded the documented three-minute processing budget. Checking or retrying is safe.',
        })
        .where(and(
          eq(orderlyImportApprovalJobs.id, locked.id),
          eq(orderlyImportApprovalJobs.status, 'running'),
          eq(orderlyImportApprovalJobs.attemptCount, locked.attemptCount),
          eq(orderlyImportApprovalJobs.timeoutAt, locked.timeoutAt),
        ))
        .returning();
      return timedOut ?? locked;
    });
  }
  return job ? toView(job) : null;
}

export async function claimApprovalJob(
  batchId: string,
  companyId: string,
  actingUserId: string,
  options: { forceDuplicateDate?: boolean; reclaimRunning?: boolean } = {},
): Promise<{ job: ApprovalJobView; shouldRun: boolean }> {
  await authorizeOrderlyApprovalJobAccess(
    batchId,
    { actingUserId, companyId },
    { allowApproved: true },
  );
  return db.transaction(async (tx: any) => {
    const [batch] = await tx
      .select({ id: inventoryImportBatches.id, status: inventoryImportBatches.status })
      .from(inventoryImportBatches)
      .where(and(
        eq(inventoryImportBatches.id, batchId),
        eq(inventoryImportBatches.companyId, companyId),
        eq(inventoryImportBatches.sourceSystem, 'ORDERLY'),
      ))
      .for('update');
    if (!batch) throw new ImportApprovalError('NOT_FOUND', 'Batch not found');

    const [existing] = await tx
      .select()
      .from(orderlyImportApprovalJobs)
      .where(and(
        eq(orderlyImportApprovalJobs.batchId, batchId),
        eq(orderlyImportApprovalJobs.companyId, companyId),
      ))
      .for('update');

    if (existing?.status === 'completed') {
      return { job: toView(existing), shouldRun: false };
    }
    if (batch.status === 'approved') {
      throw new ImportApprovalError('CONFLICT', 'Batch has already been approved — use the history view to see results.');
    }
    if (batch.status !== 'pending_review') {
      throw new ImportApprovalError('CONFLICT', 'This import is no longer pending review and cannot be approved.');
    }

    const now = new Date();
    const timeoutAt = new Date(now.getTime() + ORDERLY_APPROVAL_TIMEOUT_MS);
    if (
      existing?.status === 'running' &&
      new Date(existing.timeoutAt).getTime() > now.getTime() &&
      !options.reclaimRunning
    ) {
      return { job: toView(existing), shouldRun: false };
    }

    if (existing) {
      const [reclaimed] = await tx
        .update(orderlyImportApprovalJobs)
        .set({
          status: 'running',
          phase: 'queued',
          progressPercent: 5,
          attemptCount: existing.attemptCount + 1,
          forceDuplicateDate: options.forceDuplicateDate || existing.forceDuplicateDate === 1 ? 1 : 0,
          startedBy: actingUserId,
          startedAt: now,
          updatedAt: now,
          timeoutAt,
          completedAt: null,
          result: null,
          errorCode: null,
          errorMessage: null,
        })
        .where(eq(orderlyImportApprovalJobs.id, existing.id))
        .returning();
      return { job: toView(reclaimed), shouldRun: true };
    }

    const [created] = await tx
      .insert(orderlyImportApprovalJobs)
      .values({
        batchId,
        companyId,
        status: 'running',
        phase: 'queued',
        progressPercent: 5,
        attemptCount: 1,
        forceDuplicateDate: options.forceDuplicateDate ? 1 : 0,
        startedBy: actingUserId,
        startedAt: now,
        updatedAt: now,
        timeoutAt,
      })
      .returning();
    return { job: toView(created), shouldRun: true };
  });
}

export async function runApprovalJob(
  jobId: string,
  batchId: string,
  companyId: string,
  actingUserId: string,
  attemptCount: number,
  forceDuplicateDate: boolean,
): Promise<void> {
  try {
    await db
      .update(orderlyImportApprovalJobs)
      .set({ phase: 'applying', progressPercent: 35, updatedAt: new Date() })
      .where(and(
        eq(orderlyImportApprovalJobs.id, jobId),
        eq(orderlyImportApprovalJobs.companyId, companyId),
        eq(orderlyImportApprovalJobs.status, 'running'),
        eq(orderlyImportApprovalJobs.attemptCount, attemptCount),
      ));
    await applyBatchApproval(
      batchId,
      { actingUserId, companyId },
      null,
      {
        approvalJobId: jobId,
        approvalAttemptCount: attemptCount,
        forceDuplicateDate,
      },
    );
  } catch (err) {
    const current = await findJob(batchId, companyId);
    if (
      current?.status === 'completed' ||
      current?.attemptCount !== attemptCount ||
      current?.status !== 'running'
    ) return;
    const code = err instanceof ImportApprovalError ? err.code : 'INTERNAL_ERROR';
    const message = err instanceof Error ? err.message : 'Approval failed';
    await db
      .update(orderlyImportApprovalJobs)
      .set({
        status: 'failed',
        phase: 'failed',
        updatedAt: new Date(),
        errorCode: code,
        errorMessage: message,
      })
      .where(and(
        eq(orderlyImportApprovalJobs.id, jobId),
        eq(orderlyImportApprovalJobs.companyId, companyId),
        eq(orderlyImportApprovalJobs.status, 'running'),
        eq(orderlyImportApprovalJobs.attemptCount, attemptCount),
      ));
    logger.error({ err, batchId, jobId }, 'Orderly approval job failed');
  }
}

async function recoverJobs(reclaimAllRunning: boolean): Promise<number> {
  const now = new Date();
  const incomplete = await db
    .select()
    .from(orderlyImportApprovalJobs)
    .where(
      reclaimAllRunning
        ? sql`${orderlyImportApprovalJobs.status} IN ('running', 'timed_out')`
        : sql`${orderlyImportApprovalJobs.status} = 'timed_out'
            OR (${orderlyImportApprovalJobs.status} = 'running'
                AND ${orderlyImportApprovalJobs.timeoutAt} <= ${now})`,
    );
  let recovered = 0;
  for (const job of incomplete) {
    if (!job.startedBy) continue;
    try {
      const claimed = await claimApprovalJob(job.batchId, job.companyId, job.startedBy, {
        forceDuplicateDate: job.forceDuplicateDate === 1,
        reclaimRunning: reclaimAllRunning ||
          (job.status === 'running' && new Date(job.timeoutAt).getTime() <= now.getTime()),
      });
      if (claimed.shouldRun) {
        recovered += 1;
        void runApprovalJob(
          claimed.job.jobId,
          claimed.job.batchId,
          job.companyId,
          job.startedBy,
          claimed.job.attemptCount,
          job.forceDuplicateDate === 1,
        );
      }
    } catch (err) {
      logger.error({ err, batchId: job.batchId, jobId: job.id }, 'Could not recover Orderly approval job');
    }
  }
  return recovered;
}

export async function recoverExpiredApprovalJobs(): Promise<number> {
  return recoverJobs(false);
}

/** Resumes interrupted work at startup and periodically reclaims expired jobs. */
export async function startApprovalJobRecovery(): Promise<void> {
  await recoverJobs(true);
  const timer = setInterval(() => {
    void recoverExpiredApprovalJobs();
  }, 30_000);
  timer.unref();
}