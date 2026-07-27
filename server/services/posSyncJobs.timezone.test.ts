/**
 * Unit tests for the timezone-aware nightly sync window logic (#544).
 *
 * All time-dependent behaviour is exercised deterministically by injecting
 * `getLocalHour` and `utcHour` overrides — no real clock or network needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Stable mock stubs ─────────────────────────────────────────────────────────

vi.mock("../storage", () => ({
  storage: {
    getAllActivePosConnections: vi.fn(),
    getPosConnectionById: vi.fn(),
    getPosLocationMappings: vi.fn(),
    tryAcquirePosSyncLock: vi.fn(),
    updatePosSyncJob: vi.fn(),
    updatePosConnection: vi.fn(),
    upsertPosLocationMappings: vi.fn(),
  },
}));

vi.mock("../integrations/pos/square", () => ({
  squarePosConnector: { retrieveSales: vi.fn(), listLocations: vi.fn() },
  SquareTokenRevokedError: class SquareTokenRevokedError extends Error {},
}));

vi.mock("./posIngestion", () => ({
  ingestSalesBatch: vi.fn(),
}));

import {
  isInNightlySyncWindow,
  runTimezoneAwareIncrementalSyncs,
  backfillLocationTimezones,
} from "./posSyncJobs";
import { storage } from "../storage";
import { squarePosConnector } from "../integrations/pos/square";

const mockStorage = storage as any;
const mockSquare = squarePosConnector as any;

// ── isInNightlySyncWindow ─────────────────────────────────────────────────────

describe("isInNightlySyncWindow", () => {
  it("returns true when the injected hour is 4", () => {
    expect(isInNightlySyncWindow("America/New_York", () => 4)).toBe(true);
    expect(isInNightlySyncWindow("America/Los_Angeles", () => 4)).toBe(true);
    expect(isInNightlySyncWindow("UTC", () => 4)).toBe(true);
  });

  it("returns false when the injected hour is not 4", () => {
    for (const h of [0, 1, 2, 3, 5, 12, 23]) {
      expect(isInNightlySyncWindow("America/Chicago", () => h)).toBe(false);
    }
  });

  it("returns false for an invalid IANA timezone (real Intl, no injection)", () => {
    // localHour() catches the Intl exception and returns -1 → never === 4
    expect(isInNightlySyncWindow("Not/A_Timezone")).toBe(false);
    expect(isInNightlySyncWindow("")).toBe(false);
  });

  it("returns a boolean for real IANA zones without injection", () => {
    expect(typeof isInNightlySyncWindow("America/New_York")).toBe("boolean");
    expect(typeof isInNightlySyncWindow("Europe/London")).toBe("boolean");
  });
});

// ── runTimezoneAwareIncrementalSyncs ─────────────────────────────────────────

describe("runTimezoneAwareIncrementalSyncs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: tryAcquirePosSyncLock returns not-acquired so incremental sync exits early
    mockStorage.tryAcquirePosSyncLock.mockResolvedValue({ acquired: false, existingJobId: "job-0" });
  });

  it("syncs a connection when its location timezone is in the 4 AM window", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([
      { id: "conn-1", companyId: "co-1", status: "active", refreshToken: null },
    ]);
    mockStorage.getPosLocationMappings.mockResolvedValue([
      { externalLocationId: "loc-1", storeId: "store-1", externalTimezone: "America/New_York" },
    ]);
    mockStorage.getPosConnectionById.mockResolvedValue(
      { id: "conn-1", companyId: "co-1", status: "active", refreshToken: null },
    );

    // Inject: New York is at hour 4, UTC is at hour 9
    await runTimezoneAwareIncrementalSyncs({
      getLocalHour: (_tz) => 4,
      utcHour: 9,
    });

    // tryAcquirePosSyncLock is called as part of runIncrementalSync
    expect(mockStorage.tryAcquirePosSyncLock).toHaveBeenCalledOnce();
  });

  it("skips a connection when its location timezone is NOT in the 4 AM window", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([
      { id: "conn-2", companyId: "co-1", status: "active", refreshToken: null },
    ]);
    mockStorage.getPosLocationMappings.mockResolvedValue([
      { externalLocationId: "loc-2", storeId: "store-2", externalTimezone: "America/Los_Angeles" },
    ]);

    // Inject: LA is at hour 14, UTC at 22
    await runTimezoneAwareIncrementalSyncs({
      getLocalHour: (_tz) => 14,
      utcHour: 22,
    });

    expect(mockStorage.tryAcquirePosSyncLock).not.toHaveBeenCalled();
  });

  it("syncs a connection with no timezone data when UTC hour is 4 (fallback)", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([
      { id: "conn-3", companyId: "co-1", status: "active", refreshToken: null },
    ]);
    // NULL timezone — legacy connection backfill not yet run
    mockStorage.getPosLocationMappings.mockResolvedValue([
      { externalLocationId: "loc-3", storeId: "store-3", externalTimezone: null },
    ]);
    mockStorage.getPosConnectionById.mockResolvedValue(
      { id: "conn-3", companyId: "co-1", status: "active", refreshToken: null },
    );

    // Inject UTC 4 AM → fallback fires
    await runTimezoneAwareIncrementalSyncs({ utcHour: 4 });

    expect(mockStorage.tryAcquirePosSyncLock).toHaveBeenCalledOnce();
  });

  it("skips a connection with no timezone data when UTC hour is NOT 4", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([
      { id: "conn-4", companyId: "co-1", status: "active", refreshToken: null },
    ]);
    mockStorage.getPosLocationMappings.mockResolvedValue([
      { externalLocationId: "loc-4", storeId: "store-4", externalTimezone: null },
    ]);

    // Inject UTC 9 AM → no fallback
    await runTimezoneAwareIncrementalSyncs({ utcHour: 9 });

    expect(mockStorage.tryAcquirePosSyncLock).not.toHaveBeenCalled();
  });

  it("syncs a connection once even when multiple locations share the same timezone", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([
      { id: "conn-5", companyId: "co-1", status: "active", refreshToken: null },
    ]);
    mockStorage.getPosLocationMappings.mockResolvedValue([
      { externalLocationId: "loc-a", storeId: "s1", externalTimezone: "America/Chicago" },
      { externalLocationId: "loc-b", storeId: "s2", externalTimezone: "America/Chicago" },
      { externalLocationId: "loc-c", storeId: "s3", externalTimezone: "America/Chicago" },
    ]);
    mockStorage.getPosConnectionById.mockResolvedValue(
      { id: "conn-5", companyId: "co-1", status: "active", refreshToken: null },
    );

    await runTimezoneAwareIncrementalSyncs({ getLocalHour: () => 4, utcHour: 10 });

    // Only one sync per connection (not one per location)
    expect(mockStorage.tryAcquirePosSyncLock).toHaveBeenCalledOnce();
  });

  it("syncs only the in-window connection when two connections are in different timezones", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([
      { id: "conn-east", companyId: "co-1", status: "active", refreshToken: null },
      { id: "conn-west", companyId: "co-1", status: "active", refreshToken: null },
    ]);
    // East is at 4 AM, West is at 1 AM
    mockStorage.getPosLocationMappings
      .mockResolvedValueOnce([
        { externalLocationId: "loc-e", storeId: "se", externalTimezone: "America/New_York" },
      ])
      .mockResolvedValueOnce([
        { externalLocationId: "loc-w", storeId: "sw", externalTimezone: "America/Los_Angeles" },
      ]);
    mockStorage.getPosConnectionById.mockResolvedValue(
      { id: "conn-east", companyId: "co-1", status: "active", refreshToken: null },
    );

    // East → 4, West → 1
    await runTimezoneAwareIncrementalSyncs({
      getLocalHour: (tz) => (tz === "America/New_York" ? 4 : 1),
      utcHour: 9,
    });

    expect(mockStorage.tryAcquirePosSyncLock).toHaveBeenCalledOnce();
  });

  it("handles zero active connections without error", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([]);
    await expect(runTimezoneAwareIncrementalSyncs({ utcHour: 4 })).resolves.toBeUndefined();
    expect(mockStorage.getPosLocationMappings).not.toHaveBeenCalled();
  });

  it("handles connections with no location mappings without error", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([
      { id: "conn-6", companyId: "co-1", status: "active", refreshToken: null },
    ]);
    mockStorage.getPosLocationMappings.mockResolvedValue([]);

    // No mappings → fallback; not UTC 4 → skip
    await expect(runTimezoneAwareIncrementalSyncs({ utcHour: 12 })).resolves.toBeUndefined();
    expect(mockStorage.tryAcquirePosSyncLock).not.toHaveBeenCalled();
  });
});

// ── backfillLocationTimezones ─────────────────────────────────────────────────

describe("backfillLocationTimezones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes timezone for an active connection that has NULL timezone mappings", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([
      { id: "conn-legacy", companyId: "co-1", status: "active", accessToken: "tok", refreshToken: null },
    ]);
    mockStorage.getPosLocationMappings.mockResolvedValue([
      { externalLocationId: "loc-1", storeId: "store-1", externalTimezone: null },
    ]);
    mockSquare.listLocations.mockResolvedValue([
      { externalId: "loc-1", name: "Downtown", timezone: "America/Chicago" },
    ]);
    mockStorage.upsertPosLocationMappings.mockResolvedValue([]);

    await backfillLocationTimezones();

    expect(mockSquare.listLocations).toHaveBeenCalledWith("tok");
    expect(mockStorage.upsertPosLocationMappings).toHaveBeenCalledWith(
      "conn-legacy",
      "co-1",
      expect.arrayContaining([
        expect.objectContaining({
          externalLocationId: "loc-1",
          externalTimezone: "America/Chicago",
          storeId: "store-1",
        }),
      ]),
    );
  });

  it("skips a connection where all locations already have timezone data", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([
      { id: "conn-fresh", companyId: "co-1", status: "active", accessToken: "tok2", refreshToken: null },
    ]);
    mockStorage.getPosLocationMappings.mockResolvedValue([
      { externalLocationId: "loc-x", storeId: "sx", externalTimezone: "America/New_York" },
    ]);

    await backfillLocationTimezones();

    // Square API not called — no NULL timezones
    expect(mockSquare.listLocations).not.toHaveBeenCalled();
    expect(mockStorage.upsertPosLocationMappings).not.toHaveBeenCalled();
  });

  it("always refreshes when a specific connectionId is passed (reconnect path)", async () => {
    mockStorage.getPosConnectionById.mockResolvedValue(
      { id: "conn-rc", companyId: "co-1", status: "active", accessToken: "tok3", refreshToken: null },
    );
    mockStorage.getPosLocationMappings.mockResolvedValue([
      // Already has timezone but we still refresh on explicit reconnect
      { externalLocationId: "loc-r", storeId: "sr", externalTimezone: "America/Chicago" },
    ]);
    mockSquare.listLocations.mockResolvedValue([
      { externalId: "loc-r", name: "Riverside", timezone: "America/Chicago" },
    ]);
    mockStorage.upsertPosLocationMappings.mockResolvedValue([]);

    await backfillLocationTimezones("conn-rc");

    expect(mockSquare.listLocations).toHaveBeenCalledWith("tok3");
    expect(mockStorage.upsertPosLocationMappings).toHaveBeenCalledOnce();
  });

  it("handles a Square API failure gracefully (non-fatal)", async () => {
    mockStorage.getAllActivePosConnections.mockResolvedValue([
      { id: "conn-err", companyId: "co-1", status: "active", accessToken: "bad", refreshToken: null },
    ]);
    mockStorage.getPosLocationMappings.mockResolvedValue([
      { externalLocationId: "loc-e", storeId: "se", externalTimezone: null },
    ]);
    mockSquare.listLocations.mockRejectedValue(new Error("Square API 500: internal error"));

    // Must not throw
    await expect(backfillLocationTimezones()).resolves.toBeUndefined();
    expect(mockStorage.upsertPosLocationMappings).not.toHaveBeenCalled();
  });
});
