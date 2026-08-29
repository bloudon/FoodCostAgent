import { createHash } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { parse as parseCsv } from 'csv-parse/sync';
import XLSX from 'xlsx';
import {
  accountingAccounts,
  accountingImportAudits,
  accountingImportRows,
  accountingImportSessions,
  categories,
  type AccountingAccount,
} from '@workspace/db';
import { db } from '../db';
import { storage } from '../storage';
import { hasCompanyAccess } from '../permissions';
import { tierMeetsMinimum } from '../tier-config';
import { AccountingClassificationError, UNASSIGNED_ACCOUNTING_LABEL } from './accountingClassification';

export const ACCOUNT_TYPES = ['Revenue', 'Expense'] as const;
export const FINANCIAL_CATEGORIES = ['Sales', 'COGS', 'Other Expense'] as const;
export const OPERATIONAL_TYPES = ['Food', 'Bar', 'Direct Operating Cost', 'Other'] as const;
export const UNASSIGNED_ACCOUNT_NUMBER = '999900';

export type AccountingImportMapping = {
  accountNumber: string;
  accountName: string;
  accountType?: string;
  financialCategory?: string;
  operationalType?: string;
};

type ImportAuth = { actingUserId?: string | null; companyId?: string | null };
type ParsedRow = {
  rowNumber: number;
  rawData: Record<string, string>;
  accountNumber: string | null;
  accountName: string | null;
  accountType: string | null;
  financialCategory: string | null;
  operationalType: string | null;
  outcome: 'created' | 'updated' | 'unchanged' | 'duplicate' | 'malformed' | 'rejected';
  reason: string | null;
};

function importError(code: ConstructorParameters<typeof AccountingClassificationError>[0], message: string): never {
  throw new AccountingClassificationError(code, message);
}

async function authorize(auth: ImportAuth) {
  if (!auth.actingUserId?.trim() || !auth.companyId?.trim()) {
    importError('UNAUTHENTICATED', 'An acting user and company context are required.');
  }
  const user = await storage.getUser(auth.actingUserId.trim());
  if (!user || user.active !== 1) importError('UNAUTHENTICATED', 'The acting user could not be verified.');
  if (!hasCompanyAccess(user, auth.companyId.trim())) importError('FORBIDDEN', 'Company administrator access is required.');
  if (user.role !== 'company_admin' && user.role !== 'owner' && user.role !== 'global_admin') {
    importError('FORBIDDEN', 'Company administrator access is required.');
  }
  const company = await storage.getCompany(auth.companyId.trim());
  if (!company || !tierMeetsMinimum(company.subscriptionPlan, 'enterprise')) {
    importError('FORBIDDEN', 'An Enterprise company is required.');
  }
  return { user, companyId: auth.companyId.trim(), actingUserId: auth.actingUserId.trim() };
}

