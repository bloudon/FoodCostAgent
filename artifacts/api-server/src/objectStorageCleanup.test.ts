/**
 * Unit tests for objectStorageCleanup.ts
 *
 * Covers two areas:
 *
 * 1. parsePositiveHours() — configuration helper that reads env-var overrides
 *    for the cleanup threshold and interval.  Tests cover defaults, valid
 *    values, invalid strings, zero/negative, min/max clamping, and
 *    Infinity-overflow cases.
 *
 * 2. runObjectStorageCleanup() — the core cleanup pass.  Verifies three safety
 *    rules:
 *      a. Claimed objects (with an ACL policy) are never deleted, regardless of age.
 *      b. Objects newer than the 24-hour threshold are never deleted, regardless of
 *         whether they are claimed.
 *      c. Unclaimed objects older than 24 hours are deleted.
 *
 * Both the GCS bucket client and getObjectAclPolicy are mocked so no live bucket
 * is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parsePositiveHours, runObjectStorageCleanup } from "./objectStorageCleanup";

// ── Hoisted mocks (created before vi.mock factory functions execute) ──────────

const mockGetFiles = vi.hoisted(() => vi.fn());
const mockBucket = vi.hoisted(() => vi.fn(() => ({ getFiles: mockGetFiles })));
const mockGetObjectAclPolicy = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("./objectStorage", () => ({
  objectStorageClient: { bucket: mockBucket },
}));

vi.mock("./objectAcl", () => ({
  getObjectAclPolicy: (...args: unknown[]) => mockGetObjectAclPolicy(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours in ms

/**
 * Builds a minimal mock GCS File whose last-modified timestamp is offset from
 * now by `ageMs` (positive = in the past).
 */
function makeFile(name: string, ageMs: number) {
  const updated = new Date(Date.now() - ageMs).toISOString();
  const deleteFn = vi.fn().mockResolvedValue(undefined);
  return {
    name,
    getMetadata: vi.fn().mockResolvedValue([{ updated }]),
    delete: deleteFn,
    _deleteFn: deleteFn, // expose for assertions
  };
}

// ── parsePositiveHours suite ──────────────────────────────────────────────────

