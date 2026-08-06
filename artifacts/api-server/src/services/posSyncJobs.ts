/**
 * POS Sync Jobs
 * runBackfill — pulls N days of historical data from Square
 * runIncrementalSync — pulls the prior business date + recently modified dates
 * runAllIncrementalSyncs — called by the nightly scheduler
 *
 * Concurrency model:
 *   A partial unique index on pos_sync_jobs(connection_id) WHERE status='running'
 *   makes storage.tryAcquirePosSyncLock() the atomic lock.  Only one running job
 *   per connection can exist at the DB level — two concurrent callers can never
 *   both succeed.  Stale locks (> 30 min) are auto-released on conflict.
 */
import type { PosSyncJob } from "@workspace/db";
import { storage } from "../storage";
import { squarePosConnector, SquareTokenRevokedError } from "../integrations/pos/square";
import { ingestSalesBatch, type AdhocItem } from "./posIngestion";
import { sendSquareTokenRevokedAlert } from "../email";

/**
 * Maximum number of ad hoc item entries stored per sync job.
 * When exceeded, the first 199 items are stored and a 200th sentinel entry
 * `{ _overflow: true, total: N }` is appended so the UI can show the true count.
 */
const ADHOC_ITEMS_CAP = 200;

/**
 * Cap the accumulated ad hoc items array before writing to the DB.
 * If the array exceeds ADHOC_ITEMS_CAP, it is trimmed to (CAP - 1) real
 * entries and a sentinel `{ _overflow: true, total: realTotal }` is appended,
 * keeping the stored length at exactly ADHOC_ITEMS_CAP.
 */
export function capAdhocItems(items: AdhocItem[]): AdhocItem[] | null {
  if (items.length === 0) return null;
  if (items.length <= ADHOC_ITEMS_CAP) return items;
  const truncated = items.slice(0, ADHOC_ITEMS_CAP - 1) as any[];
  truncated.push({ _overflow: true, total: items.length });
  return truncated as AdhocItem[];
}

/** Strip any token-shaped strings from error messages before persisting to DB. */
function sanitizeErrorMessage(msg: string): string {
  // Square access tokens are long alphanumeric strings starting with "EAAAl" or similar.
  // Conservatively redact any word of 40+ characters that looks like a bearer token.
  return msg.replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, "[REDACTED]");
}

/**
 * Build the app base URL using the same priority order as buildSquareRedirectUri:
 * APP_BASE_URL env var → REPLIT_DEV_DOMAIN → localhost fallback.
 */
function getAppBaseUrl(): string {
  const appBase = process.env.APP_BASE_URL;
  if (appBase) return appBase.replace(/\/$/, "");
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;
  return replitDomain ? `https://${replitDomain}` : "http://localhost:5000";
}

/**
 * Notify all company admins by email that their Square token was revoked and the
 * connection has been marked disconnected.  Failures are logged but never thrown —
 * the revocation handling must continue regardless.
 */
async function alertAdminsOnTokenRevocation(
  companyId: string,
  merchantId: string,
  context: string,
): Promise<void> {
  try {
    const [company, users] = await Promise.all([
      storage.getCompany(companyId),
      storage.getUsers(companyId),
    ]);

    const companyName = company?.name ?? companyId;
    const reconnectUrl = `${getAppBaseUrl()}/settings/integrations`;
    const admins = users.filter(
      (u) => u.role === "company_admin" || u.role === "global_admin",
    );

    if (admins.length === 0) {
      console.warn(`[${context}] No admin users found for company ${companyId} — skipping token-revoked alert`);
      return;
    }

    await Promise.all(
      admins.map((admin) =>
        sendSquareTokenRevokedAlert({
          to: admin.email,
          // @ts-ignore
          firstName: admin.firstName,
          companyName,
          merchantId,
          reconnectUrl,
        }),
      ),
    );
  } catch (alertErr: any) {
    console.error(`[${context}] Failed to send token-revoked alert:`, alertErr.message);
  }
}

function todayMinus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull N days of historical data for all mapped locations on a connection.
 *
 * @param preCreatedJob  When the caller (e.g. the sync route) has already
 *   acquired the lock atomically and created the job row, pass it here to skip
 *   the lock-acquisition step inside this function.
 */
