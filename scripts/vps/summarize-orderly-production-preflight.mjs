import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/vps/summarize-orderly-production-preflight.mjs <report.json> <sanitized-output.json>');
}

const report = JSON.parse(await readFile(inputPath, 'utf8'));
if (report?.mode !== 'production-readiness-preflight'
  || report?.isProductionPreview !== false
  || report?.writesExecuted !== 0
  || report?.databaseWritesExecuted !== 0) {
  throw new Error('Refusing to sanitize a report that is not a zero-write production readiness preflight.');
}

const digest = (value) => `sha256:${createHash('sha256').update(String(value ?? '')).digest('hex')}`;
const requiredIndexes = [
  'import_source_property_unique',
  'vendor_item_ext_mappings_source_idx',
  'vendor_items_vendor_item_sku_uniq',
];
const schemaIndexes = Array.isArray(report.schema?.indexes) ? report.schema.indexes : [];
const prerequisiteStatus = {
  exactProperty24472: report.scope?.sourceSystem === 'ORDERLY'
    && report.scope?.sourcePropertyId === '24472',
  exactServingBuild: report.build?.liveApiBuild?.buildId === report.build?.buildId,
  schemaIndexesVerified: requiredIndexes.every((name) => schemaIndexes.includes(name)),
  zeroWriteCatalogStable: report.catalog?.unchanged === true
    && report.writesExecuted === 0
    && report.databaseWritesExecuted === 0,
  integrityClear: report.integrity?.duplicateSkuIdentities === 0
    && report.integrity?.duplicateMappings === 0
    && report.integrity?.orphanMappings === 0,
};
if (!Object.values(prerequisiteStatus).every(Boolean)) {
  throw new Error('Refusing to sanitize a production preflight report with an unmet readiness gate.');
}
const sanitized = {
  reportVersion: 'orderly-adoption-production-preflight-sanitized-v1',
  generatedAt: report.generatedAt,
  preflight: {
    mode: report.mode,
    isProductionPreview: report.isProductionPreview,
    writesExecuted: report.writesExecuted,
    databaseWritesExecuted: report.databaseWritesExecuted,
  },
  evidence: {
    manifestId: report.evidence?.manifestId,
    manifestSha256: report.evidence?.manifestSha256,
    rawSourceFileSha256: report.evidence?.rawSourceFileSha256,
    canonicalSourceFingerprint: report.evidence?.canonicalSourceFingerprint,
    normalizedRelationshipCount: report.evidence?.normalizedRelationshipCount,
    candidateCount: report.evidence?.candidateCount,
  },
  scope: report.scope,
  bindingIdSha256: digest(report.bindingId),
  build: {
    gitSha: report.build?.gitSha,
    apiVersion: report.build?.apiVersion,
    buildId: report.build?.buildId,
    workingTreeClean: report.build?.workingTreeClean,
    liveApiBuild: report.build?.liveApiBuild,
  },
  database: {
    driver: report.database?.driver,
    hostSha256: digest(report.database?.host),
    port: report.database?.port,
    databaseSha256: digest(report.database?.database),
    sslmode: report.database?.sslmode,
  },
  schema: report.schema,
  catalog: report.catalog,
  integrity: report.integrity,
  frozenMappingEvidence: report.frozenMappingEvidence,
  prerequisiteStatus,
  nextAllowedStep: report.nextAllowedStep,
};

const serialized = JSON.stringify(sanitized, null, 2);
if (/postgres(?:ql)?:\/\/|password=|database_url/i.test(serialized)) {
  throw new Error('Refusing to write a sanitized report that appears to contain credentials.');
}
await writeFile(outputPath, `${serialized}\n`, { mode: 0o600 });