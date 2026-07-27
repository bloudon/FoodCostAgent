/**
 * POS Sync Jobs
 * runBackfill — pulls N days of historical data from Square
 * runIncrementalSync — pulls the prior business date + recently modified dates
 * runAllIncrementalSyncs — called by the nightly scheduler
 */
import { storage } from "../storage";
import { squarePosConnector, SquareTokenRevokedError } from "../integrations/pos/square";
import { ingestSalesBatch } from "./posIngestion";

/** Strip any token-shaped strings from error messages before persisting to DB. */
function sanitizeErrorMessage(msg: string): string {
  // Square access tokens are long alphanumeric strings starting with "EAAAl" or similar.
  // Conservatively redact any word of 40+ characters that looks like a bearer token.
  return msg.replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, "[REDACTED]");
}

function todayMinus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function runBackfill(
  connectionId: string,
  days: number = 30,
): Promise<{ rowsIngested: number; error?: string }> {
  const connection = await storage.getPosConnectionById(connectionId);
  if (!connection || connection.status !== "active") {
    return { rowsIngested: 0, error: "Connection not found or inactive" };
  }

  const job = await storage.createPosSyncJob({
    connectionId,
    companyId: connection.companyId,
    jobType: "backfill",
    status: "running",
    startedAt: new Date(),
    daysBackfilled: days,
  });

  let totalRows = 0;
  let totalSkipped = 0;

  try {
    const locationMappings = await storage.getPosLocationMappings(connectionId);
    const mappedLocations = locationMappings.filter((m) => m.storeId);

    const endDate = todayMinus(1); // yesterday
    const startDate = todayMinus(days);

    for (const loc of mappedLocations) {
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
      }
    }

    await storage.updatePosSyncJob(job.id, {
      status: "completed",
      completedAt: new Date(),
      rowsIngested: totalRows,
      rowsSkipped: totalSkipped,
    });

    await storage.updatePosConnection(connectionId, connection.companyId, {
      lastSyncedAt: new Date(),
    });

    return { rowsIngested: totalRows };
  } catch (err: any) {
    console.error("[POS Backfill] Error:", err.message);
    const safeMsg = sanitizeErrorMessage(err.message);
    await storage.updatePosSyncJob(job.id, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: safeMsg,
      rowsIngested: totalRows,
      rowsSkipped: totalSkipped,
    });
    return { rowsIngested: totalRows, error: safeMsg };
  }
}

export async function runIncrementalSync(
  connectionId: string,
): Promise<{ rowsIngested: number; error?: string }> {
  let connection = await storage.getPosConnectionById(connectionId);
  if (!connection || connection.status !== "active") {
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
          return { rowsIngested: 0, error: "Square token revoked — connection marked as disconnected" };
        }
        // Non-auth refresh failures: log and continue with existing token.
        console.warn(`[POS Incremental] Token refresh failed (non-auth): ${refreshErr.message}`);
      }
    }
  }

  const job = await storage.createPosSyncJob({
    connectionId,
    companyId: connection.companyId,
    jobType: "incremental",
    status: "running",
    startedAt: new Date(),
  });

  let totalRows = 0;
  let totalSkipped = 0;

  try {
    const locationMappings = await storage.getPosLocationMappings(connectionId);
    const mappedLocations = locationMappings.filter((m) => m.storeId);

    // Pull prior 2 days to catch refunds and late-closing orders
    const startDate = todayMinus(2);
    const endDate = todayMinus(1);

    for (const loc of mappedLocations) {
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
      }
    }

    await storage.updatePosSyncJob(job.id, {
      status: "completed",
      completedAt: new Date(),
      rowsIngested: totalRows,
      rowsSkipped: totalSkipped,
    });

    await storage.updatePosConnection(connectionId, connection.companyId, {
      lastSyncedAt: new Date(),
    });

    return { rowsIngested: totalRows };
  } catch (err: any) {
    console.error("[POS Incremental] Error:", err.message);

    // If Square revoked the token mid-sync, mark the connection as disconnected.
    if (err instanceof SquareTokenRevokedError) {
      console.warn(`[POS Incremental] Token revoked during sync for connection ${connectionId} — marking disconnected`);
      await storage.updatePosConnection(connectionId, connection.companyId, { status: "disconnected" });
    }

    const safeMsg2 = sanitizeErrorMessage(err.message);
    await storage.updatePosSyncJob(job.id, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: safeMsg2,
      rowsIngested: totalRows,
      rowsSkipped: totalSkipped,
    });
    return { rowsIngested: totalRows, error: safeMsg2 };
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
      } else {
        console.error(
          `[POS Token Refresh] Failed for connection ${conn.id}: ${sanitizeErrorMessage(err.message)}`,
        );
      }
    }
  }

  return { success, failed };
}

/** Called nightly — runs incremental sync for all active connections */
export async function runAllIncrementalSyncs(): Promise<void> {
  const connections = await storage.getAllActivePosConnections();
  console.log(`[POS Nightly] Running incremental sync for ${connections.length} active connection(s)`);

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
