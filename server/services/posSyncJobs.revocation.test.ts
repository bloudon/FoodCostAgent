/**
 * Tests for the Square token revocation guard in runIncrementalSync (#588).
 *
 * Proves the full chain:
 *   revoked token → error detected → sync aborts → connection marked disconnected
 *   → job marked failed → no additional data written beyond what already succeeded
 *
 * Also proves sanitizeErrorMessage redacts realistic token-shaped strings before
 * they reach the pos_sync_jobs.error_message column.
 *
 * Stubs follow the same vi.mock pattern as posSyncJobs.timezone.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (hoisted by vitest) ─────────────────────────────────────────

vi.mock("../storage", () => ({
  storage: {
    getPosConnectionById: vi.fn(),
    getPosLocationMappings: vi.fn(),
    tryAcquirePosSyncLock: vi.fn(),
    updatePosSyncJob: vi.fn(),
    updatePosConnection: vi.fn(),
    getAllActivePosConnections: vi.fn(),
  },
}));

vi.mock("../integrations/pos/square", () => {
  // Define the error class inside the factory so the same class reference is
  // used both in posSyncJobs.ts (where instanceof is checked) and in the tests
  // (where instances are thrown).  vitest resolves both imports to this factory.
  class SquareTokenRevokedError extends Error {
    readonly code = "SQUARE_TOKEN_REVOKED";
    constructor(body: string) {
      super(`Square API 401: ${body}`);
      this.name = "SquareTokenRevokedError";
    }
  }
  return {
    squarePosConnector: {
      retrieveSales: vi.fn(),
      refreshCredentials: vi.fn(),
    },
    SquareTokenRevokedError,
  };
});

vi.mock("./posIngestion", () => ({
  ingestSalesBatch: vi.fn(),
}));

// ── Imports (resolved after mocks are hoisted) ────────────────────────────────

import { runIncrementalSync, runBackfill, refreshAllPosTokens, runAllIncrementalSyncs, runTimezoneAwareIncrementalSyncs } from "./posSyncJobs";
import { storage } from "../storage";
import { squarePosConnector, SquareTokenRevokedError } from "../integrations/pos/square";
import { ingestSalesBatch } from "./posIngestion";

const mockStorage = storage as any;
const mockSquare = squarePosConnector as any;
const mockIngest = ingestSalesBatch as ReturnType<typeof vi.fn>;

// ── Shared fixtures ───────────────────────────────────────────────────────────

/**
 * Active connection with no refresh token so the proactive-refresh block is
 * bypassed in tests that focus on mid-sync revocation.
 */
const ACTIVE_CONN_NO_REFRESH = {
  id: "conn-revoke-test",
  companyId: "co-revoke",
  status: "active",
  accessToken: "test-access-token-abc",
  refreshToken: null,
  connectedByUserId: "user-test",
  merchantId: "merchant-test",
  tokenRefreshedAt: new Date(),                              // recently refreshed
  tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),   // 30 days out
};

/**
 * Active connection whose refresh token is stale (> 7 days) so the proactive
 * refresh block DOES fire — used for refresh-failure tests.
 */
const STALE_CONN = {
  ...ACTIVE_CONN_NO_REFRESH,
  refreshToken: "old-refresh-token",
  tokenRefreshedAt: new Date(Date.now() - 8 * 86_400_000),  // 8 days ago → stale
};

const MOCK_JOB = { id: "job-revoke", status: "running" };

const LOC_ONE = {
  externalLocationId: "loc-east",
  storeId: "store-east",
  externalTimezone: "America/New_York",
};

const LOC_TWO = {
  externalLocationId: "loc-west",
  storeId: "store-west",
  externalTimezone: "America/Los_Angeles",
};

// ── Helper: find a call by shape ──────────────────────────────────────────────

function findCallWithShape(
  mockFn: ReturnType<typeof vi.fn>,
  predicate: (args: any[]) => boolean,
): any[] | undefined {
  return mockFn.mock.calls.find(predicate);
}

// ── Tests: revocation detected during retrieveSales ───────────────────────────

describe("runIncrementalSync — SquareTokenRevokedError from retrieveSales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.tryAcquirePosSyncLock.mockResolvedValue({ acquired: true, job: MOCK_JOB });
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
    mockIngest.mockResolvedValue({ rowsIngested: 0, rowsSkipped: 0, adhocItems: [] });
  });

  it("aborts on 401 from the first location — marks connection disconnected, job failed, no data written", async () => {
    mockStorage.getPosConnectionById.mockResolvedValue(ACTIVE_CONN_NO_REFRESH);
    mockStorage.getPosLocationMappings.mockResolvedValue([LOC_ONE]);
    mockSquare.retrieveSales.mockRejectedValue(new SquareTokenRevokedError("unauthorized"));

    const result = await runIncrementalSync("conn-revoke-test");

    // Result signals failure
    expect(result.rowsIngested).toBe(0);
    expect(result.error).toBeDefined();

    // Connection must be marked disconnected
    const disconnectCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[2]?.status === "disconnected",
    );
    expect(disconnectCall).toBeDefined();

    // Job must be marked failed
    const failedCall = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[1]?.status === "failed",
    );
    expect(failedCall).toBeDefined();

    // Ingestion never ran — no data was written
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("401 on second location preserves rows from first — connection disconnected, job failed", async () => {
    mockStorage.getPosConnectionById.mockResolvedValue(ACTIVE_CONN_NO_REFRESH);
    mockStorage.getPosLocationMappings.mockResolvedValue([LOC_ONE, LOC_TWO]);

    // Location 1 succeeds — ingestion produces 3 rows
    mockSquare.retrieveSales
      .mockResolvedValueOnce([
        { locationId: "loc-east", businessDate: "2026-07-26", lines: [{}] },
      ])
      // Location 2 — token revoked mid-sync
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"));

    mockIngest.mockResolvedValue({ rowsIngested: 3, rowsSkipped: 0, adhocItems: [] });

    const result = await runIncrementalSync("conn-revoke-test");

    // Rows from location 1 are preserved (partial result is acceptable)
    expect(result.rowsIngested).toBe(3);

    // Ingestion called only for location 1
    expect(mockIngest).toHaveBeenCalledTimes(1);

    // Connection must be marked disconnected
    const disconnectCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[2]?.status === "disconnected",
    );
    expect(disconnectCall).toBeDefined();

    // Job must be marked failed (not completed), reporting partial rows
    const failedCall = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[1]?.status === "failed",
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![1].rowsIngested).toBe(3);

    // The failed-location rows (loc-west) were never ingested
    expect(mockIngest).not.toHaveBeenCalledWith(
      expect.objectContaining({ locationId: "loc-west" }),
      expect.anything(),
    );
  });
});

// ── Tests: revocation detected during token refresh ───────────────────────────