function cell(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function canonical(value: string, allowed: readonly string[], label: string): { value: string | null; error?: string } {
  if (!value) return { value: null };
  const matched = allowed.find(option => option.toLocaleLowerCase() === value.toLocaleLowerCase());
  return matched ? { value: matched } : { value: null, error: `${label} must be one of: ${allowed.join(', ')}.` };
}

export function readAccountingImportFile(buffer: Buffer, filename: string, headerRow: number) {
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > 500) {
    importError('INVALID_REQUEST', 'Header row must be an integer between 1 and 500.');
  }
  const lower = filename.toLocaleLowerCase();
  let sheetName: string | null = null;
  let matrix: unknown[][];
  if (lower.endsWith('.csv')) {
    matrix = parseCsv(buffer.toString('utf8'), { bom: true, relax_column_count: true, skip_empty_lines: false });
  } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });
    sheetName = workbook.SheetNames[0] ?? null;
    if (!sheetName) importError('INVALID_REQUEST', 'The workbook does not contain a worksheet.');
    matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]!, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true,
    }) as unknown[][];
  } else {
    importError('INVALID_REQUEST', 'Only CSV, XLSX, and XLS files are accepted.');
  }
  const header = (matrix[headerRow - 1] ?? []).map(cell);
  const seen = new Set<string>();
  const columns = header.filter(name => {
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  if (columns.length === 0) importError('INVALID_REQUEST', `No column headers were found on row ${headerRow}.`);
  const data: Array<{ rowNumber: number; rawData: Record<string, string> }> = [];
  for (const [index, values] of matrix.slice(headerRow).entries()) {
    const rawData: Record<string, string> = {};
    header.forEach((name, columnIndex) => {
      if (name) rawData[name] = cell(values[columnIndex]);
    });
    // A fully blank row terminates the account table. This prevents notes or
    // secondary material below the table from being interpreted as accounts.
    if (!Object.values(rawData).some(Boolean)) break;
    data.push({ rowNumber: headerRow + index + 1, rawData });
  }
  return { columns, data, sheetName };
}

function validateMapping(mapping: AccountingImportMapping, columns: string[]) {
  if (!mapping.accountNumber || !mapping.accountName) {
    importError('INVALID_REQUEST', 'Account Number and Account Name column mappings are required.');
  }
  for (const [field, column] of Object.entries(mapping)) {
    if (column && !columns.includes(column)) importError('INVALID_REQUEST', `${field} maps to an unknown column "${column}".`);
  }
}

function rowPlan(
  sourceRows: Array<{ rowNumber: number; rawData: Record<string, string> }>,
  mapping: AccountingImportMapping,
  existingByCode: Map<string, typeof accountingAccounts.$inferSelect>,
): ParsedRow[] {
  const codes = new Map<string, number>();
  for (const source of sourceRows) {
    const code = cell(source.rawData[mapping.accountNumber]);
    if (code) codes.set(code, (codes.get(code) ?? 0) + 1);
  }
  return sourceRows.map(source => {
    const accountNumber = cell(source.rawData[mapping.accountNumber]) || null;
    const accountName = cell(source.rawData[mapping.accountName]) || null;
    const type = canonical(mapping.accountType ? cell(source.rawData[mapping.accountType]) : '', ACCOUNT_TYPES, 'Account Type');
    const financial = canonical(mapping.financialCategory ? cell(source.rawData[mapping.financialCategory]) : '', FINANCIAL_CATEGORIES, 'Financial Category');
    const operational = canonical(mapping.operationalType ? cell(source.rawData[mapping.operationalType]) : '', OPERATIONAL_TYPES, 'Operational Type');
    const base = {
      rowNumber: source.rowNumber,
      rawData: source.rawData,
      accountNumber,
      accountName,
      accountType: type.value,
      financialCategory: financial.value,
      operationalType: operational.value,
    };
    if (!accountNumber || !accountName) {
      return { ...base, outcome: 'malformed' as const, reason: 'Account Number and Account Name are required.' };
    }
    if (accountNumber === UNASSIGNED_ACCOUNT_NUMBER) {
      return { ...base, outcome: 'rejected' as const, reason: '999900 is reserved for the system-managed unassigned account.' };
    }
    if ((codes.get(accountNumber) ?? 0) > 1) {
      return { ...base, outcome: 'duplicate' as const, reason: `Account Number ${accountNumber} appears more than once in this file.` };
    }
    const enumError = type.error ?? financial.error ?? operational.error;
    if (enumError) return { ...base, outcome: 'rejected' as const, reason: enumError };
    const existing = existingByCode.get(accountNumber);
    if (!existing) return { ...base, outcome: 'created' as const, reason: null };
    const unchanged =
      existing.name === accountName &&
      (existing.accountType ?? null) === type.value &&
      (existing.financialCategory ?? null) === financial.value &&
      (existing.operationalType ?? null) === operational.value &&
      existing.isActive === 1;
    return {
      ...base,
      outcome: unchanged ? 'unchanged' as const : 'updated' as const,
      reason: unchanged ? null : 'Existing account attributes will be updated.',
    };
  });
}

function hashPlan(rows: ParsedRow[], categoryMappings: any[] = []) {
  return createHash('sha256').update(JSON.stringify({
    rows: rows.map(row => ({
    rowNumber: row.rowNumber,
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    accountType: row.accountType,
    financialCategory: row.financialCategory,
    operationalType: row.operationalType,
    outcome: row.outcome,
    reason: row.reason,
    })),
    categoryMappings: categoryMappings.map(item => ({
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      accountNumber: item.accountNumber,
      status: item.status,
    })).sort((a, b) => a.categoryId.localeCompare(b.categoryId)),
  })).digest('hex');
}

function summaryFor(rows: ParsedRow[], categoriesMappable: number, categoriesTotal: number, existingCount: number, sentinelExists: boolean) {
  const count = (outcome: ParsedRow['outcome']) => rows.filter(row => row.outcome === outcome).length;
  const accepted = rows.filter(row => ['created', 'updated', 'unchanged'].includes(row.outcome));
  const categoryBreakdown = Object.fromEntries(OPERATIONAL_TYPES.map(value => [
    value === 'Direct Operating Cost' ? 'DOC' : value,
    accepted.filter(row => row.operationalType === value).length,
  ]));
  const createdAccounts = count('created');
  return {
    sourceRows: rows.length,
    validRows: accepted.length,
    createdAccounts,
    updatedAccounts: count('updated'),
    unchangedAccounts: count('unchanged'),
    duplicateRows: count('duplicate'),
    malformedRows: count('malformed'),
    rejectedRows: count('rejected') + count('duplicate') + count('malformed'),
    sentinelCreated: sentinelExists ? 0 : 1,
    totalAccounts: existingCount + createdAccounts + (sentinelExists ? 0 : 1),
    categoriesMappable,
    categoriesTotal,
    operationalTypePopulated: accepted.filter(row => row.operationalType !== null).length,
    categoryBreakdown,
  };
}

async function exactCategoryPreview(companyId: string, rows: ParsedRow[], tx: any = db) {
  const companyCategories = await tx.select({ id: categories.id, name: categories.name, accountingAccountId: categories.accountingAccountId })
    .from(categories).where(and(eq(categories.companyId, companyId), eq(categories.isActive, 1)));
  const acceptedByName = new Map(rows
    .filter(row => row.accountName && ['created', 'updated', 'unchanged'].includes(row.outcome))
    .map(row => [row.accountName!.toLocaleLowerCase(), row]));
  const existingAccounts = await tx.select().from(accountingAccounts).where(eq(accountingAccounts.companyId, companyId));
  for (const account of existingAccounts) acceptedByName.set(account.name.toLocaleLowerCase(), {
    rowNumber: 0, rawData: {}, accountNumber: account.code, accountName: account.name,
    accountType: account.accountType, financialCategory: account.financialCategory,
    operationalType: account.operationalType, outcome: 'unchanged', reason: null,
  });
  return companyCategories.map((category: any) => {
    if (category.name.toLocaleLowerCase() === 'no account') {
      return { categoryId: category.id, categoryName: category.name, accountName: UNASSIGNED_ACCOUNTING_LABEL, accountNumber: UNASSIGNED_ACCOUNT_NUMBER, status: 'sentinel' as const };
    }
    const account = acceptedByName.get(category.name.toLocaleLowerCase());
    return account
      ? { categoryId: category.id, categoryName: category.name, accountName: account.accountName, accountNumber: account.accountNumber, status: 'exact' as const }
      : { categoryId: category.id, categoryName: category.name, accountName: null, accountNumber: null, status: 'review_required' as const };
  });
}

export async function previewAccountingImport(params: {
  buffer: Buffer;
  filename: string;
  headerRow: number;
  mapping?: AccountingImportMapping;
  auth: ImportAuth;
}) {
  const { companyId, actingUserId } = await authorize(params.auth);
  const parsed = readAccountingImportFile(params.buffer, params.filename, params.headerRow);
  if (!params.mapping?.accountNumber || !params.mapping.accountName) {
    return { sessionId: null, filename: params.filename, headerRow: params.headerRow, sheetName: parsed.sheetName, columns: parsed.columns, mapping: params.mapping ?? {}, mappingRequired: true, rows: [], categoryMappings: [], summary: null };
  }
  validateMapping(params.mapping, parsed.columns);
  const existing = await db.select().from(accountingAccounts).where(eq(accountingAccounts.companyId, companyId));
  const existingByCode = new Map<string, AccountingAccount>(
    (existing as AccountingAccount[]).map((account) => [account.code, account]),
  );
  const rows = rowPlan(parsed.data, params.mapping, existingByCode);
  const categoryMappings = await exactCategoryPreview(companyId, rows);
  const sentinelExists = existingByCode.has(UNASSIGNED_ACCOUNT_NUMBER);
  const summary = summaryFor(
    rows,
    categoryMappings.filter((item: { status: string }) => item.status === 'exact').length,
    categoryMappings.length,
    existing.length,
    sentinelExists,
  );
  const fileHash = createHash('sha256').update(params.buffer).digest('hex');
  const planHash = hashPlan(rows, categoryMappings);
  const session = await db.transaction(async (tx: any) => {
    const [created] = await tx.insert(accountingImportSessions).values({
      companyId,
      sourceFilename: params.filename,
      fileHash,
      uploadedBy: actingUserId,
      headerRow: params.headerRow,
      sheetName: parsed.sheetName,
      columnMapping: params.mapping,
      previewSummary: summary,
      previewPlanHash: planHash,
      status: 'previewed',
    }).returning();
    if (rows.length) {
      await tx.insert(accountingImportRows).values(rows.map(row => ({
        sessionId: created.id,
        rowNumber: row.rowNumber,
        rawData: row.rawData,
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        accountType: row.accountType,
        financialCategory: row.financialCategory,
        operationalType: row.operationalType,
        previewOutcome: row.outcome,
        previewReason: row.reason,
      })));
    }
    return created;
  });
  return { sessionId: session.id, filename: params.filename, headerRow: params.headerRow, sheetName: parsed.sheetName, columns: parsed.columns, mapping: params.mapping, mappingRequired: false, rows, categoryMappings, summary };
}

export async function getCurrentAccountingImport(auth: ImportAuth) {
  const { companyId } = await authorize(auth);
  const [session] = await db.select().from(accountingImportSessions)
    .where(eq(accountingImportSessions.companyId, companyId))
    .orderBy(desc(accountingImportSessions.createdAt)).limit(1);
  if (!session) return null;
  const rows = await db.select().from(accountingImportRows).where(eq(accountingImportRows.sessionId, session.id));
  return { ...session, rows };
}

export async function getCategoryMappingPreview(auth: ImportAuth) {
  const { companyId } = await authorize(auth);
  const existing = await db.select().from(accountingAccounts).where(eq(accountingAccounts.companyId, companyId));
  const rows: ParsedRow[] = (existing as AccountingAccount[]).map((account) => ({
    rowNumber: 0, rawData: {}, accountNumber: account.code, accountName: account.name,
    accountType: account.accountType, financialCategory: account.financialCategory,
    operationalType: account.operationalType, outcome: 'unchanged', reason: null,
  }));
  return exactCategoryPreview(companyId, rows);
}

export async function confirmAccountingImport(sessionId: string, applyExactCategoryMappings: boolean, auth: ImportAuth) {
  const { companyId, actingUserId } = await authorize(auth);
  return db.transaction(async (tx: any) => {
    // Serialize chart confirmations per tenant. Session-row locks alone do not
    // protect two different previews for the same company from racing.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`accounting-import:${companyId}`}, 0))`);
    const sessions = await tx.execute(sql`
      SELECT * FROM accounting_import_sessions
      WHERE id = ${sessionId} AND company_id = ${companyId}
      FOR UPDATE
    `);
    const session = (Array.isArray(sessions) ? sessions[0] : sessions.rows?.[0]) as any;
    if (!session) importError('NOT_FOUND', 'Accounting import preview not found.');
    if (session.status === 'confirmed') {
      const [audit] = await tx.select().from(accountingImportAudits).where(and(
        eq(accountingImportAudits.sessionId, sessionId),
        eq(accountingImportAudits.companyId, companyId),
      )).limit(1);
      const accounts = await tx.select().from(accountingAccounts).where(eq(accountingAccounts.companyId, companyId));
      return { idempotent: true, auditId: audit?.id ?? null, summary: audit?.resultSummary ?? session.preview_summary, accounts };
    }
    if (session.status !== 'previewed') importError('CONFLICT', 'This import preview is no longer confirmable.');
    const stored = await tx.select().from(accountingImportRows).where(eq(accountingImportRows.sessionId, sessionId));
    const existing = await tx.select().from(accountingAccounts).where(eq(accountingAccounts.companyId, companyId));
    const sourceRows = stored.map((row: any) => ({ rowNumber: row.rowNumber, rawData: row.rawData as Record<string, string> }));
    const mapping = session.column_mapping as AccountingImportMapping;
    const currentRows = rowPlan(sourceRows, mapping, new Map(existing.map((account: any) => [account.code, account])));
    const reviewedCategoryMappings = await exactCategoryPreview(companyId, currentRows, tx);
    if (hashPlan(currentRows, reviewedCategoryMappings) !== session.preview_plan_hash) {
      importError('CONFLICT', 'Accounts changed after preview. Generate a new preview before confirming.');
    }
    if (currentRows.some(row => ['duplicate', 'malformed', 'rejected'].includes(row.outcome))) {
      importError('INVALID_REQUEST', 'Rejected preview rows must be corrected before confirmation.');
    }
    let sentinel = existing.find((account: any) => account.code === UNASSIGNED_ACCOUNT_NUMBER);
    if (sentinel && sentinel.name !== UNASSIGNED_ACCOUNTING_LABEL) {
      importError('CONFLICT', 'Reserved account 999900 exists with an incompatible name.');
    }
    if (!sentinel) {
      [sentinel] = await tx.insert(accountingAccounts).values({
        companyId,
        code: UNASSIGNED_ACCOUNT_NUMBER,
        name: UNASSIGNED_ACCOUNTING_LABEL,
        accountType: null,
        financialCategory: null,
        operationalType: null,
        isActive: 1,
      }).returning();
    }
    for (const row of currentRows) {
      if (row.outcome === 'created') {
        await tx.insert(accountingAccounts).values({
          companyId, code: row.accountNumber!, name: row.accountName!,
          accountType: row.accountType, financialCategory: row.financialCategory,
          operationalType: row.operationalType, isActive: 1,
        });
      } else if (row.outcome === 'updated') {
        await tx.update(accountingAccounts).set({
          name: row.accountName!, accountType: row.accountType,
          financialCategory: row.financialCategory, operationalType: row.operationalType,
          isActive: 1, updatedAt: new Date(),
        }).where(and(eq(accountingAccounts.companyId, companyId), eq(accountingAccounts.code, row.accountNumber!)));
      }
      await tx.update(accountingImportRows).set({ resultOutcome: row.outcome, resultReason: row.reason })
        .where(and(eq(accountingImportRows.sessionId, sessionId), eq(accountingImportRows.rowNumber, row.rowNumber)));
    }
    const categoryMappings = reviewedCategoryMappings;
    if (applyExactCategoryMappings) {
      const accountRows = await tx.select().from(accountingAccounts).where(eq(accountingAccounts.companyId, companyId));
      const accountByCode = new Map<string, AccountingAccount>(
        (accountRows as AccountingAccount[]).map((account) => [account.code, account]),
      );
      for (const match of categoryMappings.filter((item: any) => item.status === 'exact' || item.status === 'sentinel')) {
        const account = accountByCode.get(match.accountNumber!);
        if (account) {
          await tx.update(categories).set({ accountingAccountId: account.id }).where(and(
            eq(categories.id, match.categoryId),
            eq(categories.companyId, companyId),
          ));
        }
      }
    }
    const finalAccounts = await tx.select().from(accountingAccounts).where(eq(accountingAccounts.companyId, companyId));
    const summary = {
      ...(session.preview_summary as object),
      totalAccounts: finalAccounts.length,
      exactCategoryMappingsApplied: applyExactCategoryMappings ? categoryMappings.filter((item: any) => item.status === 'exact').length : 0,
      sentinelCategoryMappingsApplied: applyExactCategoryMappings ? categoryMappings.filter((item: any) => item.status === 'sentinel').length : 0,
    };
    const [audit] = await tx.insert(accountingImportAudits).values({
      sessionId,
      companyId,
      actingUserId,
      action: 'confirm',
      sourceFilename: session.source_filename,
      fileHash: session.file_hash,
      headerRow: session.header_row,
      columnMapping: mapping,
      resultSummary: summary,
    }).returning();
    await tx.update(accountingImportSessions).set({
      status: 'confirmed', confirmedBy: actingUserId, confirmedAt: new Date(),
    }).where(and(eq(accountingImportSessions.id, sessionId), eq(accountingImportSessions.companyId, companyId)));
    return { idempotent: false, auditId: audit.id, summary, accounts: finalAccounts, categoryMappings };
  });
}