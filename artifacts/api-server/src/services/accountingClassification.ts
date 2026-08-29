import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  accountingAccounts,
  categories,
  inventoryItems,
} from '@workspace/db';
import { db } from '../db';
import { storage } from '../storage';
import { hasCompanyAccess } from '../permissions';

export const UNASSIGNED_ACCOUNTING_LABEL = 'Unassigned / review required';

const accountInputSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  accountType: z.string().trim().min(1).nullable().optional(),
  financialCategory: z.string().trim().min(1).nullable().optional(),
  operationalType: z.string().trim().min(1).nullable().optional(),
  isActive: z.union([z.literal(0), z.literal(1)]).optional(),
});

const accountUpdateSchema = accountInputSchema.partial();

export class AccountingClassificationError extends Error {
  constructor(
    public readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_REQUEST' | 'CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'AccountingClassificationError';
  }
}

export interface AccountingAuthorization {
  actingUserId: string;
  companyId: string;
}

async function resolveAuthorization(auth: AccountingAuthorization | null | undefined) {
  if (!auth?.actingUserId?.trim() || !auth.companyId?.trim()) {
    throw new AccountingClassificationError('UNAUTHENTICATED', 'An acting user and company context are required.');
  }
  const user = await storage.getUser(auth.actingUserId.trim());
  if (!user || user.active !== 1) {
    throw new AccountingClassificationError('UNAUTHENTICATED', 'The acting user could not be verified.');
  }
  if (!hasCompanyAccess(user, auth.companyId)) {
    throw new AccountingClassificationError('FORBIDDEN', 'You are not authorized for this company.');
  }
  return { user, companyId: auth.companyId };
}

async function getAccountForCompany(companyId: string, accountId: string, activeOnly = false) {
  const [account] = await db.select().from(accountingAccounts).where(and(
    eq(accountingAccounts.id, accountId),
    eq(accountingAccounts.companyId, companyId),
    ...(activeOnly ? [eq(accountingAccounts.isActive, 1)] : []),
  )).limit(1);
  return account ?? null;
}

async function assertAccountAvailable(companyId: string, accountId: string | null) {
  if (accountId === null) return null;
  const account = await getAccountForCompany(companyId, accountId, true);
  if (!account) {
    throw new AccountingClassificationError(
      'INVALID_REQUEST',
      'The accounting account must belong to the company and be active.',
    );
  }
  return account;
}

export async function listAccountingAccounts(
  auth: AccountingAuthorization | null | undefined,
  includeInactive = false,
) {
  const { companyId } = await resolveAuthorization(auth);
  return db.select().from(accountingAccounts).where(and(
    eq(accountingAccounts.companyId, companyId),
    ...(includeInactive ? [] : [eq(accountingAccounts.isActive, 1)]),
  ));
}

export async function createAccountingAccount(
  input: unknown,
  auth: AccountingAuthorization | null | undefined,
) {
  const { companyId } = await resolveAuthorization(auth);
  const parsed = accountInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AccountingClassificationError('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid accounting account.');
  }
  const data = parsed.data;
  const [existing] = await db.select({ id: accountingAccounts.id }).from(accountingAccounts).where(and(
    eq(accountingAccounts.companyId, companyId),
    eq(accountingAccounts.code, data.code),
  )).limit(1);
  if (existing) {
    throw new AccountingClassificationError('CONFLICT', `Account code "${data.code}" already exists.`);
  }
  const [account] = await db.insert(accountingAccounts).values({
    companyId,
    code: data.code,
    name: data.name,
    accountType: data.accountType ?? null,
    financialCategory: data.financialCategory ?? null,
    operationalType: data.operationalType ?? null,
    isActive: data.isActive ?? 1,
  }).returning();
  return account;
}

export async function updateAccountingAccount(
  accountId: string,
  input: unknown,
  auth: AccountingAuthorization | null | undefined,
) {
  const { companyId } = await resolveAuthorization(auth);
  const parsed = accountUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new AccountingClassificationError('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid accounting account update.');
  }
  const existing = await getAccountForCompany(companyId, accountId);
  if (!existing) throw new AccountingClassificationError('NOT_FOUND', 'Accounting account not found.');
  const data = parsed.data;
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db.select({ id: accountingAccounts.id }).from(accountingAccounts).where(and(
      eq(accountingAccounts.companyId, companyId),
      eq(accountingAccounts.code, data.code),
    )).limit(1);
    if (duplicate) throw new AccountingClassificationError('CONFLICT', `Account code "${data.code}" already exists.`);
  }
  const [account] = await db.update(accountingAccounts).set({
    ...(data.code !== undefined ? { code: data.code } : {}),
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.accountType !== undefined ? { accountType: data.accountType } : {}),
    ...(data.financialCategory !== undefined ? { financialCategory: data.financialCategory } : {}),
    ...(data.operationalType !== undefined ? { operationalType: data.operationalType } : {}),
    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    updatedAt: new Date(),
  }).where(and(
    eq(accountingAccounts.id, accountId),
    eq(accountingAccounts.companyId, companyId),
  )).returning();
  return account;
}