export async function runBackfill(
  connectionId: string,
  days: number = 30,
  preCreatedJob?: PosSyncJob,
): Promise<{ rowsIngested: number; error?: string; alreadyRunning?: boolean; jobId?: string }> {
  const connection = await storage.getPosConnectionById(connectionId);
  if (!connection || connection.status !== "active") {
    // If a pre-created job row exists, release the lock immediately rather than
    // leaving the row stuck in `running` for up to 30 min.
    if (preCreatedJob) {
      await storage.updatePosSyncJob(preCreatedJob.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Connection not found or inactive — lock released",
      });
    }
    return { rowsIngested: 0, error: "Connection not found or inactive" };
  }

  let job: PosSyncJob;
  if (preCreatedJob) {
    job = preCreatedJob;
  } else {
    // Atomically acquire the sync lock via the partial unique index.
    const lock = await storage.tryAcquirePosSyncLock({
      connectionId,
      companyId: connection.companyId,
      jobType: "backfill",
      status: "running",
      startedAt: new Date(),
      daysBackfilled: days,
    });
    if (!lock.acquired) {
      console.log(
        `[POS Backfill] Skipping — sync already running (job ${lock.existingJobId}) for connection ${connectionId}`,
      );
      return { rowsIngested: 0, alreadyRunning: true, jobId: lock.existingJobId };
    }
    job = lock.job;
  }

  let totalRows = 0;
  let totalSkipped = 0;
  const allAdhocItems: AdhocItem[] = [];
  const locationErrors: string[] = [];

  try {
    const locationMappings = await storage.getPosLocationMappings(connectionId);
    const mappedLocations = locationMappings.filter((m) => m.storeId);

    const endDate = todayMinus(1); // yesterday
    const startDate = todayMinus(days);

    for (const loc of mappedLocations) {
      try {
        const batches = await squarePosConnector.retrieveSales(
          connection.accessToken,
          loc.externalLocationId,
          startDate,
          endDate,
        );

        for (const batch of batches) {
          const result = await ingestSalesBatch(batch, {
            companyId: connection.companyId,
            connectionId,
            connectedByUserId: connection.connectedByUserId,
          });
          totalRows += result.rowsIngested;
          totalSkipped += result.rowsSkipped;
          allAdhocItems.push(...result.adhocItems);
        }
      } catch (locErr: any) {
        // A single location failure must not abort the whole backfill.
        // If the token was revoked, re-throw so the outer catch marks the
        // connection as disconnected.
        if (locErr instanceof SquareTokenRevokedError) throw locErr;
        const safeMsg = sanitizeErrorMessage(locErr.message);
        console.error(`[POS Backfill] Location ${loc.externalLocationId} failed: ${safeMsg}`);
        locationErrors.push(`${loc.externalLocationId}: ${safeMsg}`);
      }
    }

    // Mark completed; if some locations failed, surface them in errorMessage.
    // Only mark "failed" if ALL locations errored and nothing was ingested.
    const allFailed = locationErrors.length > 0 && totalRows === 0 && mappedLocations.length > 0 && locationErrors.length === mappedLocations.length;
    await storage.updatePosSyncJob(job.id, {
      status: allFailed ? "failed" : "completed",
      completedAt: new Date(),
      rowsIngested: totalRows,
      rowsSkipped: totalSkipped,
      adhocItems: capAdhocItems(allAdhocItems),
      errorMessage: locationErrors.length > 0 ? locationErrors.join("; ") : undefined,
    });

    await storage.updatePosConnection(connectionId, connection.companyId, {
      lastSyncedAt: new Date(),
    });

    const firstError = locationErrors.length > 0 ? locationErrors[0] : undefined;
    return { rowsIngested: totalRows, error: firstError };
  } catch (err: any) {
    console.error("[POS Backfill] Error:", err.message);

    // If Square revoked the token mid-backfill, mark the connection as disconnected
    // and alert the company admins so they can reconnect before data gaps grow.
    if (err instanceof SquareTokenRevokedError) {
      console.warn(`[POS Backfill] Token revoked during backfill for connection ${connectionId} — marking disconnected`);
      await storage.updatePosConnection(connectionId, connection.companyId, { status: "disconnected" });
      await alertAdminsOnTokenRevocation(connection.companyId, connection.merchantId, "POS Backfill");
    }

    const safeMsg = sanitizeErrorMessage(err.message);
    try {
      await storage.updatePosSyncJob(job.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: safeMsg,
        rowsIngested: totalRows,
        rowsSkipped: totalSkipped,
      });
    } catch (updateErr: any) {
      // Double-fault: the DB call to mark the job as failed itself failed.
      // Log prominently so the stuck job can be found, but do NOT re-throw —
      // the outer scheduler loop must continue processing other connections.
      console.error(
        `[POS Backfill] Failed to mark job ${job.id} as failed — ` +
        `job may be stuck in running state: ${updateErr.message}`,
      );
    }
    return { rowsIngested: totalRows, error: safeMsg };
  }
}