describe("runIncrementalSync — SquareTokenRevokedError during proactive token refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
    mockStorage.tryAcquirePosSyncLock.mockResolvedValue({ acquired: true, job: MOCK_JOB });
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.getPosLocationMappings.mockResolvedValue([]);
  });

  it("marks connection disconnected and returns early — no sync lock acquired — when refreshCredentials throws SquareTokenRevokedError", async () => {
    mockStorage.getPosConnectionById.mockResolvedValue(STALE_CONN);
    mockSquare.refreshCredentials.mockRejectedValue(
      new SquareTokenRevokedError("refresh token revoked"),
    );

    const result = await runIncrementalSync("conn-revoke-test");

    // Returns the explicit revocation message from the early-return path
    expect(result.rowsIngested).toBe(0);
    expect(result.error).toMatch(/revoked.*disconnected|disconnected/i);

    // Connection must be marked disconnected
    const disconnectCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[2]?.status === "disconnected",
    );
    expect(disconnectCall).toBeDefined();

    // The function returns before acquiring the lock → no sync job created
    expect(mockStorage.tryAcquirePosSyncLock).not.toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("logs non-auth refresh failure and continues sync with the existing token — does NOT mark disconnected", async () => {
    mockStorage.getPosConnectionById.mockResolvedValue(STALE_CONN);
    // Non-auth error (network timeout, 500, etc.) — must not be treated as revocation
    mockSquare.refreshCredentials.mockRejectedValue(new Error("Network timeout"));

    await runIncrementalSync("conn-revoke-test");

    // Connection must NOT be marked disconnected
    const disconnectCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[2]?.status === "disconnected",
    );
    expect(disconnectCall).toBeUndefined();

    // Sync continues — lock acquisition happens normally
    expect(mockStorage.tryAcquirePosSyncLock).toHaveBeenCalledOnce();
  });
});

// ── Tests: sanitizeErrorMessage — tokens never reach the DB ──────────────────

describe("token redaction — raw Square tokens are redacted before being written to pos_sync_jobs.error_message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getPosConnectionById.mockResolvedValue(ACTIVE_CONN_NO_REFRESH);
    mockStorage.tryAcquirePosSyncLock.mockResolvedValue({ acquired: true, job: MOCK_JOB });
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
    mockStorage.getPosLocationMappings.mockResolvedValue([LOC_ONE]);
  });

  it("replaces a realistic Square-format access token in the stored error message with [REDACTED]", async () => {
    // Square access tokens are ~60 chars, alphanumeric, often starting with "EAAA".
    // This string satisfies the \b[A-Za-z0-9+/=_-]{40,}\b pattern in sanitizeErrorMessage.
    const rawToken = "EAAAEaBcDeFgHiJkLmNoPqRsTuVwXyZ12345678AbCdEfGhIjKlMnOpQr";
    expect(rawToken.length).toBeGreaterThanOrEqual(40);

    // Simulate a Square error that includes a token in its message body
    mockSquare.retrieveSales.mockRejectedValue(
      new Error(`Square API 400: invalid scope for token ${rawToken}`),
    );

    await runIncrementalSync("conn-revoke-test");

    const jobUpdateCall = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => typeof args[1]?.errorMessage === "string",
    );
    expect(jobUpdateCall).toBeDefined();

    const storedError: string = jobUpdateCall![1].errorMessage;

    // Raw token must be absent from the stored message
    expect(storedError).not.toContain(rawToken);

    // The [REDACTED] sentinel must be present in its place
    expect(storedError).toContain("[REDACTED]");
  });

  it("preserves short non-token strings in error messages — only 40+ char words are redacted", async () => {
    const shortPhrase = "invalid-grant"; // 13 chars — not a token
    mockSquare.retrieveSales.mockRejectedValue(
      new Error(`Square API 400: ${shortPhrase}`),
    );

    await runIncrementalSync("conn-revoke-test");

    const jobUpdateCall = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => typeof args[1]?.errorMessage === "string",
    );
    const storedError: string = jobUpdateCall?.[1]?.errorMessage ?? "";

    // Short identifier must survive unchanged
    expect(storedError).toContain(shortPhrase);
    expect(storedError).not.toContain("[REDACTED]");
  });
});

// ── Tests: runBackfill revocation guard ──────────────────────────────────────

describe("runBackfill — SquareTokenRevokedError from retrieveSales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.tryAcquirePosSyncLock.mockResolvedValue({ acquired: true, job: MOCK_JOB });
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
    mockIngest.mockResolvedValue({ rowsIngested: 0, rowsSkipped: 0, adhocItems: [] });
  });

  it("aborts on 401 from the first location — marks connection disconnected, job failed, no data written", async () => {
    mockStorage.getPosConnectionById.mockResolvedValue(ACTIVE_CONN_NO_REFRESH);
    mockStorage.getPosLocationMappings.mockResolvedValue([LOC_ONE]);
    mockSquare.retrieveSales.mockRejectedValue(new SquareTokenRevokedError("unauthorized"));

    const result = await runBackfill("conn-revoke-test", 30);

    // Result signals failure
    expect(result.rowsIngested).toBe(0);
    expect(result.error).toBeDefined();

    // Connection must be marked disconnected
    const disconnectCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[2]?.status === "disconnected",
    );
    expect(disconnectCall).toBeDefined();

    // Job must be marked failed
    const failedCall = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[1]?.status === "failed",
    );
    expect(failedCall).toBeDefined();

    // Ingestion never ran — no data was written
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("401 mid-backfill after location 1 succeeds — partial rows preserved, location 2 never written, connection disconnected", async () => {
    mockStorage.getPosConnectionById.mockResolvedValue(ACTIVE_CONN_NO_REFRESH);
    mockStorage.getPosLocationMappings.mockResolvedValue([LOC_ONE, LOC_TWO]);

    // Location 1 succeeds — retrieveSales returns one batch
    mockSquare.retrieveSales
      .mockResolvedValueOnce([
        { locationId: "loc-east", businessDate: "2026-07-26", lines: [{}] },
      ])
      // Location 2 — token revoked mid-backfill
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"));

    mockIngest.mockResolvedValue({ rowsIngested: 3, rowsSkipped: 0, adhocItems: [] });

    const result = await runBackfill("conn-revoke-test", 30);

    // Rows from location 1 are preserved (partial result is acceptable)
    expect(result.rowsIngested).toBe(3);

    // Ingestion called only for location 1
    expect(mockIngest).toHaveBeenCalledTimes(1);

    // Connection must be marked disconnected
    const disconnectCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[2]?.status === "disconnected",
    );
    expect(disconnectCall).toBeDefined();

    // Job must be marked failed (not completed), reporting partial rows
    const failedCall = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[1]?.status === "failed",
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![1].rowsIngested).toBe(3);

    // The failed-location rows (loc-west) were never ingested
    expect(mockIngest).not.toHaveBeenCalledWith(
      expect.objectContaining({ locationId: "loc-west" }),
      expect.anything(),
    );
  });

  it("redacts a realistic Square-format token from the stored job errorMessage", async () => {
    mockStorage.getPosConnectionById.mockResolvedValue(ACTIVE_CONN_NO_REFRESH);
    mockStorage.getPosLocationMappings.mockResolvedValue([LOC_ONE]);

    // Square access tokens are ~60 chars, alphanumeric, often starting with "EAAA".
    // This string satisfies the \b[A-Za-z0-9+/=_-]{40,}\b pattern in sanitizeErrorMessage.
    const rawToken = "EAAAEaBcDeFgHiJkLmNoPqRsTuVwXyZ12345678AbCdEfGhIjKlMnOpQr";
    expect(rawToken.length).toBeGreaterThanOrEqual(40);

    mockSquare.retrieveSales.mockRejectedValue(
      new SquareTokenRevokedError(`invalid scope for token ${rawToken}`),
    );

    await runBackfill("conn-revoke-test", 30);

    const jobUpdateCall = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => typeof args[1]?.errorMessage === "string",
    );
    expect(jobUpdateCall).toBeDefined();

    const storedError: string = jobUpdateCall![1].errorMessage;

    // Raw token must be absent from the stored message
    expect(storedError).not.toContain(rawToken);

    // The [REDACTED] sentinel must be present in its place
    expect(storedError).toContain("[REDACTED]");
  });
});

