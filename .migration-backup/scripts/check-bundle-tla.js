#!/usr/bin/env node
/**
 * check-bundle-tla.js
 *
 * Counts top-level `await` lines (lines starting with "await ") in dist/index.js
 * after the esbuild bundle step and fails if the count is not exactly 1.
 *
 * Background: The VPS crashed-loop (exit code 13) because server/db.ts used
 * `await import('pg')` at module scope.  esbuild propagated that top-level await
 * into every file that imported db.ts, producing 36 cascading TLAs in the bundle.
 * Any one of them can hang silently when Node exits after evaluating module-level
 * code (exit code 13 = ESM TLA stall).  The legitimate single TLA is the
 * `await (async () => { ... })()` IIFE that keeps the event loop alive on VPS.
 * Everything else must be a static import or moved inside an async function body.
 *
 * Run:  npm run build && node scripts/check-bundle-tla.js
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const BUNDLE = resolve(process.cwd(), "dist/index.js");
const EXPECTED = 1;

let source;
try {
  source = readFileSync(BUNDLE, "utf8");
} catch (err) {
  console.error(`[check-bundle-tla] ERROR: Could not read ${BUNDLE}`);
  console.error(`  → Run 'npm run build' first, then re-run this check.`);
  process.exit(1);
}

// Count lines that start with "await " (top-level await in the ESM bundle).
const lines = source.split("\n");
const tlaLines = lines
  .map((line, i) => ({ line, lineNumber: i + 1 }))
  .filter(({ line }) => /^await /.test(line));

const count = tlaLines.length;

if (count === EXPECTED) {
  console.log(
    `[check-bundle-tla] ✓ Bundle has exactly ${count} top-level await line — OK`
  );
  process.exit(0);
}

// Fail: print details so the engineer knows which lines are the problem.
console.error(
  `[check-bundle-tla] FAIL: Expected ${EXPECTED} top-level await line in dist/index.js, found ${count}.`
);
if (count > EXPECTED) {
  console.error(
    `\n  Extra top-level await lines detected (VPS crash risk — exit code 13):\n`
  );
  tlaLines.forEach(({ line, lineNumber }) => {
    const preview = line.length > 120 ? line.slice(0, 120) + "…" : line;
    console.error(`    Line ${lineNumber}: ${preview}`);
  });
  console.error(
    `\n  Fix: ensure all heavy module imports (pg, ws, drizzle, etc.) use static\n` +
      `  'import' syntax, not 'await import()', at the top level of any server file.\n` +
      `  See server/db.ts for the canonical pattern.\n`
  );
} else {
  console.error(
    `  The expected IIFE keepalive await was not found.  ` +
      `Check that dist/index.js was built from the current source.`
  );
}
process.exit(1);
