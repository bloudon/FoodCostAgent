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
    ALTER TABLE accounting_accounts
      ADD COLUMN IF NOT EXISTS financial_category TEXT;
    ALTER TABLE accounting_accounts
      ADD COLUMN IF NOT EXISTS operational_type TEXT;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_accounts_account_type_check') THEN
        ALTER TABLE accounting_accounts ADD CONSTRAINT accounting_accounts_account_type_check
          CHECK (account_type IS NULL OR account_type IN ('Revenue', 'Expense')) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_accounts_financial_category_check') THEN
        ALTER TABLE accounting_accounts ADD CONSTRAINT accounting_accounts_financial_category_check
          CHECK (financial_category IS NULL OR financial_category IN ('Sales', 'COGS', 'Other Expense')) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_accounts_operational_type_check') THEN
        ALTER TABLE accounting_accounts ADD CONSTRAINT accounting_accounts_operational_type_check
          CHECK (operational_type IS NULL OR operational_type IN ('Food', 'Bar', 'Direct Operating Cost', 'Other')) NOT VALID;
      END IF;
    END $$;
    ALTER TABLE categories
      ADD COLUMN IF NOT EXISTS accounting_account_id VARCHAR;
    ALTER TABLE inventory_items
      ADD COLUMN IF NOT EXISTS accounting_account_id VARCHAR;
    CREATE TABLE IF NOT EXISTS accounting_import_sessions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      source_filename TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      uploaded_by VARCHAR NOT NULL,
      header_row INTEGER NOT NULL,
      sheet_name TEXT,
      column_mapping JSONB NOT NULL,
      preview_summary JSONB NOT NULL,
      preview_plan_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'previewed',
      confirmed_by VARCHAR,
      confirmed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS accounting_import_sessions_company_created_idx
      ON accounting_import_sessions(company_id, created_at);
    CREATE INDEX IF NOT EXISTS accounting_import_sessions_company_file_idx
      ON accounting_import_sessions(company_id, file_hash);
    CREATE TABLE IF NOT EXISTS accounting_import_rows (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id VARCHAR NOT NULL,
      row_number INTEGER NOT NULL,
      raw_data JSONB NOT NULL,
      account_number TEXT,
      account_name TEXT,
      account_type TEXT,
      financial_category TEXT,
      operational_type TEXT,
      preview_outcome TEXT NOT NULL,
      preview_reason TEXT,
      result_outcome TEXT,
      result_reason TEXT,
      UNIQUE(session_id, row_number)
    );
    CREATE INDEX IF NOT EXISTS accounting_import_rows_session_idx
      ON accounting_import_rows(session_id);
    CREATE TABLE IF NOT EXISTS accounting_import_audits (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id VARCHAR NOT NULL,
      company_id VARCHAR NOT NULL,
      acting_user_id VARCHAR NOT NULL,
      action TEXT NOT NULL,
      source_filename TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      header_row INTEGER NOT NULL,
      column_mapping JSONB NOT NULL,
      result_summary JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS accounting_import_audits_company_created_idx
      ON accounting_import_audits(company_id, created_at);
    CREATE INDEX IF NOT EXISTS accounting_import_audits_session_idx
      ON accounting_import_audits(session_id);
    CREATE INDEX IF NOT EXISTS categories_accounting_account_idx
      ON categories(company_id, accounting_account_id);
    CREATE INDEX IF NOT EXISTS inventory_items_accounting_account_idx
      ON inventory_items(company_id, accounting_account_id);
  `);
}