// ── Tests: runBackfill with preCreatedJob — lock-release on revocation ────────

describe("runBackfill — preCreatedJob path: lock released when SquareTokenRevokedError fires before lock is acquired internally", () => {
  const PRE_CREATED_JOB = { id: "job-pre-created", status: "running" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
    mockIngest.mockResolvedValue({ rowsIngested: 0, rowsSkipped: 0, adhocItems: [] });
  });

  it("marks the pre-created job 'failed' and connection 'disconnected' — no job row left running", async () => {
    mockStorage.getPosConnectionById.mockResolvedValue(ACTIVE_CONN_NO_REFRESH);
    mockStorage.getPosLocationMappings.mockResolvedValue([LOC_ONE]);
    mockSquare.retrieveSales.mockRejectedValue(new SquareTokenRevokedError("unauthorized"));

    const result = await runBackfill("conn-revoke-test", 30, PRE_CREATED_JOB);

    // Result signals failure
    expect(result.rowsIngested).toBe(0);
    expect(result.error).toBeDefined();

    // The pre-created job row must be marked failed — no row left in 'running'
    const failedCall = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[0] === PRE_CREATED_JOB.id && args[1]?.status === "failed",
    );
    expect(failedCall).toBeDefined();

    // No updatePosSyncJob call should leave status === 'running'
    const runningCall = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[1]?.status === "running",
    );
    expect(runningCall).toBeUndefined();

    // Connection must be marked disconnected
    const disconnectCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[2]?.status === "disconnected",
    );
    expect(disconnectCall).toBeDefined();

    // Lock acquisition was skipped — tryAcquirePosSyncLock must NOT have been called
    expect(mockStorage.tryAcquirePosSyncLock).not.toHaveBeenCalled();
  });

  it("pre-created job retains partial rowsIngested when revocation fires on the second location", async () => {
    mockStorage.getPosConnectionById.mockResolvedValue(ACTIVE_CONN_NO_REFRESH);
    mockStorage.getPosLocationMappings.mockResolvedValue([LOC_ONE, LOC_TWO]);

    // Location 1 succeeds; location 2 triggers revocation
    mockSquare.retrieveSales
      .mockResolvedValueOnce([{ locationId: "loc-east", businessDate: "2026-07-26", lines: [{}] }])
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"));

    mockIngest.mockResolvedValue({ rowsIngested: 5, rowsSkipped: 0, adhocItems: [] });

    const result = await runBackfill("conn-revoke-test", 30, PRE_CREATED_JOB);

    // Partial rows from location 1 are preserved
    expect(result.rowsIngested).toBe(5);

    // The pre-created job must be marked failed with the partial row count
    const failedCall = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[0] === PRE_CREATED_JOB.id && args[1]?.status === "failed",
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![1].rowsIngested).toBe(5);

    // Connection must be marked disconnected
    const disconnectCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[2]?.status === "disconnected",
    );
    expect(disconnectCall).toBeDefined();
  });
});

// ── Tests: refreshAllPosTokens — nightly token refresh loop ──────────────────

/**
 * Stale connection fixture reused across refreshAllPosTokens tests.
 * tokenRefreshedAt > 7 days ago so the refresh guard fires.
 */
const STALE_CONN_A = {
  id: "conn-stale-a",
  companyId: "co-refresh",
  status: "active",
  accessToken: "old-access-token-a",
  refreshToken: "refresh-token-a",
  connectedByUserId: "user-refresh",
  merchantId: "merchant-a",
  tokenRefreshedAt: new Date(Date.now() - 8 * 86_400_000), // 8 days ago → stale
  tokenExpiresAt: new Date(Date.now() + 20 * 86_400_000),
};

const STALE_CONN_B = {
  id: "conn-stale-b",
  companyId: "co-refresh",
  status: "active",
  accessToken: "old-access-token-b",
  refreshToken: "refresh-token-b",
  connectedByUserId: "user-refresh",
  merchantId: "merchant-b",
  tokenRefreshedAt: new Date(Date.now() - 9 * 86_400_000), // 9 days ago → stale
  tokenExpiresAt: new Date(Date.now() + 18 * 86_400_000),
};

const REFRESHED_CREDS = {
  accessToken: "new-access-token",
  tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
};

describe("refreshAllPosTokens — nightly token refresh loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
  });

  it("(a) revoked connection is marked disconnected and healthy connection is updated — both processed", async () => {
    // conn-stale-a has revoked token; conn-stale-b is healthy
    mockStorage.getAllActivePosConnections.mockResolvedValue([STALE_CONN_A, STALE_CONN_B]);

    mockSquare.refreshCredentials
      .mockRejectedValueOnce(new SquareTokenRevokedError("token revoked"))  // conn-a revoked
      .mockResolvedValueOnce(REFRESHED_CREDS);                              // conn-b healthy

    const result = await refreshAllPosTokens();

    // Both connections were attempted
    expect(mockSquare.refreshCredentials).toHaveBeenCalledTimes(2);

    // Revoked connection must be marked disconnected
    const disconnectCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[0] === "conn-stale-a" && args[2]?.status === "disconnected",
    );
    expect(disconnectCall).toBeDefined();

    // Healthy connection must be updated with new token (not marked disconnected)
    const updateCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[0] === "conn-stale-b" && args[2]?.accessToken === REFRESHED_CREDS.accessToken,
    );
    expect(updateCall).toBeDefined();

    // Healthy connection must NOT be marked disconnected
    const falseDisconnect = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[0] === "conn-stale-b" && args[2]?.status === "disconnected",
    );
    expect(falseDisconnect).toBeUndefined();
  });

  it("(b) non-auth refresh error does NOT mark the connection disconnected — loop continues to next connection", async () => {
    // conn-stale-a has a transient network error; conn-stale-b succeeds
    mockStorage.getAllActivePosConnections.mockResolvedValue([STALE_CONN_A, STALE_CONN_B]);

    mockSquare.refreshCredentials
      .mockRejectedValueOnce(new Error("Network timeout"))  // transient error — not revocation
      .mockResolvedValueOnce(REFRESHED_CREDS);             // conn-b succeeds

    await refreshAllPosTokens();

    // Both connections were attempted — loop was not aborted by the first error
    expect(mockSquare.refreshCredentials).toHaveBeenCalledTimes(2);

    // conn-a must NOT be marked disconnected (non-auth error)
    const falseDisconnect = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[0] === "conn-stale-a" && args[2]?.status === "disconnected",
    );
    expect(falseDisconnect).toBeUndefined();

    // conn-b was still processed and its token was updated
    const updateCall = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[0] === "conn-stale-b" && args[2]?.accessToken === REFRESHED_CREDS.accessToken,
    );
    expect(updateCall).toBeDefined();
  });

  it("(c) success and failed counts are accurate across mixed outcomes", async () => {
    // Three connections: one succeeds, one revoked, one non-auth error
    const STALE_CONN_C = {
      ...STALE_CONN_A,
      id: "conn-stale-c",
      refreshToken: "refresh-token-c",
      accessToken: "old-access-token-c",
    };

    mockStorage.getAllActivePosConnections.mockResolvedValue([
      STALE_CONN_A,   // will succeed
      STALE_CONN_B,   // will be revoked
      STALE_CONN_C,   // will hit non-auth error
    ]);

    mockSquare.refreshCredentials
      .mockResolvedValueOnce(REFRESHED_CREDS)                               // conn-a: success
      .mockRejectedValueOnce(new SquareTokenRevokedError("token revoked"))  // conn-b: revoked
      .mockRejectedValueOnce(new Error("Internal Server Error"));           // conn-c: non-auth

    const result = await refreshAllPosTokens();

    // 1 success, 2 failures (revoked + non-auth both count as failed)
    expect(result.success).toBe(1);
    expect(result.failed).toBe(2);

    // All three connections were attempted
    expect(mockSquare.refreshCredentials).toHaveBeenCalledTimes(3);
  });
});

