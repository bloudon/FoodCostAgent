import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  accountingAccounts,
  categories,
  companies,
  historicalInvoiceImportBatches,
  historicalInvoiceLines,
  historicalInvoices,
  inventoryItems,
  units,
  users,
} from '@workspace/db';
import { db } from '../db';
import {
  AccountingClassificationError,
  createAccountingAccount,
  getCurrentAccountingClassification,
  resolveCurrentAccountingClassification,
  setCategoryAccountingDefault,
  setInventoryItemAccountingOverride,
  updateAccountingAccount,
} from './accountingClassification';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = Date.now().toString(36);
const ID = {
  companyA: `acct-co-a-${RUN}`,
  companyB: `acct-co-b-${RUN}`,
  userA: `acct-user-a-${RUN}`,
  userB: `acct-user-b-${RUN}`,
  categoryA: `acct-cat-a-${RUN}`,
  categoryB: `acct-cat-b-${RUN}`,
  unitA: `acct-unit-a-${RUN}`,
  itemA: `acct-item-a-${RUN}`,
  itemUnassigned: `acct-item-unassigned-${RUN}`,
  itemB: `acct-item-b-${RUN}`,
  historicalBatch: `acct-batch-${RUN}`,
  historicalInvoice: `acct-invoice-${RUN}`,
  historicalLine: `acct-line-${RUN}`,
};

const AUTH_A = { actingUserId: ID.userA, companyId: ID.companyA };
const AUTH_B = { actingUserId: ID.userB, companyId: ID.companyB };

