import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  accountingAccounts,
  accountingImportAudits,
  accountingImportRows,
  accountingImportSessions,
  categories,
  companies,
  users,
} from '@workspace/db';
import { db } from '../db';
import { ensureAccountingClassificationSchema } from './accountingClassificationMigration';
import {
  confirmAccountingImport,
  previewAccountingImport,
  readAccountingImportFile,
} from './accountingImport';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = Date.now().toString(36);
const companyId = `coa-dry-run-company-${RUN}`;
const userId = `coa-dry-run-user-${RUN}`;
const auth = { companyId, actingUserId: userId };
const workbookPath = resolve(process.cwd(), '../../attached_assets/Bay_Hill_Chart_of_Accounts_1788010058584.xlsx');
const bayHillCategories = [
  'Alcohol', 'Bar Prep', 'Beer', 'Bottled Beer', 'Bread', 'Canned Beer',
  'Dairy', 'Draft Beer', 'Dry Goods', 'Food', 'Food Prep Item', 'Liquor',
  'Meat', 'No Account', 'Non-Alcoholic Beverages', 'Paper Products',
  'Pastry', 'Poultry', 'Produce', 'Restaurant Supplies', 'Seafood',
  'Soaps & Chemicals', 'TOGO Supplies', 'Uncategorized Food',
  'Vendor Prepared Items', 'Wine',
];

describe.skipIf(SKIP)('chart of accounts import', () => {
  let buffer: Buffer;
  let sessionId: string | null = null;

  beforeAll(async () => {
    await ensureAccountingClassificationSchema();
    buffer = await readFile(workbookPath);
    await db.insert(companies).values({
      id: companyId,
      name: `CoA isolated dry-run ${RUN}`,
      subscriptionPlan: 'enterprise',
    });
    await db.insert(users).values({
      id: userId,
      email: `coa-dry-run-${RUN}@test.local`,
      role: 'company_admin',
      companyId,
      active: 1,
    });
    await db.insert(categories).values(bayHillCategories.map((name, index) => ({
      id: `coa-dry-run-category-${RUN}-${index}`,
      companyId,
      name,
      sortOrder: index,
    })));
  });

  afterAll(async () => {
    if (sessionId) {
      await db.delete(accountingImportAudits).where(eq(accountingImportAudits.sessionId, sessionId));
      await db.delete(accountingImportRows).where(eq(accountingImportRows.sessionId, sessionId));
      await db.delete(accountingImportSessions).where(eq(accountingImportSessions.id, sessionId));
    }
    await db.delete(accountingAccounts).where(eq(accountingAccounts.companyId, companyId));
    await db.delete(categories).where(eq(categories.companyId, companyId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(companies).where(eq(companies.id, companyId));
  });

  it('reads CSV and stops at the first blank row after the account table', () => {
    const parsed = readAccountingImportFile(Buffer.from(
      'title,,\nAccount Number,Account Name,Operational Type\n4000,Food,Food\n,,\nNotes:,not an account,\n',
    ), 'chart.csv', 2);
    expect(parsed.columns).toEqual(['Account Number', 'Account Name', 'Operational Type']);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]?.rawData['Account Number']).toBe('4000');
  });

  it('runs the exact Bay Hill production workbook through preview on development', async () => {
    const preview = await previewAccountingImport({
      buffer,
      filename: 'Bay_Hill_Chart_of_Accounts.xlsx',
      headerRow: 4,
      mapping: {
        accountNumber: 'Account Number',
        accountName: 'Account Name',
        accountType: 'Account Type',
        financialCategory: 'Financial Category',
        operationalType: 'Operational Type',
      },
      auth,
    });
    sessionId = preview.sessionId;
    expect(preview.headerRow).toBe(4);
    expect(preview.summary).toMatchObject({
      createdAccounts: 34,
      sentinelCreated: 1,
      totalAccounts: 35,
      categoriesMappable: 25,
      categoriesTotal: 26,
      operationalTypePopulated: 34,
      rejectedRows: 0,
      categoryBreakdown: { Food: 15, Bar: 11, DOC: 7, Other: 1 },
    });
    expect(preview.categoryMappings.filter(item => item.status === 'sentinel')).toEqual([
      expect.objectContaining({ categoryName: 'No Account', accountNumber: '999900' }),
    ]);
  });

  it('confirms atomically, applies reviewed exact mappings, audits, and retries idempotently', async () => {
    expect(sessionId).toBeTruthy();
    const result = await confirmAccountingImport(sessionId!, true, auth);
    expect(result.idempotent).toBe(false);
    expect(result.summary).toMatchObject({
      totalAccounts: 35,
      exactCategoryMappingsApplied: 25,
      sentinelCategoryMappingsApplied: 1,
    });
    const accounts = await db.select().from(accountingAccounts).where(eq(accountingAccounts.companyId, companyId));
    expect(accounts).toHaveLength(35);
    expect(accounts.filter(account => account.code === '999900')).toHaveLength(1);
    expect(accounts.filter(account => account.code !== '999900' && account.operationalType)).toHaveLength(34);
    const linked = await db.select().from(categories).where(and(
      eq(categories.companyId, companyId),
    ));
    expect(linked.filter(category => category.accountingAccountId)).toHaveLength(26);
    const [audit] = await db.select().from(accountingImportAudits).where(eq(accountingImportAudits.sessionId, sessionId!));
    expect(audit).toMatchObject({
      companyId,
      actingUserId: userId,
      sourceFilename: 'Bay_Hill_Chart_of_Accounts.xlsx',
      headerRow: 4,
      action: 'confirm',
    });
    expect(audit?.fileHash).toMatch(/^[a-f0-9]{64}$/);
    const retry = await confirmAccountingImport(sessionId!, true, auth);
    expect(retry.idempotent).toBe(true);
    expect(retry.auditId).toBe(audit?.id);
  });
});