// ── Tests: runAllIncrementalSyncs — revocation isolation ─────────────────────

/**
 * Fixtures for the two-connection scheduler isolation tests.
 * Both connections have no refresh token so the proactive-refresh block is
 * bypassed and we can focus on mid-sync revocation behaviour.
 */
const SCHED_CONN_A = {
  id: "sched-conn-a",
  companyId: "co-sched-a",
  status: "active",
  accessToken: "access-token-sched-a",
  refreshToken: null,
  connectedByUserId: "user-sched",
  merchantId: "merchant-sched-a",
  tokenRefreshedAt: new Date(),
  tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
};

const SCHED_CONN_B = {
  id: "sched-conn-b",
  companyId: "co-sched-b",
  status: "active",
  accessToken: "access-token-sched-b",
  refreshToken: null,
  connectedByUserId: "user-sched",
  merchantId: "merchant-sched-b",
  tokenRefreshedAt: new Date(),
  tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
};

const JOB_SCHED_A = { id: "job-sched-a", status: "running" };
const JOB_SCHED_B = { id: "job-sched-b", status: "running" };

describe("runAllIncrementalSyncs — revocation on one connection does not affect the next", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
  });

  it("connection 2 completes its sync and ingests rows even when connection 1 is revoked", async () => {
    // Scheduler fetches two active connections
    mockStorage.getAllActivePosConnections.mockResolvedValue([SCHED_CONN_A, SCHED_CONN_B]);

    // --- conn-a (revoked) ---
    mockStorage.getPosConnectionById.mockResolvedValueOnce(SCHED_CONN_A);
    mockStorage.tryAcquirePosSyncLock.mockResolvedValueOnce({ acquired: true, job: JOB_SCHED_A });
    mockStorage.getPosLocationMappings.mockResolvedValueOnce([LOC_ONE]);
    mockSquare.retrieveSales.mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"));

    // --- conn-b (healthy) ---
    mockStorage.getPosConnectionById.mockResolvedValueOnce(SCHED_CONN_B);
    mockStorage.tryAcquirePosSyncLock.mockResolvedValueOnce({ acquired: true, job: JOB_SCHED_B });
    mockStorage.getPosLocationMappings.mockResolvedValueOnce([LOC_TWO]);
    mockSquare.retrieveSales.mockResolvedValueOnce([
      { locationId: "loc-west", businessDate: "2026-07-26", lines: [{}] },
    ]);
    mockIngest.mockResolvedValueOnce({ rowsIngested: 7, rowsSkipped: 0, adhocItems: [] });

    // Run the scheduler
    await runAllIncrementalSyncs();

    // ── Connection 1 assertions ──────────────────────────────────────────────

    // conn-a must be marked disconnected
    const connADisconnect = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[0] === "sched-conn-a" && args[2]?.status === "disconnected",
    );
    expect(connADisconnect).toBeDefined();

    // conn-a's job must be marked failed
    const jobAFailed = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[0] === JOB_SCHED_A.id && args[1]?.status === "failed",
    );
    expect(jobAFailed).toBeDefined();

    // ── Connection 2 assertions ──────────────────────────────────────────────

    // conn-b must NOT be marked disconnected
    const connBDisconnect = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[0] === "sched-conn-b" && args[2]?.status === "disconnected",
    );
    expect(connBDisconnect).toBeUndefined();

    // conn-b's job must be marked completed
    const jobBCompleted = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[0] === JOB_SCHED_B.id && args[1]?.status === "completed",
    );
    expect(jobBCompleted).toBeDefined();
    expect(jobBCompleted![1].rowsIngested).toBe(7);

    // Ingestion ran exactly once — for conn-b only
    expect(mockIngest).toHaveBeenCalledTimes(1);

    // Both connections were attempted — the revocation did not abort the loop
    expect(mockStorage.getPosConnectionById).toHaveBeenCalledTimes(2);
  });

  it("connection 1 status is 'disconnected' and connection 2 status is unchanged after the scheduler run", async () => {
    // Variant: verify that updatePosConnection is called with the correct
    // connection IDs and that no cross-contamination occurs between connections.
    mockStorage.getAllActivePosConnections.mockResolvedValue([SCHED_CONN_A, SCHED_CONN_B]);

    // conn-a: revoked immediately on retrieveSales
    mockStorage.getPosConnectionById.mockResolvedValueOnce(SCHED_CONN_A);
    mockStorage.tryAcquirePosSyncLock.mockResolvedValueOnce({ acquired: true, job: JOB_SCHED_A });
    mockStorage.getPosLocationMappings.mockResolvedValueOnce([LOC_ONE]);
    mockSquare.retrieveSales.mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"));

    // conn-b: healthy, no locations — sync completes trivially
    mockStorage.getPosConnectionById.mockResolvedValueOnce(SCHED_CONN_B);
    mockStorage.tryAcquirePosSyncLock.mockResolvedValueOnce({ acquired: true, job: JOB_SCHED_B });
    mockStorage.getPosLocationMappings.mockResolvedValueOnce([]);

    await runAllIncrementalSyncs();

    // Collect all updatePosConnection calls keyed by connection id
    const allUpdateCalls: Array<[string, any]> = mockStorage.updatePosConnection.mock.calls.map(
      (args: any[]) => [args[0] as string, args[2]],
    );

    // conn-a must appear exactly once with status === "disconnected"
    const connAUpdates = allUpdateCalls.filter(([id]) => id === "sched-conn-a");
    expect(connAUpdates).toHaveLength(1);
    expect(connAUpdates[0][1].status).toBe("disconnected");

    // conn-b must never receive status === "disconnected"
    const connBDisconnects = allUpdateCalls.filter(
      ([id, payload]) => id === "sched-conn-b" && payload?.status === "disconnected",
    );
    expect(connBDisconnects).toHaveLength(0);
  });
});

// ── Tests: runTimezoneAwareIncrementalSyncs — revocation isolation ─────────────

/**
 * Fixtures for the timezone-aware scheduler isolation tests.
 * Both connections have no refresh token so the proactive-refresh block is
 * bypassed and we can focus on mid-sync revocation behaviour.
 * Both connections will be placed in the 4 AM window via getLocalHour injection.
 */