/**
 * Pull the prior 2 business days for all mapped locations on a connection.
 *
 * @param preCreatedJob  When the caller has already acquired the lock atomically
 *   and created the job row, pass it here to skip the lock-acquisition step.
 */
export async function runIncrementalSync(
  connectionId: string,
  preCreatedJob?: PosSyncJob,
): Promise<{ rowsIngested: number; error?: string; alreadyRunning?: boolean; jobId?: string }> {
  let connection = await storage.getPosConnectionById(connectionId);
  if (!connection || connection.status !== "active") {
    // If a pre-created job row exists, release the lock immediately rather than
    // leaving the row stuck in `running` for up to 30 min.
    if (preCreatedJob) {
      await storage.updatePosSyncJob(preCreatedJob.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Connection not found or inactive — lock released",
      });
    }
    return { rowsIngested: 0, error: "Connection not found or inactive" };
  }

  // Refresh the access token if:
  //   (a) it was never refreshed or last refreshed > 7 days ago (Square recommended cadence), OR
  //   (b) it expires within 24 hours (safety net)
  if (connection.refreshToken) {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const refreshedAt = connection.tokenRefreshedAt ? new Date(connection.tokenRefreshedAt).getTime() : 0;
    const needsRefreshByAge = Date.now() - refreshedAt > SEVEN_DAYS_MS;
    const needsRefreshByExpiry = connection.tokenExpiresAt
      ? new Date(connection.tokenExpiresAt).getTime() - Date.now() < 24 * 60 * 60 * 1000
      : false;

    if (needsRefreshByAge || needsRefreshByExpiry) {
      try {
        const refreshed = await squarePosConnector.refreshCredentials!(
          connection.accessToken,
          connection.refreshToken,
        );
        await storage.updatePosConnection(connectionId, connection.companyId, {
          accessToken: refreshed.accessToken,
          tokenExpiresAt: refreshed.tokenExpiresAt,
          tokenRefreshedAt: new Date(),
        });
        connection = { ...connection, accessToken: refreshed.accessToken };
        console.log(
          `[POS Incremental] Token refreshed for connection ${connectionId}` +
          ` (reason: ${needsRefreshByAge ? "7-day cadence" : "expiry <24h"})`,
        );
      } catch (refreshErr: any) {
        if (refreshErr instanceof SquareTokenRevokedError) {
          console.warn(`[POS Incremental] Token revoked for connection ${connectionId} — marking disconnected`);
          await storage.updatePosConnection(connectionId, connection.companyId, { status: "disconnected" });
          await alertAdminsOnTokenRevocation(connection.companyId, connection.merchantId, "POS Incremental (token refresh)");
          return { rowsIngested: 0, error: "Square token revoked — connection marked as disconnected" };
        }
        // Non-auth refresh failures: log and continue with existing token.
        console.warn(`[POS Incremental] Token refresh failed (non-auth): ${refreshErr.message}`);
      }
    }
  }

  let job: PosSyncJob;
  if (preCreatedJob) {
    job = preCreatedJob;
  } else {
    // Atomically acquire the sync lock via the partial unique index.
    const lock = await storage.tryAcquirePosSyncLock({
      connectionId,
      companyId: connection.companyId,
      jobType: "incremental",
      status: "running",
      startedAt: new Date(),
    });
    if (!lock.acquired) {
      console.log(
        `[POS Incremental] Skipping — sync already running (job ${lock.existingJobId}) for connection ${connectionId}`,
      );
      return { rowsIngested: 0, alreadyRunning: true, jobId: lock.existingJobId };
    }
    job = lock.job;
  }

  let totalRows = 0;
  let totalSkipped = 0;
  const allAdhocItems: AdhocItem[] = [];
  const locationErrors: string[] = [];

  try {
    const locationMappings = await storage.getPosLocationMappings(connectionId);
    const mappedLocations = locationMappings.filter((m) => m.storeId);

    // Pull prior 2 days to catch refunds and late-closing orders
    const startDate = todayMinus(2);
    const endDate = todayMinus(1);

    for (const loc of mappedLocations) {
      try {
        const batches = await squarePosConnector.retrieveSales(
          connection.accessToken,
          loc.externalLocationId,
          startDate,
          endDate,
        );

        for (const batch of batches) {
          const result = await ingestSalesBatch(batch, {
            companyId: connection.companyId,
            connectionId,
            connectedByUserId: connection.connectedByUserId,
          });
          totalRows += result.rowsIngested;
          totalSkipped += result.rowsSkipped;
          allAdhocItems.push(...result.adhocItems);
        }
      } catch (locErr: any) {
        // A single location failure must not abort the whole sync.
        // If the token was revoked, re-throw so the outer catch marks the
        // connection as disconnected.
        if (locErr instanceof SquareTokenRevokedError) throw locErr;
        const safeMsg = sanitizeErrorMessage(locErr.message);
        console.error(`[POS Incremental] Location ${loc.externalLocationId} failed: ${safeMsg}`);
        locationErrors.push(`${loc.externalLocationId}: ${safeMsg}`);
      }
    }

    // Mark completed even when some locations failed; only mark "failed" when
    // every mapped location errored and nothing was ingested.
    const allFailed = locationErrors.length > 0 && totalRows === 0 && mappedLocations.length > 0 && locationErrors.length === mappedLocations.length;
    await storage.updatePosSyncJob(job.id, {
      status: allFailed ? "failed" : "completed",
      completedAt: new Date(),
      rowsIngested: totalRows,
      rowsSkipped: totalSkipped,
      adhocItems: capAdhocItems(allAdhocItems),
      errorMessage: locationErrors.length > 0 ? locationErrors.join("; ") : undefined,
    });

    await storage.updatePosConnection(connectionId, connection.companyId, {
      lastSyncedAt: new Date(),
    });

    const firstError = locationErrors.length > 0 ? locationErrors[0] : undefined;
    return { rowsIngested: totalRows, error: firstError };
  } catch (err: any) {
    console.error("[POS Incremental] Error:", err.message);

    // If Square revoked the token mid-sync, mark the connection as disconnected
    // and alert the company admins so they can reconnect before data gaps grow.
    if (err instanceof SquareTokenRevokedError) {
      console.warn(`[POS Incremental] Token revoked during sync for connection ${connectionId} — marking disconnected`);
      await storage.updatePosConnection(connectionId, connection.companyId, { status: "disconnected" });
      await alertAdminsOnTokenRevocation(connection.companyId, connection.merchantId, "POS Incremental");
    }

    const safeMsg = sanitizeErrorMessage(err.message);
    try {
      await storage.updatePosSyncJob(job.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: safeMsg,
        rowsIngested: totalRows,
        rowsSkipped: totalSkipped,
      });
    } catch (updateErr: any) {
      // Double-fault: the DB call to mark the job as failed itself failed.
      // Log prominently so the stuck job can be found, but do NOT re-throw —
      // the outer scheduler loop must continue processing other connections.
      console.error(
        `[POS Incremental] Failed to mark job ${job.id} as failed — ` +
        `job may be stuck in running state: ${updateErr.message}`,
      );
    }
    return { rowsIngested: totalRows, error: safeMsg };
  }
}

