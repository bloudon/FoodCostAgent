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

import { runIncrementalSync, runBackfill, refreshAllPosTokens } from "./posSyncJobs";
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