export async function setCategoryAccountingDefault(
  categoryId: string,
  accountId: string | null,
  auth: AccountingAuthorization | null | undefined,
) {
  const { companyId } = await resolveAuthorization(auth);
  const [category] = await db.select().from(categories).where(and(
    eq(categories.id, categoryId),
    eq(categories.companyId, companyId),
  )).limit(1);
  if (!category) throw new AccountingClassificationError('NOT_FOUND', 'Category not found.');
  await assertAccountAvailable(companyId, accountId);
  const [updated] = await db.update(categories).set({ accountingAccountId: accountId }).where(and(
    eq(categories.id, categoryId),
    eq(categories.companyId, companyId),
  )).returning();
  return updated;
}

export async function setInventoryItemAccountingOverride(
  inventoryItemId: string,
  accountId: string | null,
  auth: AccountingAuthorization | null | undefined,
) {
  const { companyId } = await resolveAuthorization(auth);
  const [item] = await db.select().from(inventoryItems).where(and(
    eq(inventoryItems.id, inventoryItemId),
    eq(inventoryItems.companyId, companyId),
  )).limit(1);
  if (!item) throw new AccountingClassificationError('NOT_FOUND', 'Inventory item not found.');
  await assertAccountAvailable(companyId, accountId);
  const [updated] = await db.update(inventoryItems).set({ accountingAccountId: accountId }).where(and(
    eq(inventoryItems.id, inventoryItemId),
    eq(inventoryItems.companyId, companyId),
  )).returning();
  return updated;
}

export async function resolveCurrentAccountingClassification(companyId: string, inventoryItemId: string) {
  const [item] = await db.select().from(inventoryItems).where(and(
    eq(inventoryItems.id, inventoryItemId),
    eq(inventoryItems.companyId, companyId),
  )).limit(1);
  if (!item) throw new AccountingClassificationError('NOT_FOUND', 'Inventory item not found.');

  if (item.accountingAccountId) {
    const itemAccount = await getAccountForCompany(companyId, item.accountingAccountId, true);
    if (itemAccount) {
      if (itemAccount.code === '999900') {
        return {
          inventoryItemId,
          companyId,
          source: 'unassigned' as const,
          status: 'unresolved' as const,
          label: UNASSIGNED_ACCOUNTING_LABEL,
          account: itemAccount,
        };
      }
      return {
        inventoryItemId,
        companyId,
        source: 'item_override' as const,
        status: 'resolved' as const,
        account: itemAccount,
      };
    }
  }

  if (item.categoryId) {
    const [category] = await db.select({
      id: categories.id,
      accountingAccountId: categories.accountingAccountId,
    }).from(categories).where(and(
      eq(categories.id, item.categoryId),
      eq(categories.companyId, companyId),
    )).limit(1);
    if (category?.accountingAccountId) {
      const categoryAccount = await getAccountForCompany(companyId, category.accountingAccountId, true);
      if (categoryAccount) {
        if (categoryAccount.code === '999900') {
          return {
            inventoryItemId,
            companyId,
            source: 'unassigned' as const,
            status: 'unresolved' as const,
            label: UNASSIGNED_ACCOUNTING_LABEL,
            account: categoryAccount,
          };
        }
        return {
          inventoryItemId,
          companyId,
          source: 'category_default' as const,
          status: 'resolved' as const,
          account: categoryAccount,
        };
      }
    }
  }

  return {
    inventoryItemId,
    companyId,
    source: 'unassigned' as const,
    status: 'unresolved' as const,
    label: UNASSIGNED_ACCOUNTING_LABEL,
    account: null,
  };
}

export async function getCurrentAccountingClassification(
  inventoryItemId: string,
  auth: AccountingAuthorization | null | undefined,
) {
  const { companyId } = await resolveAuthorization(auth);
  return resolveCurrentAccountingClassification(companyId, inventoryItemId);
}