/**
 * Proactively refresh Square OAuth tokens for all active connections where
 * the token has not been refreshed in the past 7 days.  Called by the
 * daily scheduler independently of the nightly sync job.
 */
export async function refreshAllPosTokens(): Promise<{ success: number; failed: number }> {
  const connections = await storage.getAllActivePosConnections();
  let success = 0;
  let failed = 0;

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  for (const conn of connections) {
    if (!conn.refreshToken) continue;

    const refreshedAt = conn.tokenRefreshedAt ? new Date(conn.tokenRefreshedAt).getTime() : 0;
    if (Date.now() - refreshedAt <= SEVEN_DAYS_MS) continue; // recently refreshed — skip

    try {
      const refreshed = await squarePosConnector.refreshCredentials!(
        conn.accessToken,
        conn.refreshToken,
      );
      await storage.updatePosConnection(conn.id, conn.companyId, {
        accessToken: refreshed.accessToken,
        tokenExpiresAt: refreshed.tokenExpiresAt,
        tokenRefreshedAt: new Date(),
      });
      success++;
      console.log(`[POS Token Refresh] Connection ${conn.id} refreshed (merchant ${conn.merchantId})`);
    } catch (err: any) {
      failed++;
      if (err instanceof SquareTokenRevokedError) {
        await storage.updatePosConnection(conn.id, conn.companyId, { status: "disconnected" });
        console.warn(
          `[POS Token Refresh] Token revoked for connection ${conn.id} — marked disconnected`,
        );
        await alertAdminsOnTokenRevocation(conn.companyId, conn.merchantId, "POS Token Refresh");
      } else {
        console.error(
          `[POS Token Refresh] Failed for connection ${conn.id}: ${sanitizeErrorMessage(err.message)}`,
        );
      }
    }
  }

  return { success, failed };
}