describe.skipIf(SKIP)('accounting classification foundation', () => {
  let categoryAccountId: string;
  let itemAccountId: string;
  let inactiveAccountId: string;

  beforeAll(async () => {
    await db.insert(companies).values([
      { id: ID.companyA, name: `Accounting Co A ${RUN}` },
      { id: ID.companyB, name: `Accounting Co B ${RUN}` },
    ]);
    await db.insert(users).values([
      { id: ID.userA, email: `acct-a-${RUN}@test.local`, role: 'company_admin', companyId: ID.companyA, active: 1 },
      { id: ID.userB, email: `acct-b-${RUN}@test.local`, role: 'company_admin', companyId: ID.companyB, active: 1 },
    ]);
    await db.insert(units).values({
      id: ID.unitA,
      name: `accounting-unit-${RUN}`,
      abbreviation: 'EA',
      kind: 'count',
      toBaseRatio: 1,
      system: 'both',
    });
    await db.insert(categories).values([
      { id: ID.categoryA, companyId: ID.companyA, name: `Accounting Category A ${RUN}` },
      { id: ID.categoryB, companyId: ID.companyB, name: `Accounting Category B ${RUN}` },
    ]);
    await db.insert(inventoryItems).values([
      { id: ID.itemA, companyId: ID.companyA, name: `Accounting Item A ${RUN}`, categoryId: ID.categoryA, unitId: ID.unitA },
      { id: ID.itemUnassigned, companyId: ID.companyA, name: `Unassigned Item ${RUN}`, unitId: ID.unitA },
      { id: ID.itemB, companyId: ID.companyB, name: `Accounting Item B ${RUN}`, categoryId: ID.categoryB, unitId: ID.unitA },
    ]);

    const categoryAccount = await createAccountingAccount({
      code: `5000-${RUN}`,
      name: 'Food Cost',
      accountType: 'cost_of_goods_sold',
    }, AUTH_A);
    categoryAccountId = categoryAccount.id;
    const itemAccount = await createAccountingAccount({
      code: `5010-${RUN}`,
      name: 'Specialty Food Cost',
      accountType: 'cost_of_goods_sold',
    }, AUTH_A);
    itemAccountId = itemAccount.id;
    const inactiveAccount = await createAccountingAccount({
      code: `5999-${RUN}`,
      name: 'Retired Food Cost',
    }, AUTH_A);
    inactiveAccountId = inactiveAccount.id;
    await createAccountingAccount({
      code: `5000-${RUN}`,
      name: 'Other Company Account',
    }, AUTH_B);

    await db.insert(historicalInvoiceImportBatches).values({
      id: ID.historicalBatch,
      companyId: ID.companyA,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: '24472',
      sourcePropertyBindingId: `binding-${RUN}`,
      destinationStoreId: `store-${RUN}`,
      cutoverDate: '2026-08-13',
      windowStart: '2025-08-01',
      windowEnd: '2026-07-31',
      payloadHash: `hash-${RUN}`,
      importedBy: ID.userA,
    });
    await db.insert(historicalInvoices).values({
      id: ID.historicalInvoice,
      companyId: ID.companyA,
      storeId: `store-${RUN}`,
      importBatchId: ID.historicalBatch,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: '24472',
      sourceInvoiceId: `source-invoice-${RUN}`,
      invoiceDate: '2026-03-04',
      invoicePeriod: '2026-03',
      sourceSnapshot: { source: 'retained' },
      materialHash: `invoice-hash-${RUN}`,
    });
    await db.insert(historicalInvoiceLines).values({
      id: ID.historicalLine,
      companyId: ID.companyA,
      invoiceId: ID.historicalInvoice,
      sourceLineId: `source-line-${RUN}`,
      resolutionStatus: 'unresolved',
      packSnapshot: {},
      catchWeightSnapshot: {},
      glSnapshot: { glCode: 'ORDERLY-5010', glName: 'Historical Dairy' },
      financialSnapshot: {},
      sourceSnapshot: { source: 'retained' },
      materialHash: `line-hash-${RUN}`,
    });
  });

  afterAll(async () => {
    await db.delete(historicalInvoiceLines).where(inArray(historicalInvoiceLines.companyId, [ID.companyA, ID.companyB])).catch(() => {});
    await db.delete(historicalInvoices).where(inArray(historicalInvoices.companyId, [ID.companyA, ID.companyB])).catch(() => {});
    await db.delete(historicalInvoiceImportBatches).where(inArray(historicalInvoiceImportBatches.companyId, [ID.companyA, ID.companyB])).catch(() => {});
    await db.delete(inventoryItems).where(inArray(inventoryItems.companyId, [ID.companyA, ID.companyB])).catch(() => {});
    await db.delete(categories).where(inArray(categories.companyId, [ID.companyA, ID.companyB])).catch(() => {});
    await db.delete(accountingAccounts).where(inArray(accountingAccounts.companyId, [ID.companyA, ID.companyB])).catch(() => {});
    await db.delete(units).where(eq(units.id, ID.unitA)).catch(() => {});
    await db.delete(users).where(inArray(users.id, [ID.userA, ID.userB])).catch(() => {});
    await db.delete(companies).where(inArray(companies.id, [ID.companyA, ID.companyB])).catch(() => {});
  });

  it('resolves a company category default and gives item overrides precedence', async () => {
    await setCategoryAccountingDefault(ID.categoryA, categoryAccountId, AUTH_A);
    expect((await resolveCurrentAccountingClassification(ID.companyA, ID.itemA)).source).toBe('category_default');

    await setInventoryItemAccountingOverride(ID.itemA, itemAccountId, AUTH_A);
    const resolved = await resolveCurrentAccountingClassification(ID.companyA, ID.itemA);
    expect(resolved.source).toBe('item_override');
    expect(resolved.account?.id).toBe(itemAccountId);

    await setInventoryItemAccountingOverride(ID.itemA, null, AUTH_A);
    expect((await resolveCurrentAccountingClassification(ID.companyA, ID.itemA)).source).toBe('category_default');
  });

  it('enforces company isolation for accounts and mappings', async () => {
    await expect(setCategoryAccountingDefault(ID.categoryA, categoryAccountId, AUTH_B))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const otherCompanyAccount = await createAccountingAccount({
      code: `5020-${RUN}`,
      name: 'Company B Food Cost',
    }, AUTH_B);
    await expect(setCategoryAccountingDefault(ID.categoryA, otherCompanyAccount.id, AUTH_A))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(getCurrentAccountingClassification(ID.itemB, AUTH_A))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects inactive mappings and reports unresolved items without blocking operations', async () => {
    await setCategoryAccountingDefault(ID.categoryA, categoryAccountId, AUTH_A);
    await updateAccountingAccount(inactiveAccountId, { isActive: 0 }, AUTH_A);
    await expect(setInventoryItemAccountingOverride(ID.itemA, inactiveAccountId, AUTH_A))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    const resolvedAfterDeactivation = await resolveCurrentAccountingClassification(ID.companyA, ID.itemA);
    expect(resolvedAfterDeactivation.source).toBe('category_default');

    await updateAccountingAccount(categoryAccountId, { isActive: 0 }, AUTH_A);
    const unresolved = await resolveCurrentAccountingClassification(ID.companyA, ID.itemA);
    expect(unresolved.status).toBe('unresolved');
    expect(unresolved.label).toBe('Unassigned / review required');
    expect((await resolveCurrentAccountingClassification(ID.companyA, ID.itemUnassigned)).status).toBe('unresolved');
  });

  it('does not mutate retained historical GL evidence when current mappings change', async () => {
    const before = await db.select({ glSnapshot: historicalInvoiceLines.glSnapshot }).from(historicalInvoiceLines).where(eq(
      historicalInvoiceLines.id,
      ID.historicalLine,
    ));
    await setCategoryAccountingDefault(ID.categoryA, itemAccountId, AUTH_A);
    await setInventoryItemAccountingOverride(ID.itemA, itemAccountId, AUTH_A);
    const after = await db.select({ glSnapshot: historicalInvoiceLines.glSnapshot }).from(historicalInvoiceLines).where(eq(
      historicalInvoiceLines.id,
      ID.historicalLine,
    ));
    expect(after[0]?.glSnapshot).toEqual(before[0]?.glSnapshot);
  });

  it('requires an active user with company-wide authorization', async () => {
    await expect(createAccountingAccount({ code: 'x', name: 'x' }, {
      actingUserId: 'missing-user',
      companyId: ID.companyA,
    })).rejects.toBeInstanceOf(AccountingClassificationError);
  });
});