const TZ_CONN_A = {
  id: "tz-conn-a",
  companyId: "co-tz-a",
  status: "active",
  accessToken: "access-token-tz-a",
  refreshToken: null,
  connectedByUserId: "user-tz",
  merchantId: "merchant-tz-a",
  tokenRefreshedAt: new Date(),
  tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
};

const TZ_CONN_B = {
  id: "tz-conn-b",
  companyId: "co-tz-b",
  status: "active",
  accessToken: "access-token-tz-b",
  refreshToken: null,
  connectedByUserId: "user-tz",
  merchantId: "merchant-tz-b",
  tokenRefreshedAt: new Date(),
  tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
};

const JOB_TZ_A = { id: "job-tz-a", status: "running" };
const JOB_TZ_B = { id: "job-tz-b", status: "running" };

const LOC_TZ_EAST = {
  externalLocationId: "loc-tz-east",
  storeId: "store-tz-east",
  externalTimezone: "America/New_York",
};

const LOC_TZ_WEST = {
  externalLocationId: "loc-tz-west",
  storeId: "store-tz-west",
  externalTimezone: "America/Los_Angeles",
};

describe("runTimezoneAwareIncrementalSyncs — revocation on one connection does not affect the next", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
  });

  it("connection B completes its sync and ingests rows even when connection A is revoked in the 4 AM window", async () => {
    // Both connections are eligible (same UTC offset injected → both at local 4 AM)
    mockStorage.getAllActivePosConnections.mockResolvedValue([TZ_CONN_A, TZ_CONN_B]);

    // Window-check pass: getPosLocationMappings called once per connection
    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_TZ_EAST])   // conn-a window check → in window
      .mockResolvedValueOnce([LOC_TZ_WEST])   // conn-b window check → in window
      // Sync pass: getPosLocationMappings called again inside runIncrementalSync
      .mockResolvedValueOnce([LOC_TZ_EAST])   // conn-a sync
      .mockResolvedValueOnce([LOC_TZ_WEST]);  // conn-b sync

    // --- conn-a (revoked) ---
    mockStorage.getPosConnectionById.mockResolvedValueOnce(TZ_CONN_A);
    mockStorage.tryAcquirePosSyncLock.mockResolvedValueOnce({ acquired: true, job: JOB_TZ_A });
    mockSquare.retrieveSales.mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"));

    // --- conn-b (healthy) ---
    mockStorage.getPosConnectionById.mockResolvedValueOnce(TZ_CONN_B);
    mockStorage.tryAcquirePosSyncLock.mockResolvedValueOnce({ acquired: true, job: JOB_TZ_B });
    mockSquare.retrieveSales.mockResolvedValueOnce([
      { locationId: "loc-tz-west", businessDate: "2026-07-27", lines: [{}] },
    ]);
    mockIngest.mockResolvedValueOnce({ rowsIngested: 7, rowsSkipped: 0, adhocItems: [] });

    // Inject: both timezones return local hour 4 so both are eligible
    await runTimezoneAwareIncrementalSyncs({
      getLocalHour: () => 4,
      utcHour: 9,
    });

    // ── Connection A assertions ────────────────────────────────────────────────

    // conn-a must be marked disconnected
    const connADisconnect = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[0] === "tz-conn-a" && args[2]?.status === "disconnected",
    );
    expect(connADisconnect).toBeDefined();

    // conn-a's job must be marked failed
    const jobAFailed = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[0] === JOB_TZ_A.id && args[1]?.status === "failed",
    );
    expect(jobAFailed).toBeDefined();

    // ── Connection B assertions ────────────────────────────────────────────────

    // conn-b must NOT be marked disconnected
    const connBDisconnect = findCallWithShape(
      mockStorage.updatePosConnection,
      (args) => args[0] === "tz-conn-b" && args[2]?.status === "disconnected",
    );
    expect(connBDisconnect).toBeUndefined();

    // conn-b's job must be marked completed
    const jobBCompleted = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[0] === JOB_TZ_B.id && args[1]?.status === "completed",
    );
    expect(jobBCompleted).toBeDefined();
    expect(jobBCompleted![1].rowsIngested).toBe(7);

    // Ingestion ran exactly once — for conn-b only
    expect(mockIngest).toHaveBeenCalledTimes(1);

    // Both connections were attempted — revocation did not abort the loop
    expect(mockStorage.getPosConnectionById).toHaveBeenCalledTimes(2);
  });

  it("connection A is marked disconnected and connection B status is unchanged after the timezone-aware scheduler run", async () => {
    // Variant: verify correct connection IDs and no cross-contamination.
    mockStorage.getAllActivePosConnections.mockResolvedValue([TZ_CONN_A, TZ_CONN_B]);

    // Window-check pass
    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_TZ_EAST])   // conn-a window check
      .mockResolvedValueOnce([LOC_TZ_WEST])   // conn-b window check
      // Sync pass
      .mockResolvedValueOnce([LOC_TZ_EAST])   // conn-a sync — revoked immediately
      .mockResolvedValueOnce([]);             // conn-b sync — no locations → completes trivially

    // conn-a: revoked immediately on retrieveSales
    mockStorage.getPosConnectionById.mockResolvedValueOnce(TZ_CONN_A);
    mockStorage.tryAcquirePosSyncLock.mockResolvedValueOnce({ acquired: true, job: JOB_TZ_A });
    mockSquare.retrieveSales.mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"));

    // conn-b: healthy, no locations — sync completes trivially
    mockStorage.getPosConnectionById.mockResolvedValueOnce(TZ_CONN_B);
    mockStorage.tryAcquirePosSyncLock.mockResolvedValueOnce({ acquired: true, job: JOB_TZ_B });

    await runTimezoneAwareIncrementalSyncs({
      getLocalHour: () => 4,
      utcHour: 9,
    });

    // Collect all updatePosConnection calls keyed by connection id
    const allUpdateCalls: Array<[string, any]> = mockStorage.updatePosConnection.mock.calls.map(
      (args: any[]) => [args[0] as string, args[2]],
    );

    // conn-a must appear exactly once with status === "disconnected"
    const connAUpdates = allUpdateCalls.filter(([id]) => id === "tz-conn-a");
    expect(connAUpdates).toHaveLength(1);
    expect(connAUpdates[0][1].status).toBe("disconnected");

    // conn-b must never receive status === "disconnected"
    const connBDisconnects = allUpdateCalls.filter(
      ([id, payload]) => id === "tz-conn-b" && payload?.status === "disconnected",
    );
    expect(connBDisconnects).toHaveLength(0);
  });
});

// ── Tests: runTimezoneAwareIncrementalSyncs — all connections revoked ──────────

/**
 * Edge case: every connection in the 4 AM window has a revoked token.
 * The scheduler must complete without throwing, mark every connection
 * disconnected, and leave no job in running state.
 */
