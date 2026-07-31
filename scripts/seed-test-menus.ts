import { neon } from "@neondatabase/serverless";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";
import { randomUUID } from "crypto";

neonConfig.webSocketConstructor = ws;
const uid = () => randomUUID();

(async () => {
  const sql = neon(process.env.DATABASE_URL!);

  const companyId  = "ad95ecda-74a9-49d7-833b-6d7d2f48efd1";
  const storeA     = "2765a568-d72f-46ab-b2f1-5b4f7fc31f5b"; // Store A
  const storeB     = "2c9272ed-8ccc-45f7-ab81-45504a87b7cb"; // Store B
  const margherita = "ci-menu-brians-001";
  const pepperoni  = "47282407-0649-48db-b94c-a79ba9172e43";
  const caesar     = "8ba3609b-49cc-4a6f-b5aa-2f212c28fe30";
  const greek      = "551fe293-ca37-483a-a9dc-69d5f294db48";
  const burgerLg   = "38d47fc1-44d3-48f3-a3fd-7c07e3869761";
  const burgerSm   = "6bf41c25-7965-488a-bd69-5daeab018c04";

  // Idempotent — remove previous runs
  await sql`DELETE FROM menus WHERE company_id = ${companyId}
    AND name IN ('Brunch Menu','Holiday Thanksgiving Menu')`;

  // ── 1. Brunch Menu — draft ─────────────────────────────────────────────────
  const brunchId   = uid();
  const brunchSec1 = uid();
  const brunchSec2 = uid();

  await sql`INSERT INTO menus (id,company_id,name,menu_type,status,description,created_by,updated_by)
    VALUES (${brunchId},${companyId},'Brunch Menu','brunch','draft',
      'Weekend brunch — small plates and pizza by the slice.','system','system')`;

  await sql`INSERT INTO menu_sections (id,menu_id,company_id,name,display_order) VALUES
    (${brunchSec1},${brunchId},${companyId},'Starters',0),
    (${brunchSec2},${brunchId},${companyId},'Mains',1)`;

  await sql`INSERT INTO menu_entries
    (id,menu_id,menu_section_id,menu_item_id,company_id,display_order,price) VALUES
    (${uid()},${brunchId},${brunchSec1},${caesar},    ${companyId},0,12.99),
    (${uid()},${brunchId},${brunchSec1},${greek},     ${companyId},1,11.99),
    (${uid()},${brunchId},${brunchSec2},${margherita},${companyId},0,null),
    (${uid()},${brunchId},${brunchSec2},${pepperoni}, ${companyId},1,null)`;

  await sql`INSERT INTO menu_location_assignments (id,menu_id,store_id,company_id)
    VALUES (${uid()},${brunchId},${storeA},${companyId})`;

  console.log("✅  Brunch Menu (draft)");
  console.log("    2 sections (Starters, Mains) · 4 items · 2 priced · Store A");

  // ── 2. Holiday Thanksgiving — scheduled (future Nov 20–28 2026) ───────────
  const thanksId  = uid();
  const thanksSec = uid();

  await sql`INSERT INTO menus
    (id,company_id,name,menu_type,status,description,
     effective_start,effective_end,created_by,updated_by)
    VALUES (${thanksId},${companyId},'Holiday Thanksgiving Menu','event','scheduled',
      'Thanksgiving prix-fixe — Nov 20–28 across both locations.',
      '2026-11-20','2026-11-28','system','system')`;

  await sql`INSERT INTO menu_sections (id,menu_id,company_id,name,display_order)
    VALUES (${thanksSec},${thanksId},${companyId},'Thanksgiving Specials',0)`;

  await sql`INSERT INTO menu_entries
    (id,menu_id,menu_section_id,menu_item_id,company_id,display_order,price) VALUES
    (${uid()},${thanksId},${thanksSec},${burgerLg},${companyId},0,24.99),
    (${uid()},${thanksId},${thanksSec},${burgerSm},${companyId},1,18.99),
    (${uid()},${thanksId},${thanksSec},${caesar},  ${companyId},2,null)`;

  await sql`INSERT INTO menu_location_assignments (id,menu_id,store_id,company_id) VALUES
    (${uid()},${thanksId},${storeA},${companyId}),
    (${uid()},${thanksId},${storeB},${companyId})`;

  console.log("✅  Holiday Thanksgiving Menu (scheduled)");
  console.log("    1 section (Thanksgiving Specials) · 3 items · 2 priced · Store A + Store B · Nov 20–28 2026");

  // ── Stat verification — same subqueries as getMenusWithStats ───────────────
  const rows = await sql`
    SELECT
      m.name,
      m.status                                                                       AS db_status,
      CASE
        WHEN m.status = 'retired'                                                    THEN 'archived'
        WHEN m.effective_end IS NOT NULL
             AND m.effective_end < NOW()
             AND m.status <> 'live'                                                  THEN 'expired'
        WHEN m.status = 'scheduled'
             AND m.effective_start IS NOT NULL
             AND m.effective_start > NOW()                                           THEN 'scheduled'
        WHEN m.status = 'scheduled'                                                  THEN 'live'
        ELSE m.status
      END                                                                            AS effective_status,
      (SELECT COUNT(*)::int FROM menu_entries   WHERE menu_id = m.id)               AS item_count,
      (SELECT COUNT(*)::int FROM menu_entries   WHERE menu_id = m.id AND price > 0) AS priced_items,
      (SELECT COUNT(*)::int FROM menu_entries   WHERE menu_id = m.id
                                                  AND (price IS NULL OR price = 0)) AS unpriced_items,
      (SELECT COUNT(DISTINCT ms.id)::int FROM menu_sections ms
        WHERE ms.menu_id = m.id
          AND EXISTS (SELECT 1 FROM menu_entries e
                       WHERE e.menu_id = m.id AND e.menu_section_id = ms.id))       AS section_count,
      (SELECT COUNT(*)::int FROM menu_sections  WHERE menu_id = m.id)               AS total_sections,
      (SELECT COUNT(*)::int FROM menu_location_assignments WHERE menu_id = m.id)    AS location_count,
      (SELECT COALESCE(array_agg(cs.name ORDER BY cs.name), ARRAY[]::text[])
         FROM menu_location_assignments mla
         JOIN company_stores cs ON cs.id = mla.store_id
        WHERE mla.menu_id = m.id AND cs.status = 'active')                         AS location_names
    FROM menus m
    WHERE m.id IN (${brunchId},${thanksId})
    ORDER BY m.name`;

  console.log("\n📊  Dashboard stat verification (mirrors API query):\n");
  for (const r of rows) {
    const locs  = (r.location_names as string[]).join(", ") || "—";
    const attn: string[] = [];
    const ic = Number(r.item_count);
    const sc = Number(r.section_count);
    const pi = Number(r.priced_items);
    const es = String(r.effective_status);
    if (ic    === 0)              attn.push("no items");
    if (sc    === 0)              attn.push("no non-empty sections");
    if (es === "live" && pi < ic) attn.push(`${r.unpriced_items} unpriced while live`);
    if (es === "scheduled" && (ic === 0 || sc === 0)) attn.push("scheduled but incomplete");

    console.log(`  ${r.name}`);
    console.log(`    db_status:        ${r.db_status}`);
    console.log(`    effective_status: ${r.effective_status}`);
    console.log(`    items:            ${r.item_count}  (${r.priced_items} priced · ${r.unpriced_items} unpriced)`);
    console.log(`    sections:         ${r.section_count} non-empty / ${r.total_sections} total`);
    console.log(`    locations (${r.location_count}):    ${locs}`);
    console.log(`    needs_attention:  ${attn.length ? "⚠️  " + attn.join(", ") : "✅  none"}`);
    console.log();
  }

  // ── Location filter smoke test (global-menu semantics) ────────────────────
  console.log("🔍  Location filter smoke test:");
  console.log("    Brunch (location_count=1, storeA) should appear when filtering by Store A →",
    Number(rows.find(r => r.name === "Brunch Menu")!.location_count) > 0 ? "✅" : "❌");
  console.log("    Thanksgiving (location_count=2) should appear when filtering by Store B →",
    (rows.find(r => r.name === "Holiday Thanksgiving Menu")!.location_names as string[])
      .includes("Store B") ? "✅" : "❌");
})().catch(console.error);
