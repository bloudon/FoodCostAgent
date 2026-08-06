-- Add target_store_id to inventory_import_batches
-- Tracks which company store an Orderly import is intended for.
-- Nullable: backfill not required for existing batches.
ALTER TABLE "inventory_import_batches"
  ADD COLUMN IF NOT EXISTS "target_store_id" varchar;