describe("runTimezoneAwareIncrementalSyncs — all connections in window are revoked", () => {
  // Three connections, all in the 4 AM window, all with revoked tokens.
  const TZ_CONN_C = {
    id: "tz-conn-c",
    companyId: "co-tz-c",
    status: "active",
    accessToken: "access-token-tz-c",
    refreshToken: null,
    connectedByUserId: "user-tz-c",
    merchantId: "merchant-tz-c",
    tokenRefreshedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  };

  const TZ_CONN_D = {
    id: "tz-conn-d",
    companyId: "co-tz-d",
    status: "active",
    accessToken: "access-token-tz-d",
    refreshToken: null,
    connectedByUserId: "user-tz-d",
    merchantId: "merchant-tz-d",
    tokenRefreshedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  };

  const TZ_CONN_E = {
    id: "tz-conn-e",
    companyId: "co-tz-e",
    status: "active",
    accessToken: "access-token-tz-e",
    refreshToken: null,
    connectedByUserId: "user-tz-e",
    merchantId: "merchant-tz-e",
    tokenRefreshedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  };

  const JOB_TZ_C = { id: "job-tz-c", status: "running" };
  const JOB_TZ_D = { id: "job-tz-d", status: "running" };
  const JOB_TZ_E = { id: "job-tz-e", status: "running" };

  const LOC_TZ_C = {
    externalLocationId: "loc-tz-c",
    storeId: "store-tz-c",
    externalTimezone: "America/Chicago",
  };
  const LOC_TZ_D = {
    externalLocationId: "loc-tz-d",
    storeId: "store-tz-d",
    externalTimezone: "America/Denver",
  };
  const LOC_TZ_E = {
    externalLocationId: "loc-tz-e",
    storeId: "store-tz-e",
    externalTimezone: "America/Phoenix",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
  });

  it("resolves without throwing when every connection in the window is revoked", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([TZ_CONN_C, TZ_CONN_D, TZ_CONN_E]);

    // Window-check pass: each connection has a location in the 4 AM window
    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_TZ_C])  // conn-c window check
      .mockResolvedValueOnce([LOC_TZ_D])  // conn-d window check
      .mockResolvedValueOnce([LOC_TZ_E])  // conn-e window check
      // Sync pass: same locations returned for each sync
      .mockResolvedValueOnce([LOC_TZ_C])  // conn-c sync
      .mockResolvedValueOnce([LOC_TZ_D])  // conn-d sync
      .mockResolvedValueOnce([LOC_TZ_E]); // conn-e sync

    // All three connections are looked up during sync
    mockStorage.getPosConnectionById
      .mockResolvedValueOnce(TZ_CONN_C)
      .mockResolvedValueOnce(TZ_CONN_D)
      .mockResolvedValueOnce(TZ_CONN_E);

    // All three acquire a lock
    mockStorage.tryAcquirePosSyncLock
      .mockResolvedValueOnce({ acquired: true, job: JOB_TZ_C })
      .mockResolvedValueOnce({ acquired: true, job: JOB_TZ_D })
      .mockResolvedValueOnce({ acquired: true, job: JOB_TZ_E });

    // All three have revoked tokens — retrieveSales throws for each
    mockSquare.retrieveSales
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"))
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"))
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"));

    // The scheduler must not throw even though every connection is revoked
    await expect(
      runTimezoneAwareIncrementalSyncs({ getLocalHour: () => 4, utcHour: 9 }),
    ).resolves.toBeUndefined();
  });

  it("marks every connection disconnected when all are revoked", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([TZ_CONN_C, TZ_CONN_D, TZ_CONN_E]);

    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_TZ_C])
      .mockResolvedValueOnce([LOC_TZ_D])
      .mockResolvedValueOnce([LOC_TZ_E])
      .mockResolvedValueOnce([LOC_TZ_C])
      .mockResolvedValueOnce([LOC_TZ_D])
      .mockResolvedValueOnce([LOC_TZ_E]);

    mockStorage.getPosConnectionById
      .mockResolvedValueOnce(TZ_CONN_C)
      .mockResolvedValueOnce(TZ_CONN_D)
      .mockResolvedValueOnce(TZ_CONN_E);

    mockStorage.tryAcquirePosSyncLock
      .mockResolvedValueOnce({ acquired: true, job: JOB_TZ_C })
      .mockResolvedValueOnce({ acquired: true, job: JOB_TZ_D })
      .mockResolvedValueOnce({ acquired: true, job: JOB_TZ_E });

    mockSquare.retrieveSales
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"))
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"))
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"));

    await runTimezoneAwareIncrementalSyncs({ getLocalHour: () => 4, utcHour: 9 });

    const disconnectCalls = mockStorage.updatePosConnection.mock.calls.filter(
      (args: any[]) => args[2]?.status === "disconnected",
    );

    // All three connections must have been marked disconnected
    const disconnectedIds = disconnectCalls.map((args: any[]) => args[0] as string);
    expect(disconnectedIds).toContain("tz-conn-c");
    expect(disconnectedIds).toContain("tz-conn-d");
    expect(disconnectedIds).toContain("tz-conn-e");
    expect(disconnectCalls).toHaveLength(3);
  });

  it("leaves no job in running state when all connections are revoked", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([TZ_CONN_C, TZ_CONN_D, TZ_CONN_E]);

    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_TZ_C])
      .mockResolvedValueOnce([LOC_TZ_D])
      .mockResolvedValueOnce([LOC_TZ_E])
      .mockResolvedValueOnce([LOC_TZ_C])
      .mockResolvedValueOnce([LOC_TZ_D])
      .mockResolvedValueOnce([LOC_TZ_E]);

    mockStorage.getPosConnectionById
      .mockResolvedValueOnce(TZ_CONN_C)
      .mockResolvedValueOnce(TZ_CONN_D)
      .mockResolvedValueOnce(TZ_CONN_E);

    mockStorage.tryAcquirePosSyncLock
      .mockResolvedValueOnce({ acquired: true, job: JOB_TZ_C })
      .mockResolvedValueOnce({ acquired: true, job: JOB_TZ_D })
      .mockResolvedValueOnce({ acquired: true, job: JOB_TZ_E });

    mockSquare.retrieveSales
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"))
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"))
      .mockRejectedValueOnce(new SquareTokenRevokedError("unauthorized"));

    await runTimezoneAwareIncrementalSyncs({ getLocalHour: () => 4, utcHour: 9 });

    // Every job update must have moved the job OUT of running state (to failed or completed)
    const jobUpdateCalls: Array<[string, any]> = mockStorage.updatePosSyncJob.mock.calls.map(
      (args: any[]) => [args[0] as string, args[1]],
    );

    // No final status should be "running"
    const stillRunning = jobUpdateCalls.filter(([, payload]) => payload?.status === "running");
    expect(stillRunning).toHaveLength(0);

    // Each job should have been finalised (at least one update per job)
    const updatedJobIds = jobUpdateCalls.map(([id]) => id);
    expect(updatedJobIds).toContain(JOB_TZ_C.id);
    expect(updatedJobIds).toContain(JOB_TZ_D.id);
    expect(updatedJobIds).toContain(JOB_TZ_E.id);
  });
});

// ── Tests: unexpected generic Error after lock acquisition ────────────────────

