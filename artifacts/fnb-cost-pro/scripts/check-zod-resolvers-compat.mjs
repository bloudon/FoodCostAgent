#!/usr/bin/env node
/**
 * Validates that the installed versions of zod and @hookform/resolvers
 * are on compatible major versions.
 *
 * Compatibility matrix (from @hookform/resolvers release notes):
 *   @hookform/resolvers v5.x  →  zod v4.x
 *   @hookform/resolvers v3.x / v4.x  →  zod v3.x
 *
 * Run manually:  node scripts/check-zod-resolvers-compat.mjs
 * Or via:        pnpm --filter @workspace/fnb-cost-pro run check-deps
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function readInstalledVersion(packageName) {
  try {
    const pkgPath = require.resolve(`${packageName}/package.json`, {
      paths: [path.resolve(__dirname, '..')],
    });
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version;
  } catch {
    return null;
  }
}

function majorOf(version) {
  return parseInt(version.split('.')[0], 10);
}

const zodVersion = readInstalledVersion('zod');
const resolversVersion = readInstalledVersion('@hookform/resolvers');

if (!zodVersion) {
  console.error('❌  zod is not installed — cannot verify compatibility.');
  process.exit(1);
}
if (!resolversVersion) {
  console.error('❌  @hookform/resolvers is not installed — cannot verify compatibility.');
  process.exit(1);
}

const zodMajor = majorOf(zodVersion);
const resolversMajor = majorOf(resolversVersion);

// Known-good pairs: resolvers major → required zod major
const COMPAT = {
  5: 4,
  3: 3,
  4: 3,
};

const expectedZodMajor = COMPAT[resolversMajor];

if (expectedZodMajor === undefined) {
  console.warn(
    `⚠️  @hookform/resolvers v${resolversVersion} is not in the known compatibility table.\n` +
    `   Verify manually that it supports zod v${zodVersion}.\n` +
    `   Update the COMPAT table in scripts/check-zod-resolvers-compat.mjs when confirmed.`
  );
  process.exit(0);
}

if (zodMajor !== expectedZodMajor) {
  console.error(
    `❌  Version mismatch detected!\n` +
    `   @hookform/resolvers v${resolversVersion} (major ${resolversMajor}) requires zod v${expectedZodMajor}.x\n` +
    `   but zod v${zodVersion} (major ${zodMajor}) is installed.\n\n` +
    `   Fix: upgrade both together.\n` +
    `   - resolvers v5.x + zod v4.x  (current approved pairing)\n` +
    `   - resolvers v3.x/v4.x + zod v3.x\n\n` +
    `   See the "Gotchas" section of replit.md for details.`
  );
  process.exit(1);
}

console.log(
  `✅  @hookform/resolvers v${resolversVersion} and zod v${zodVersion} are compatible (both on matching major versions).`
);
