import { sql } from 'drizzle-orm';
import { db } from '../db';

/**
 * Ensure current accounting configuration exists before any schema-based
 * startup work (including seeding) queries categories or inventory items.
 * Historical invoice evidence is deliberately not part of this migration.
 */
export async function ensureAccountingClassificationSchema() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS accounting_accounts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      account_type TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, code)
    );
    CREATE INDEX IF NOT EXISTS accounting_accounts_company_active_idx
      ON accounting_accounts(company_id, is_active);
    ALTER TABLE categories
      ADD COLUMN IF NOT EXISTS accounting_account_id VARCHAR;
    ALTER TABLE inventory_items
      ADD COLUMN IF NOT EXISTS accounting_account_id VARCHAR;
    CREATE INDEX IF NOT EXISTS categories_accounting_account_idx
      ON categories(company_id, accounting_account_id);
    CREATE INDEX IF NOT EXISTS inventory_items_accounting_account_idx
      ON inventory_items(company_id, accounting_account_id);
  `);
}