/** Called nightly — runs incremental sync for connections eligible for scheduled sync.
 * Only processes companies whose primary_sales_method = 'pos_connector' and
 * whose connection provider matches the company's selected posProvider.
 */
export async function runAllIncrementalSyncs(): Promise<void> {
  const connections = await storage.getPosConnectionsEligibleForSync();
  console.log(`[POS Nightly] Running incremental sync for ${connections.length} eligible connection(s)`);

  for (const conn of connections) {
    try {
      const result = await runIncrementalSync(conn.id);
      console.log(
        `[POS Nightly] Connection ${conn.id}: ${result.rowsIngested} rows ingested${result.error ? ` (error: ${result.error})` : ""}`,
      );
    } catch (err: any) {
      console.error(`[POS Nightly] Unhandled error for connection ${conn.id}:`, err.message);
    }
  }

  console.log("[POS Nightly] Incremental sync complete");
}

/**
 * Return the current local hour (0–23) in the given IANA timezone.
 * Returns -1 if the timezone string is invalid or unsupported.
 */
function localHour(timezone: string): number {
  try {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(new Date());
    // Intl can return "24" for midnight in some locales — normalise
    const h = parseInt(hourStr, 10);
    return isNaN(h) ? -1 : h % 24;
  } catch {
    return -1;
  }
}

/**
 * Returns true when the supplied IANA timezone string is currently in the
 * 4:00–4:59 AM window (i.e. local hour === 4).
 *
 * @param timezone  IANA timezone string (e.g. "America/Los_Angeles")
 * @param getHour   Optional override for the current-hour lookup — used by
 *                  unit tests to inject a fixed hour without mocking the clock.
 */
export function isInNightlySyncWindow(
  timezone: string,
  getHour: (tz: string) => number = localHour,
): boolean {
  return getHour(timezone) === 4;
}

/** Options accepted by runTimezoneAwareIncrementalSyncs — mainly for testing. */
export interface TimezoneAwareSyncOpts {
  /** Override the local-hour lookup (for deterministic unit tests). */
  getLocalHour?: (tz: string) => number;
  /** Override the UTC hour (for deterministic unit tests). */
  utcHour?: number;
}

/**
 * Hourly pass — called every hour by the scheduler.
 * Syncs only the connections whose mapped Square locations' local time is
 * currently 4:00–4:59 AM.  Connections with no timezone data fall back to
 * the UTC hour so they fire at 4 AM UTC (safe default).
 *
 * @param opts  Optional overrides for deterministic testing.
 */