/**
 * Simulates an unexpected runtime crash (non-SquareTokenRevokedError) that
 * fires inside runIncrementalSync AFTER the lock has been acquired.
 *
 * In the code flow of runIncrementalSync:
 *   1. getPosConnectionById  → connection returned (lock NOT yet held)
 *   2. tryAcquirePosSyncLock → lock ACQUIRED here
 *   3. getPosLocationMappings (inside the try block) → throws generic Error here
 *
 * We mock getPosLocationMappings to throw a generic Error on the call that
 * occurs inside runIncrementalSync (i.e. after lock acquisition) for the
 * failing connection.  The test confirms that:
 *   - The scheduler (runTimezoneAwareIncrementalSyncs) resolves without throwing.
 *   - The failing connection's job is updated to a non-running terminal state.
 *   - The healthy connection completes its sync normally.
 */
describe("runTimezoneAwareIncrementalSyncs — unexpected generic Error after lock acquisition", () => {
  const CRASH_CONN_A = {
    id: "crash-conn-a",
    companyId: "co-crash-a",
    status: "active",
    accessToken: "access-token-crash-a",
    refreshToken: null,
    connectedByUserId: "user-crash",
    merchantId: "merchant-crash-a",
    tokenRefreshedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  };

  const CRASH_CONN_B = {
    id: "crash-conn-b",
    companyId: "co-crash-b",
    status: "active",
    accessToken: "access-token-crash-b",
    refreshToken: null,
    connectedByUserId: "user-crash",
    merchantId: "merchant-crash-b",
    tokenRefreshedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  };

  const JOB_CRASH_A = { id: "job-crash-a", status: "running" };
  const JOB_CRASH_B = { id: "job-crash-b", status: "running" };

  const LOC_CRASH_A = {
    externalLocationId: "loc-crash-a",
    storeId: "store-crash-a",
    externalTimezone: "America/New_York",
  };

  const LOC_CRASH_B = {
    externalLocationId: "loc-crash-b",
    storeId: "store-crash-b",
    externalTimezone: "America/Chicago",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
  });

  it("scheduler resolves without throwing when a generic Error crashes conn-a after lock acquisition", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([CRASH_CONN_A, CRASH_CONN_B]);

    // Window-check pass: getPosLocationMappings called once per connection to determine eligibility
    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_CRASH_A])  // conn-a window check → in 4 AM window
      .mockResolvedValueOnce([LOC_CRASH_B])  // conn-b window check → in 4 AM window
      // Sync pass: getPosLocationMappings called again inside runIncrementalSync (after lock)
      .mockRejectedValueOnce(new Error("Unexpected DB crash after lock"))  // conn-a sync → crash
      .mockResolvedValueOnce([LOC_CRASH_B]);  // conn-b sync → healthy

    mockStorage.getPosConnectionById
      .mockResolvedValueOnce(CRASH_CONN_A)
      .mockResolvedValueOnce(CRASH_CONN_B);

    mockStorage.tryAcquirePosSyncLock
      .mockResolvedValueOnce({ acquired: true, job: JOB_CRASH_A })
      .mockResolvedValueOnce({ acquired: true, job: JOB_CRASH_B });

    // conn-b retrieves sales successfully
    mockSquare.retrieveSales.mockResolvedValueOnce([
      { locationId: "loc-crash-b", businessDate: "2026-07-27", lines: [{}] },
    ]);
    mockIngest.mockResolvedValueOnce({ rowsIngested: 4, rowsSkipped: 0, adhocItems: [] });

    await expect(
      runTimezoneAwareIncrementalSyncs({ getLocalHour: () => 4, utcHour: 9 }),
    ).resolves.toBeUndefined();
  });

  it("the failing connection's job is left in a non-running terminal state (failed) after the crash", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([CRASH_CONN_A, CRASH_CONN_B]);

    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_CRASH_A])
      .mockResolvedValueOnce([LOC_CRASH_B])
      .mockRejectedValueOnce(new Error("Unexpected DB crash after lock"))
      .mockResolvedValueOnce([LOC_CRASH_B]);

    mockStorage.getPosConnectionById
      .mockResolvedValueOnce(CRASH_CONN_A)
      .mockResolvedValueOnce(CRASH_CONN_B);

    mockStorage.tryAcquirePosSyncLock
      .mockResolvedValueOnce({ acquired: true, job: JOB_CRASH_A })
      .mockResolvedValueOnce({ acquired: true, job: JOB_CRASH_B });

    mockSquare.retrieveSales.mockResolvedValueOnce([
      { locationId: "loc-crash-b", businessDate: "2026-07-27", lines: [{}] },
    ]);
    mockIngest.mockResolvedValueOnce({ rowsIngested: 4, rowsSkipped: 0, adhocItems: [] });

    await runTimezoneAwareIncrementalSyncs({ getLocalHour: () => 4, utcHour: 9 });

    // conn-a's job must be updated to a terminal state — not left running
    const jobAFinalUpdate = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[0] === JOB_CRASH_A.id,
    );
    expect(jobAFinalUpdate).toBeDefined();
    expect(jobAFinalUpdate![1].status).not.toBe("running");

    // No updatePosSyncJob call may leave job-crash-a in "running" state
    const jobAStillRunning = mockStorage.updatePosSyncJob.mock.calls.filter(
      (args: any[]) => args[0] === JOB_CRASH_A.id && args[1]?.status === "running",
    );
    expect(jobAStillRunning).toHaveLength(0);
  });

  it("the healthy connection completes its sync and ingests rows even after conn-a crashes", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([CRASH_CONN_A, CRASH_CONN_B]);

    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_CRASH_A])
      .mockResolvedValueOnce([LOC_CRASH_B])
      .mockRejectedValueOnce(new Error("Unexpected DB crash after lock"))
      .mockResolvedValueOnce([LOC_CRASH_B]);

    mockStorage.getPosConnectionById
      .mockResolvedValueOnce(CRASH_CONN_A)
      .mockResolvedValueOnce(CRASH_CONN_B);

    mockStorage.tryAcquirePosSyncLock
      .mockResolvedValueOnce({ acquired: true, job: JOB_CRASH_A })
      .mockResolvedValueOnce({ acquired: true, job: JOB_CRASH_B });

    mockSquare.retrieveSales.mockResolvedValueOnce([
      { locationId: "loc-crash-b", businessDate: "2026-07-27", lines: [{}] },
    ]);
    mockIngest.mockResolvedValueOnce({ rowsIngested: 4, rowsSkipped: 0, adhocItems: [] });

    await runTimezoneAwareIncrementalSyncs({ getLocalHour: () => 4, utcHour: 9 });

    // conn-b's job must be marked completed with the ingested row count
    const jobBCompleted = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[0] === JOB_CRASH_B.id && args[1]?.status === "completed",
    );
    expect(jobBCompleted).toBeDefined();
    expect(jobBCompleted![1].rowsIngested).toBe(4);

    // Both connections were attempted — the crash did not abort the loop
    expect(mockStorage.getPosConnectionById).toHaveBeenCalledTimes(2);
  });
});

/**
 * Same scenario for runAllIncrementalSyncs — verifies that an unexpected generic
 * Error thrown inside runIncrementalSync (after lock acquisition) does not leave
 * the job stuck in "running" state and does not prevent the remaining connections
 * from being processed.
 */
