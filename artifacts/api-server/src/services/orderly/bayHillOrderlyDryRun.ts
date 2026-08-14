/**
 * Read-only Bay Hill Orderly probe.
 *
 * Required runtime inputs:
 *   ORDERLY_SESSION_HEADERS_JSON='{"<observed-header-name>":"<session-value>"}'
 *   ORDERLY_DRY_RUN_START_DATE=YYYY-MM-DD
 *   ORDERLY_DRY_RUN_END_DATE=YYYY-MM-DD
 *   ORDERLY_DRY_RUN_CUTOVER_DATE=YYYY-MM-DD
 *
 * The session header JSON is read from a secret and is never printed. The
 * adapter does not stage, persist, or mutate any application data.
 */
import { fetchBayHillOrderlyInvoiceRangePayload } from './bayHillOrderlyAdapter';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readSessionHeaders(): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requiredEnv('ORDERLY_SESSION_HEADERS_JSON'));
  } catch {
    throw new Error('ORDERLY_SESSION_HEADERS_JSON must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ORDERLY_SESSION_HEADERS_JSON must be a JSON object.');
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || !name.trim()) {
      throw new Error('ORDERLY_SESSION_HEADERS_JSON values must be non-empty header strings.');
    }
    headers[name] = value;
  }
  return headers;
}

const payload = await fetchBayHillOrderlyInvoiceRangePayload({
  cutoverDate: requiredEnv('ORDERLY_DRY_RUN_CUTOVER_DATE'),
  startDate: requiredEnv('ORDERLY_DRY_RUN_START_DATE'),
  endDate: requiredEnv('ORDERLY_DRY_RUN_END_DATE'),
  session: { headers: readSessionHeaders() },
});

const lineCount = payload.invoices.reduce((count, invoice) => count + invoice.lines.length, 0);
const vendorNames = new Set(payload.invoices.map(invoice => invoice.vendorName).filter(Boolean));
const totalAmount = payload.invoices.reduce((sum, invoice) => sum + (invoice.totalAmount ?? 0), 0);

console.log(JSON.stringify({
  mode: 'read-only',
  sourceSystem: payload.sourceSystem,
  sourcePropertyId: payload.sourcePropertyId,
  cutoverDate: payload.cutoverDate,
  invoiceCount: payload.invoices.length,
  lineCount,
  vendorCount: vendorNames.size,
  totalAmount,
  rawEvidencePreserved: payload.invoices.every(invoice =>
    Boolean(invoice.source?.orderlyInvoice)
    && invoice.lines.every(line => Boolean(line.source?.orderlyLine)),
  ),
}, null, 2));