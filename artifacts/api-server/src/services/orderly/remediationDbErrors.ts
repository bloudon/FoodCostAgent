/**
 * Sanitized database error reporting for remediation operator entry points.
 *
 * A production operator needs the actual PostgreSQL cause to act on a failure,
 * but the CLI must never print the DATABASE_URL, credentials, or bound query
 * parameters. Drizzle's own error text embeds the failed SQL and its params, so
 * this module extracts only the safe, well-known PostgreSQL diagnostic fields
 * and the connection target with credentials stripped.
 */
import { describeDatabaseTarget } from '../../db';

/** Fields that are diagnostic, not secret. Deliberately an allowlist. */
interface PgErrorFields {
  code?: string;
  severity?: string;
  detail?: string;
  hint?: string;
  constraint?: string;
  table?: string;
  column?: string;
  schema?: string;
  routine?: string;
  errno?: string;
  syscall?: string;
  address?: string;
  port?: string;
}

const SAFE_FIELDS: Array<keyof PgErrorFields> = [
  'code',
  'severity',
  'detail',
  'hint',
  'constraint',
  'table',
  'column',
  'schema',
  'routine',
  'errno',
  'syscall',
  'address',
  'port',
];

/**
 * Well-known causes that are easy to misread as "the row does not exist".
 * Each maps a PostgreSQL/driver code to an operator-actionable explanation.
 */
const CAUSE_HINTS: Record<string, string> = {
  '28P01': 'Password authentication failed. The process is using a different DATABASE_URL than the one you tested.',
  '28000': 'Invalid authorization. The process is using a different DATABASE_URL than the one you tested.',
  '3D000': 'The named database does not exist on this host. Check the connection target below.',
  '42P01': 'A required table is missing. Deploy the normal application migration first.',
  '42703': 'A required column is missing. Deploy the normal application migration first.',
  '57P01': 'The server terminated the connection.',
  ECONNREFUSED: 'Nothing accepted a connection at the target host/port shown below.',
  ENOTFOUND: 'The database host name did not resolve. Check the connection target below.',
  ETIMEDOUT: 'The connection attempt timed out before the server responded.',
  EPROTO: 'TLS/protocol negotiation failed — this is the signature of a driver/SSL mismatch, not a missing row.',
  ERR_INVALID_URL: 'DATABASE_URL is not a valid URL for this driver.',
};

/**
 * True when the error looks like it came from the driver or the server, rather
 * than from our own guard logic. Checks the cause chain because Drizzle wraps
 * the underlying PostgreSQL error.
 */
export function isDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current && typeof current === 'object') {
      const record = current as Record<string, unknown>;
      if (
        typeof record.code === 'string' ||
        typeof record.severity === 'string' ||
        typeof record.routine === 'string' ||
        typeof record.syscall === 'string'
      ) {
        return true;
      }
      if (typeof record.message === 'string' && /Failed query|ECONNREFUSED|ENOTFOUND/i.test(record.message)) {
        return true;
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function readSafeFields(error: unknown): PgErrorFields {
  const out: PgErrorFields = {};
  if (!error || typeof error !== 'object') return out;
  const record = error as Record<string, unknown>;
  for (const field of SAFE_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) {
      out[field] = value;
    } else if (typeof value === 'number') {
      out[field] = String(value);
    }
  }
  return out;
}

/**
 * Walks the `cause` chain, since Drizzle and the Neon driver both wrap the
 * underlying PostgreSQL error rather than exposing its fields directly.
 */
function collectFromCauseChain(error: unknown): PgErrorFields {
  const merged: PgErrorFields = {};
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    Object.assign(merged, { ...readSafeFields(current), ...merged });
    current = (current as { cause?: unknown }).cause;
  }
  return merged;
}

/**
 * One-line sanitized connection target, for attaching to non-database failures
 * so an operator can tell "this row is absent" apart from "this process is
 * talking to the wrong database".
 */
export function describeDatabaseTargetLine(): string {
  const target = describeDatabaseTarget();
  return (
    '  connection target (credentials redacted): ' +
    `driver=${target.driver} host=${target.host} port=${target.port} ` +
    `database=${target.database} sslmode=${target.sslmode}`
  );
}

/**
 * Builds an operator-facing failure report. Prints the sanitized connection
 * target and PostgreSQL diagnostics; never the URL, user, password, or params.
 */
export function formatRemediationDbError(context: string, error: unknown): string {
  const target = describeDatabaseTarget();
  const fields = collectFromCauseChain(error);
  const baseMessage = error instanceof Error ? error.message.split('\n')[0] : String(error);

  const lines = [
    `${context} failed.`,
    `  message: ${baseMessage}`,
  ];

  const causeKey = fields.code ?? fields.errno ?? fields.syscall;
  if (causeKey) {
    lines.push(`  postgres code: ${causeKey}`);
    const hint = CAUSE_HINTS[causeKey];
    if (hint) lines.push(`  likely cause: ${hint}`);
  }
  for (const field of SAFE_FIELDS) {
    if (field === 'code' || field === 'errno') continue;
    const value = fields[field];
    if (value) lines.push(`  ${field}: ${value}`);
  }

  lines.push(
    '  connection target (credentials redacted): ' +
      `driver=${target.driver} host=${target.host} port=${target.port} ` +
      `database=${target.database} sslmode=${target.sslmode}`,
  );

  if (!causeKey) {
    lines.push(
      '  note: no PostgreSQL diagnostic code was attached. If the connection target above is not ' +
        'the database you expect, this process loaded a different environment than the API.',
    );
  }

  return lines.join('\n');
}
