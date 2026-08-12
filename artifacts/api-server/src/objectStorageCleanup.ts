/**
 * objectStorageCleanup.ts
 *
 * Deletes unclaimed (abandoned) objects from the Replit object-storage uploads
 * directory.  An object is "unclaimed" when it has no ACL policy metadata —
 * meaning the browser uploaded the file but never called /api/objects/finalize.
 *
 * Safety rules:
 *   - Only objects whose age exceeds UNCLAIMED_THRESHOLD_MS are touched.
 *     This is well beyond the 15-minute signed-URL TTL so an in-flight upload
 *     that hasn't been finalized yet is never deleted.
 *   - Any object that already has an ACL policy is skipped unconditionally,
 *     regardless of age.
 *
 * Call initObjectStorageCleanup() once at server startup.
 */

import { objectStorageClient } from "./objectStorage";
import { getObjectAclPolicy } from "./objectAcl";

// Node.js coerces setInterval/setTimeout delays > 2^31-1 ms to 1 ms.
// Express that limit in hours so both settings can share the same parser.
const NODE_MAX_TIMER_HOURS = Math.floor((2 ** 31 - 1) / (60 * 60 * 1000)); // 596 h

/**
 * Parses an environment variable as a positive finite number of hours.
 *
 * Returns `defaultValue` when the variable is absent or empty.
 * Returns `defaultValue` (with a warning) when the value is non-numeric,
 * non-finite, ≤ 0, or would overflow to Infinity in milliseconds.
 * Clamps silently to `[minValue, maxValue]` when the parsed value is valid
 * but outside the safe operating range.
 */
export function parsePositiveHours(
  envName: string,
  defaultValue: number,
  minValue: number,
  maxValue: number
): number {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === "") return defaultValue;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[ObjectStorageCleanup] ${envName}="${raw}" is not a positive finite number — ` +
        `using default (${defaultValue}h)`
    );
    return defaultValue;
  }

  // Reject values whose millisecond equivalent would be non-finite.
  const ms = parsed * 60 * 60 * 1000;
  if (!Number.isFinite(ms)) {
    console.warn(
      `[ObjectStorageCleanup] ${envName}="${raw}" overflows to Infinity when converted ` +
        `to milliseconds — using default (${defaultValue}h)`
    );
    return defaultValue;
  }

  if (parsed < minValue) {
    console.warn(
      `[ObjectStorageCleanup] ${envName}="${raw}" is below the minimum of ${minValue}h — ` +
        `clamping to minimum`
    );
    return minValue;
  }
  if (parsed > maxValue) {
    console.warn(
      `[ObjectStorageCleanup] ${envName}="${raw}" exceeds the maximum of ${maxValue}h — ` +
        `clamping to maximum`
    );
    return maxValue;
  }

  return parsed;
}

// How old an object must be before it is considered abandoned.
// Defaults to 24 hours; override with OBJECT_CLEANUP_THRESHOLD_HOURS.
// Min: 1 h (well above the 15-minute signed-URL TTL).
// Max: 8 760 h (1 year) — prevents millisecond overflow for any sane input.
const THRESHOLD_HOURS = parsePositiveHours("OBJECT_CLEANUP_THRESHOLD_HOURS", 24, 1, 8760);
const UNCLAIMED_THRESHOLD_MS = THRESHOLD_HOURS * 60 * 60 * 1000;

// How often the cleanup job runs.
// Defaults to 6 hours; override with OBJECT_CLEANUP_INTERVAL_HOURS.
// Min: 0.5 h (30 min) — prevents runaway polling on bad config.
// Max: NODE_MAX_TIMER_HOURS — Node coerces larger delays to 1 ms.
const INTERVAL_HOURS = parsePositiveHours(
  "OBJECT_CLEANUP_INTERVAL_HOURS",
  6,
  0.5,
  NODE_MAX_TIMER_HOURS
);
const CLEANUP_INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  if (parts.length < 3) throw new Error(`Invalid path: ${path}`);
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

/**
 * Returns the bucket name and uploads prefix from PRIVATE_OBJECT_DIR.
 * The env var format is "/<bucket>/<path>".
 */
function getUploadsLocation(): { bucketName: string; uploadsPrefix: string } | null {
  const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!privateDir) return null;

  const { bucketName, objectName } = parseObjectPath(privateDir);
  // All signed-URL uploads land under <privateDir>/uploads/
  const uploadsPrefix = objectName.endsWith("/")
    ? `${objectName}uploads/`
    : `${objectName}/uploads/`;

  return { bucketName, uploadsPrefix };
}

/**
 * Runs one cleanup pass.  Returns the number of objects deleted.
 */
export async function runObjectStorageCleanup(): Promise<number> {
  const location = getUploadsLocation();
  if (!location) {
    // Object storage not configured; nothing to do.
    return 0;
  }

  const { bucketName, uploadsPrefix } = location;
  const bucket = objectStorageClient.bucket(bucketName);
  const cutoff = new Date(Date.now() - UNCLAIMED_THRESHOLD_MS);

  // List every object under the uploads prefix.
  const [files] = await bucket.getFiles({ prefix: uploadsPrefix });

  let deleted = 0;
  let skippedClaimed = 0;
  let skippedTooNew = 0;

  for (const file of files) {
    try {
      // Only consider objects old enough to be safely treated as abandoned.
      const [metadata] = await file.getMetadata();
      const updated = metadata.updated ? new Date(metadata.updated as string) : null;
      if (!updated || updated >= cutoff) {
        skippedTooNew++;
        continue;
      }

      // Skip any object that has already been claimed (has an ACL policy).
      const policy = await getObjectAclPolicy(file);
      if (policy) {
        skippedClaimed++;
        continue;
      }

      await file.delete();
      deleted++;
    } catch (err) {
      // Log and continue — one bad file must not abort the whole run.
      console.error(`[ObjectStorageCleanup] Error processing ${file.name}:`, err);
    }
  }

  console.log(
    `[ObjectStorageCleanup] Run complete — deleted: ${deleted}, ` +
      `skipped (claimed): ${skippedClaimed}, skipped (too new): ${skippedTooNew}`
  );
  return deleted;
}

/**
 * Starts the periodic cleanup job.  Should be called once at server startup.
 * The first run is delayed by 60 s so it doesn't compete with startup I/O.
 */
export function initObjectStorageCleanup(): void {
  // Skip if object storage is not configured.
  if (!process.env.PRIVATE_OBJECT_DIR) {
    console.log("[ObjectStorageCleanup] PRIVATE_OBJECT_DIR not set — cleanup disabled");
    return;
  }

  // Delay first run slightly so startup I/O settles.
  setTimeout(() => {
    runObjectStorageCleanup().catch((err) =>
      console.error("[ObjectStorageCleanup] Initial run failed:", err)
    );

    setInterval(() => {
      runObjectStorageCleanup().catch((err) =>
        console.error("[ObjectStorageCleanup] Periodic run failed:", err)
      );
    }, CLEANUP_INTERVAL_MS);
  }, 60_000);

  console.log(
    `[ObjectStorageCleanup] Scheduled — threshold: ${THRESHOLD_HOURS}h, interval: ${INTERVAL_HOURS}h, first run in ~60s`
  );
}