describe("parsePositiveHours", () => {
  const ENV_KEY = "TEST_CLEANUP_HOURS";

  beforeEach(() => {
    delete process.env[ENV_KEY];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env[ENV_KEY];
  });

  it("returns the default when the variable is absent", () => {
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
  });

  it("returns the default when the variable is an empty string", () => {
    process.env[ENV_KEY] = "";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
  });

  it("returns the default when the variable is whitespace only", () => {
    process.env[ENV_KEY] = "   ";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
  });

  it("returns the parsed value for a valid integer string", () => {
    process.env[ENV_KEY] = "12";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(12);
  });

  it("returns the parsed value for a valid fractional string", () => {
    process.env[ENV_KEY] = "0.5";
    expect(parsePositiveHours(ENV_KEY, 6, 0.5, 596)).toBe(0.5);
  });

  it("warns and returns default for a non-numeric string", () => {
    process.env[ENV_KEY] = "invalid";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and returns default for zero", () => {
    process.env[ENV_KEY] = "0";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and returns default for a negative value", () => {
    process.env[ENV_KEY] = "-5";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and returns default for Infinity string", () => {
    process.env[ENV_KEY] = "Infinity";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and returns default for a value that overflows to Infinity in ms", () => {
    // 1e308 * 3_600_000 = Infinity — should be rejected
    process.env[ENV_KEY] = "1e308";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and clamps to minimum when below minValue", () => {
    process.env[ENV_KEY] = "0.1";
    expect(parsePositiveHours(ENV_KEY, 6, 0.5, 596)).toBe(0.5);
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns and clamps to maximum when above maxValue", () => {
    process.env[ENV_KEY] = "10000";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(8760);
    expect(console.warn).toHaveBeenCalled();
  });

  it("accepts a value exactly equal to minValue", () => {
    process.env[ENV_KEY] = "1";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("accepts a value exactly equal to maxValue", () => {
    process.env[ENV_KEY] = "8760";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(8760);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns and returns default for NaN", () => {
    process.env[ENV_KEY] = "NaN";
    expect(parsePositiveHours(ENV_KEY, 24, 1, 8760)).toBe(24);
    expect(console.warn).toHaveBeenCalled();
  });
});

// ── runObjectStorageCleanup suite ─────────────────────────────────────────────

describe("runObjectStorageCleanup", () => {
  const originalEnv = process.env.PRIVATE_OBJECT_DIR;

  beforeEach(() => {
    // Provide a minimal valid PRIVATE_OBJECT_DIR so the cleanup runs.
    process.env.PRIVATE_OBJECT_DIR = "/test-bucket/private";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.PRIVATE_OBJECT_DIR = originalEnv;
  });

  it("skips objects that have an ACL policy (claimed), regardless of age", async () => {
    // File is well past the 24-hour threshold but has been claimed.
    const oldClaimedFile = makeFile("uploads/old-claimed.jpg", THRESHOLD_MS * 2);

    mockGetFiles.mockResolvedValue([[oldClaimedFile]]);
    // Simulate a claimed object: getObjectAclPolicy returns a non-null policy.
    mockGetObjectAclPolicy.mockResolvedValue({
      owner: "user-123",
      visibility: "private",
    });

    const deleted = await runObjectStorageCleanup();

    expect(deleted).toBe(0);
    expect(oldClaimedFile._deleteFn).not.toHaveBeenCalled();
  });

  it("skips objects newer than 24 hours, even if unclaimed", async () => {
    // File is only 1 hour old — well inside the safe window.
    const recentFile = makeFile("uploads/recent.jpg", 60 * 60 * 1000);

    mockGetFiles.mockResolvedValue([[recentFile]]);
    // Unclaimed: getObjectAclPolicy is never even consulted for too-new files,
    // but configure it to return null to be safe.
    mockGetObjectAclPolicy.mockResolvedValue(null);

    const deleted = await runObjectStorageCleanup();

    expect(deleted).toBe(0);
    expect(recentFile._deleteFn).not.toHaveBeenCalled();
    // ACL check should not be reached for files that are too new.
    expect(mockGetObjectAclPolicy).not.toHaveBeenCalled();
  });

  it("deletes objects with no ACL policy that are older than 24 hours (abandoned)", async () => {
    // File is 36 hours old and has never been finalized.
    const abandonedFile = makeFile("uploads/abandoned.jpg", THRESHOLD_MS * 1.5);

    mockGetFiles.mockResolvedValue([[abandonedFile]]);
    // Unclaimed: no ACL policy.
    mockGetObjectAclPolicy.mockResolvedValue(null);

    const deleted = await runObjectStorageCleanup();

    expect(deleted).toBe(1);
    expect(abandonedFile._deleteFn).toHaveBeenCalledOnce();
  });

  it("handles a mix of claimed, too-new, and abandoned files correctly", async () => {
    const abandoned1 = makeFile("uploads/old-a.jpg", THRESHOLD_MS * 2);
    const abandoned2 = makeFile("uploads/old-b.jpg", THRESHOLD_MS * 3);
    const claimed = makeFile("uploads/old-claimed.jpg", THRESHOLD_MS * 2);
    const tooNew = makeFile("uploads/fresh.jpg", 30 * 60 * 1000); // 30 min

    mockGetFiles.mockResolvedValue([[abandoned1, abandoned2, claimed, tooNew]]);

    // Return null (unclaimed) for the abandoned files, a policy for the claimed one.
    mockGetObjectAclPolicy.mockImplementation(async (file: { name: string }) => {
      if (file.name === "uploads/old-claimed.jpg") {
        return { owner: "user-456", visibility: "private" };
      }
      return null;
    });

    const deleted = await runObjectStorageCleanup();

    expect(deleted).toBe(2);
    expect(abandoned1._deleteFn).toHaveBeenCalledOnce();
    expect(abandoned2._deleteFn).toHaveBeenCalledOnce();
    expect(claimed._deleteFn).not.toHaveBeenCalled();
    expect(tooNew._deleteFn).not.toHaveBeenCalled();
  });

  it("returns 0 and does nothing when PRIVATE_OBJECT_DIR is not set", async () => {
    delete process.env.PRIVATE_OBJECT_DIR;

    const deleted = await runObjectStorageCleanup();

    expect(deleted).toBe(0);
    expect(mockGetFiles).not.toHaveBeenCalled();
  });

  it("returns 0 gracefully and logs when bucket.getFiles() rejects (full run failure)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockGetFiles.mockRejectedValue(new Error("GCS auth failure"));

    const deleted = await runObjectStorageCleanup();

    expect(deleted).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Full run failed"),
      expect.any(Error)
    );
    // No individual file operations should have been attempted.
    expect(mockGetObjectAclPolicy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("continues processing remaining files when one file throws an error", async () => {
    const badFile = {
      name: "uploads/bad.jpg",
      getMetadata: vi.fn().mockRejectedValue(new Error("GCS transient error")),
      delete: vi.fn(),
      _deleteFn: vi.fn(),
    };
    const goodFile = makeFile("uploads/good.jpg", THRESHOLD_MS * 2);

    mockGetFiles.mockResolvedValue([[badFile, goodFile]]);
    mockGetObjectAclPolicy.mockResolvedValue(null);

    // Should not throw; should still process the good file.
    const deleted = await runObjectStorageCleanup();

    expect(deleted).toBe(1);
    expect(goodFile._deleteFn).toHaveBeenCalledOnce();
  });
});
