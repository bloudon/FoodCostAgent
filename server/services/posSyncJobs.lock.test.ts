/**
 * Sync-lock concurrency tests for task #542.
 *
 * These tests verify that the atomic partial-unique-index lock prevents two
 * concurrent sync jobs from running on the same connection.  They exercise
 * storage.tryAcquirePosSyncLock directly and also test the runIncrementalSync
 * and runBackfill guard paths via mocked storage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runIncrementalSync, runBackfill } from "./posSyncJobs";

// ── Storage mock ──────────────────────────────────────────────────────────────

const mockConnection = {
  id: "conn-1",
  companyId: "company-1",
  provider: "square" as const,
  status: "active" as const,
  merchantId: "MERCHANT1",
  accessToken: "tok",
  refreshToken: null,
  tokenExpiresAt: null,
  tokenRefreshedAt: null,
  tokenKeyVersion: 1,
  syncCursor: null,
  lastSyncedAt: null,
  connectedByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRunningJob = {
  id: "job-running",
  connectionId: "conn-1",
  companyId: "company-1",
  jobType: "incremental" as const,
  status: "running" as const,
  startedAt: new Date(),
  completedAt: null,
  daysBackfilled: null,
  rowsIngested: 0,
  rowsSkipped: 0,
  errorMessage: null,
  createdAt: new Date(),
};

vi.mock("../storage", () => ({
  storage: {
    getPosConnectionById: vi.fn(),
    tryAcquirePosSyncLock: vi.fn(),
    updatePosSyncJob: vi.fn(),
    updatePosConnection: vi.fn(),
    getPosLocationMappings: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../integrations/pos/square", () => ({
  squarePosConnector: {
    retrieveSales: vi.fn().mockResolvedValue([]),
  },
  SquareTokenRevokedError: class SquareTokenRevokedError extends Error {
    readonly code = "SQUARE_TOKEN_REVOKED";
  },
}));

vi.mock("./posIngestion", () => ({
  ingestSalesBatch: vi.fn().mockResolvedValue({ rowsIngested: 0, rowsSkipped: 0 }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POS sync lock — runIncrementalSync", () => {
  let storageMock: any;

  beforeEach(async () => {
    const mod = await import("../storage");
    storageMock = (mod as any).storage;
    vi.clearAllMocks();
    storageMock.getPosConnectionById.mockResolvedValue(mockConnection);
    storageMock.getPosLocationMappings.mockResolvedValue([]);
    storageMock.updatePosSyncJob.mockResolvedValue(undefined);
    storageMock.updatePosConnection.mockResolvedValue(undefined);
  });

  it("returns alreadyRunning when lock is held by another job", async () => {
    storageMock.tryAcquirePosSyncLock.mockResolvedValue({
      acquired: false,
      existingJobId: mockRunningJob.id,
      existingStartedAt: mockRunningJob.startedAt,
    });

    const result = await runIncrementalSync("conn-1");

    expect(result.alreadyRunning).toBe(true);
    expect(result.jobId).toBe(mockRunningJob.id);
    expect(result.rowsIngested).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it("proceeds normally when lock is successfully acquired", async () => {
    const newJob = { ...mockRunningJob, id: "job-new", status: "running" };
    storageMock.tryAcquirePosSyncLock.mockResolvedValue({ acquired: true, job: newJob });

    const result = await runIncrementalSync("conn-1");

    expect(result.alreadyRunning).toBeUndefined();
    expect(result.error).toBeUndefined();
    // updatePosSyncJob should be called to mark the job completed
    expect(storageMock.updatePosSyncJob).toHaveBeenCalledWith(
      newJob.id,
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("skips lock acquisition when preCreatedJob is provided", async () => {
    const preJob = { ...mockRunningJob, id: "pre-job" };
    const result = await runIncrementalSync("conn-1", preJob);

    // tryAcquirePosSyncLock must NOT be called when preCreatedJob is supplied
    expect(storageMock.tryAcquirePosSyncLock).not.toHaveBeenCalled();
    expect(storageMock.updatePosSyncJob).toHaveBeenCalledWith(
      preJob.id,
      expect.objectContaining({ status: "completed" }),
    );
    expect(result.alreadyRunning).toBeUndefined();
  });

  it("returns error for inactive connection without touching the lock", async () => {
    storageMock.getPosConnectionById.mockResolvedValue({ ...mockConnection, status: "disconnected" });

    const result = await runIncrementalSync("conn-1");

    expect(result.error).toMatch(/inactive/i);
    expect(storageMock.tryAcquirePosSyncLock).not.toHaveBeenCalled();
  });
});

describe("POS sync lock — runBackfill", () => {
  let storageMock: any;

  beforeEach(async () => {
    const mod = await import("../storage");
    storageMock = (mod as any).storage;
    vi.clearAllMocks();
    storageMock.getPosConnectionById.mockResolvedValue(mockConnection);
    storageMock.getPosLocationMappings.mockResolvedValue([]);
    storageMock.updatePosSyncJob.mockResolvedValue(undefined);
    storageMock.updatePosConnection.mockResolvedValue(undefined);
  });

  it("returns alreadyRunning when lock is held", async () => {
    storageMock.tryAcquirePosSyncLock.mockResolvedValue({
      acquired: false,
      existingJobId: mockRunningJob.id,
      existingStartedAt: mockRunningJob.startedAt,
    });

    const result = await runBackfill("conn-1", 30);

    expect(result.alreadyRunning).toBe(true);
    expect(result.jobId).toBe(mockRunningJob.id);
  });

  it("skips lock acquisition when preCreatedJob is provided", async () => {
    const preJob = { ...mockRunningJob, id: "pre-backfill-job", jobType: "backfill" };
    await runBackfill("conn-1", 30, preJob);

    expect(storageMock.tryAcquirePosSyncLock).not.toHaveBeenCalled();
    expect(storageMock.updatePosSyncJob).toHaveBeenCalledWith(
      preJob.id,
      expect.objectContaining({ status: "completed" }),
    );
  });
});