export async function runTimezoneAwareIncrementalSyncs(
  opts: TimezoneAwareSyncOpts = {},
): Promise<void> {
  // Only sync connections whose company has primary_sales_method = 'pos_connector'
  // and whose provider matches the company's posProvider.
  const connections = await storage.getPosConnectionsEligibleForSync();
  const currentUtcHour = opts.utcHour ?? new Date().getUTCHours();
  const getHour = opts.getLocalHour ?? localHour;

  const eligible: typeof connections = [];

  for (const conn of connections) {
    const locationMappings = await storage.getPosLocationMappings(conn.id);

    // Collect distinct, non-null timezones from mapped locations
    const timezones = [
      ...new Set(locationMappings.map((m) => m.externalTimezone).filter(Boolean) as string[]),
    ];

    if (timezones.length === 0) {
      // No timezone data — fall back to UTC 4 AM
      if (currentUtcHour === 4) {
        eligible.push(conn);
      }
      continue;
    }

    // Eligible if ANY mapped location's local time is in the 4 AM window
    const inWindow = timezones.some((tz) => isInNightlySyncWindow(tz, getHour));
    if (inWindow) {
      eligible.push(conn);
    }
  }

  if (eligible.length === 0) {
    console.log(`[POS Hourly] No connections in 4 AM window at UTC ${currentUtcHour}:xx — skipping`);
    return;
  }

  console.log(
    `[POS Hourly] ${eligible.length} of ${connections.length} connection(s) in 4 AM window — syncing`,
  );

  for (const conn of eligible) {
    try {
      const result = await runIncrementalSync(conn.id);
      console.log(
        `[POS Hourly] Connection ${conn.id}: ${result.rowsIngested} rows ingested` +
        `${result.error ? ` (error: ${result.error})` : ""}`,
      );
    } catch (err: any) {
      console.error(`[POS Hourly] Unhandled error for connection ${conn.id}:`, err.message);
    }
  }

  console.log("[POS Hourly] Timezone-aware sync pass complete");
}

/**
 * Backfill `externalTimezone` for active connections whose location mappings
 * still have NULL timezone (i.e. they were connected before #544 shipped).
 *
 * Called once at startup (non-blocking — errors are logged, not rethrown).
 * Also used by the reconnect path to refresh stale timezone data.
 *
 * @param connectionId  If provided, only that connection is refreshed.
 *                      Omit to scan all active connections.
 */
export async function backfillLocationTimezones(connectionId?: string): Promise<void> {
  const { squarePosConnector } = await import("../integrations/pos/square");

  const connections = connectionId
    ? [await storage.getPosConnectionById(connectionId)].filter(Boolean) as Awaited<ReturnType<typeof storage.getPosConnectionById>>[]
    : await storage.getAllActivePosConnections();

  for (const conn of connections) {
    if (!conn || conn.status !== "active") continue;

    try {
      const existingMappings = await storage.getPosLocationMappings(conn.id);
      const hasMissingTz = existingMappings.some((m) => !m.externalTimezone);
      if (!hasMissingTz && !connectionId) {
        // All locations already have timezone data — skip API call unless
        // an explicit connectionId was passed (reconnect refresh)
        continue;
      }

      const locations = await squarePosConnector.listLocations(conn.accessToken);
      if (locations.length === 0) continue;

      await storage.upsertPosLocationMappings(
        conn.id,
        conn.companyId,
        locations.map((loc) => ({
          externalLocationId: loc.externalId,
          externalLocationName: loc.name,
          storeId: existingMappings.find((m) => m.externalLocationId === loc.externalId)?.storeId ?? null,
          externalTimezone: loc.timezone ?? null,
        })),
      );

      console.log(
        `[POS TZ Backfill] Refreshed timezone for connection ${conn.id} ` +
        `(${locations.length} location(s))`,
      );
    } catch (err: any) {
      // Non-fatal — log and continue so one bad connection doesn't block others
      console.warn(
        `[POS TZ Backfill] Failed for connection ${conn?.id}: ${sanitizeErrorMessage(err.message)}`,
      );
    }
  }
}
