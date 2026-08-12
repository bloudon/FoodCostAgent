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

// How old an object must be before it is considered abandoned (24 hours).
const UNCLAIMED_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// How often the cleanup job runs (every 6 hours).
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
    `[ObjectStorageCleanup] Scheduled — threshold: 24h, interval: 6h, first run in ~60s`
  );
}
