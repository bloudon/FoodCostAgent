import { db } from "../db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("[Migration] Applying pack geometry columns to vendor_items...");
  await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS canonical_qty_per_purchase_unit double precision`);
  await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS normalized_price_per_canonical_unit double precision`);
  await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS pack_geometry_status text`);
  await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS pack_geometry_source text`);
  await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS pack_geometry_updated_at timestamp`);
  await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS pricing_basis text DEFAULT 'purchase_unit'`);
  await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS is_variable_weight integer DEFAULT 0`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vi_pack_geometry_status_idx ON vendor_items (pack_geometry_status)`);
  console.log("[Migration] Done.");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