describe("runAllIncrementalSyncs — unexpected generic Error after lock acquisition", () => {
  const SCHED_CRASH_A = {
    id: "sched-crash-a",
    companyId: "co-sched-crash-a",
    status: "active",
    accessToken: "access-token-sched-crash-a",
    refreshToken: null,
    connectedByUserId: "user-sched-crash",
    merchantId: "merchant-sched-crash-a",
    tokenRefreshedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  };

  const SCHED_CRASH_B = {
    id: "sched-crash-b",
    companyId: "co-sched-crash-b",
    status: "active",
    accessToken: "access-token-sched-crash-b",
    refreshToken: null,
    connectedByUserId: "user-sched-crash",
    merchantId: "merchant-sched-crash-b",
    tokenRefreshedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  };

  const JOB_SCHED_CRASH_A = { id: "job-sched-crash-a", status: "running" };
  const JOB_SCHED_CRASH_B = { id: "job-sched-crash-b", status: "running" };

  const LOC_SCHED_CRASH_B = {
    externalLocationId: "loc-sched-crash-b",
    storeId: "store-sched-crash-b",
    externalTimezone: "America/Chicago",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
  });

  it("scheduler resolves without throwing when conn-a crashes with a generic Error after lock acquisition", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([SCHED_CRASH_A, SCHED_CRASH_B]);

    // conn-a: getPosConnectionById succeeds, lock acquired, then getPosLocationMappings crashes
    mockStorage.getPosConnectionById
      .mockResolvedValueOnce(SCHED_CRASH_A)
      .mockResolvedValueOnce(SCHED_CRASH_B);

    mockStorage.tryAcquirePosSyncLock
      .mockResolvedValueOnce({ acquired: true, job: JOB_SCHED_CRASH_A })
      .mockResolvedValueOnce({ acquired: true, job: JOB_SCHED_CRASH_B });

    mockStorage.getPosLocationMappings
      .mockRejectedValueOnce(new Error("Unexpected DB crash after lock"))  // conn-a sync
      .mockResolvedValueOnce([LOC_SCHED_CRASH_B]);  // conn-b sync

    mockSquare.retrieveSales.mockResolvedValueOnce([
      { locationId: "loc-sched-crash-b", businessDate: "2026-07-27", lines: [{}] },
    ]);
    mockIngest.mockResolvedValueOnce({ rowsIngested: 5, rowsSkipped: 0, adhocItems: [] });

    await expect(runAllIncrementalSyncs()).resolves.toBeUndefined();
  });

  it("conn-a job is left in a non-running terminal state and conn-b completes its sync", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([SCHED_CRASH_A, SCHED_CRASH_B]);

    mockStorage.getPosConnectionById
      .mockResolvedValueOnce(SCHED_CRASH_A)
      .mockResolvedValueOnce(SCHED_CRASH_B);

    mockStorage.tryAcquirePosSyncLock
      .mockResolvedValueOnce({ acquired: true, job: JOB_SCHED_CRASH_A })
      .mockResolvedValueOnce({ acquired: true, job: JOB_SCHED_CRASH_B });

    mockStorage.getPosLocationMappings
      .mockRejectedValueOnce(new Error("Unexpected DB crash after lock"))
      .mockResolvedValueOnce([LOC_SCHED_CRASH_B]);

    mockSquare.retrieveSales.mockResolvedValueOnce([
      { locationId: "loc-sched-crash-b", businessDate: "2026-07-27", lines: [{}] },
    ]);
    mockIngest.mockResolvedValueOnce({ rowsIngested: 5, rowsSkipped: 0, adhocItems: [] });

    await runAllIncrementalSyncs();

    // conn-a's job must be finalised — no call may leave it in "running"
    const jobAStillRunning = mockStorage.updatePosSyncJob.mock.calls.filter(
      (args: any[]) => args[0] === JOB_SCHED_CRASH_A.id && args[1]?.status === "running",
    );
    expect(jobAStillRunning).toHaveLength(0);

    // conn-a must have received at least one job update (moving it to a terminal state)
    const jobAUpdated = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[0] === JOB_SCHED_CRASH_A.id,
    );
    expect(jobAUpdated).toBeDefined();
    expect(jobAUpdated![1].status).not.toBe("running");

    // conn-b must complete and ingest its rows
    const jobBCompleted = findCallWithShape(
      mockStorage.updatePosSyncJob,
      (args) => args[0] === JOB_SCHED_CRASH_B.id && args[1]?.status === "completed",
    );
    expect(jobBCompleted).toBeDefined();
    expect(jobBCompleted![1].rowsIngested).toBe(5);

    // Both connections were processed — crash did not abort the outer loop
    expect(mockStorage.getPosConnectionById).toHaveBeenCalledTimes(2);
  });
});

// ── Tests: runTimezoneAwareIncrementalSyncs — zero eligible connections ────────

/**
 * Edge case: the 4 AM window contains zero eligible connections because every
 * connection's locations report a local hour other than 4.  The scheduler must
 * resolve cleanly without calling updatePosConnection or updatePosSyncJob.
 */
describe("runTimezoneAwareIncrementalSyncs — zero connections in 4 AM window", () => {
  // Two connections whose locations are in the middle of the day (hour 10),
  // not in the nightly sync window.
  const TZ_CONN_F = {
    id: "tz-conn-f",
    companyId: "co-tz-f",
    status: "active",
    accessToken: "access-token-tz-f",
    refreshToken: null,
    connectedByUserId: "user-tz-f",
    merchantId: "merchant-tz-f",
    tokenRefreshedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  };

  const TZ_CONN_G = {
    id: "tz-conn-g",
    companyId: "co-tz-g",
    status: "active",
    accessToken: "access-token-tz-g",
    refreshToken: null,
    connectedByUserId: "user-tz-g",
    merchantId: "merchant-tz-g",
    tokenRefreshedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  };

  const LOC_TZ_F = {
    externalLocationId: "loc-tz-f",
    storeId: "store-tz-f",
    externalTimezone: "America/New_York",
  };

  const LOC_TZ_G = {
    externalLocationId: "loc-tz-g",
    storeId: "store-tz-g",
    externalTimezone: "America/Chicago",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.updatePosSyncJob.mockResolvedValue(undefined);
    mockStorage.updatePosConnection.mockResolvedValue(undefined);
  });

  it("resolves without throwing when no connections fall in the 4 AM window", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([TZ_CONN_F, TZ_CONN_G]);

    // Both locations report local hour 10 — neither is in the nightly window
    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_TZ_F]) // conn-f window check
      .mockResolvedValueOnce([LOC_TZ_G]); // conn-g window check

    await expect(
      runTimezoneAwareIncrementalSyncs({ getLocalHour: () => 10, utcHour: 15 }),
    ).resolves.toBeUndefined();
  });

  it("never calls updatePosConnection when no connections are eligible", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([TZ_CONN_F, TZ_CONN_G]);

    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_TZ_F])
      .mockResolvedValueOnce([LOC_TZ_G]);

    await runTimezoneAwareIncrementalSyncs({ getLocalHour: () => 10, utcHour: 15 });

    expect(mockStorage.updatePosConnection).not.toHaveBeenCalled();
  });

  it("never calls updatePosSyncJob when no connections are eligible", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([TZ_CONN_F, TZ_CONN_G]);

    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([LOC_TZ_F])
      .mockResolvedValueOnce([LOC_TZ_G]);

    await runTimezoneAwareIncrementalSyncs({ getLocalHour: () => 10, utcHour: 15 });

    expect(mockStorage.updatePosSyncJob).not.toHaveBeenCalled();
  });
});
