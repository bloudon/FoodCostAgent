/**
 * The CLI must expose the real PostgreSQL cause to an operator while never
 * leaking DATABASE_URL, credentials, or bound query parameters.
 */
import { describe, expect, it } from 'vitest';
import { formatRemediationDbError, isDatabaseError } from './remediationDbErrors';

/** Shape of a Drizzle failure: the wrapper text embeds the SQL and its params. */
function drizzleWrappedError(): Error {
  const pgError = Object.assign(new Error('password authentication failed for user "fnb"'), {
    code: '28P01',
    severity: 'FATAL',
    routine: 'auth_failed',
  });
  const wrapper = new Error(
    'Failed query: select "id", "company_id" from "company_stores" where ...\n' +
      'params: ee9e1530-50db-45f4-ae61-2c45e86827f0,43abaf82-44ce-4231-9570-7a01e7c85ced',
  );
  (wrapper as Error & { cause?: unknown }).cause = pgError;
  return wrapper;
}

describe('formatRemediationDbError', () => {
  it('surfaces the underlying PostgreSQL code from the cause chain', () => {
    const output = formatRemediationDbError('Report mode', drizzleWrappedError());

    expect(output).toContain('Report mode failed.');
    expect(output).toContain('postgres code: 28P01');
    expect(output).toContain('severity: FATAL');
    // The actionable interpretation: it is an env/credential mismatch, not a missing row.
    expect(output).toContain('different DATABASE_URL');
  });

  it('never prints the DATABASE_URL, credentials, or bound parameters', () => {
    const output = formatRemediationDbError('Report mode', drizzleWrappedError());
    const url = process.env.DATABASE_URL ?? '';

    expect(output).not.toContain(url);
    expect(output).not.toContain('password=');
    // Bound params from the Drizzle wrapper text must not be echoed.
    expect(output).not.toContain('params:');
    expect(output).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('reports the sanitized connection target so a wrong environment is visible', () => {
    const output = formatRemediationDbError('Preflight', drizzleWrappedError());

    expect(output).toContain('connection target (credentials redacted)');
    expect(output).toContain('driver=');
    expect(output).toContain('host=');
    expect(output).toContain('sslmode=');
  });

  it('explains a connection-level failure that carries no SQLSTATE', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '127.0.0.1',
      port: '5432',
    });

    const output = formatRemediationDbError('Preflight', refused);

    expect(output).toContain('postgres code: ECONNREFUSED');
    expect(output).toContain('Nothing accepted a connection');
  });
});

describe('isDatabaseError', () => {
  it('recognizes a wrapped driver error', () => {
    expect(isDatabaseError(drizzleWrappedError())).toBe(true);
  });

  it('does not classify plain guard errors as database errors', () => {
    expect(isDatabaseError(new Error('Refusing scope company=wrong'))).toBe(false);
  });
});
