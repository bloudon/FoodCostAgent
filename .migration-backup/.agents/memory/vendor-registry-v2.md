---
name: Vendor Registry v2 migration
description: Key decisions and constraints from the 9-ticket Vendor Registry v2 migration (T0-T8).
---

## Seed gating
- `_migration_log` table (version PK, description, applied_at) is created at startup in server/index.ts
- Block 1 (7 connector-enabled) gated by 'pvr-seed-block1-v1'; Block 2 (134 null-connector) by 'pvr-seed-block2-v1'
- Both blocks use DO NOTHING on conflict — prevents overwriting reviewed data on re-deploy
- VPS v050 pre-records both versions so VPS never re-runs the seeds
- **Why:** Without gating, DO UPDATE was overwriting canonical_name / ordering_mode updates on every VPS deploy.

## Bare ARRAY[] bug (fixed)
- 5 bare `ARRAY[]` without type casts existed in Block 2 VALUES rows
- These were silently non-fatal before because the error was caught
- Fix: replace with `'{}'` (PostgreSQL infers text[] from column definition in INSERT context)

## Column types
- `parent_vendor_id` is `varchar` (NOT uuid) — must match platform_vendor_registry.id which is varchar
- `service_country_codes` / `service_region_codes` are `text[] NOT NULL DEFAULT '{}'`
- `ordering_mode` NOT NULL DEFAULT 'contact_vendor'; `service_scope` NOT NULL DEFAULT 'unknown'
- `visibility` NOT NULL DEFAULT 'public'; `verification_status` NOT NULL DEFAULT 'verified'

## Connector IDs added (T4)
- cut_and_dry, powernet_pnet, food_order_entry — openPortal capability, browser_extension transport
- `openPortal` added to ConnectorCapability union in types.ts

## Geography search (T7)
- /api/vendor-registry/search now accepts ?state=XX (ISO 2-letter state code)
- 4-tier ORDER BY: connector IS NOT NULL → scope quality → region ANY match → name starts-with
- Returns canonicalName, orderingMode, serviceScope in addition to existing fields

## 23 matched + 3 flagged records (T5)
- dot_foods, honor_foods, amcon_distributing → verification_status='needs_review'
- vistar → parent_vendor_id = PFG; cheney brothers → parent_vendor_id = PFG
- Sofo Foods: normalized_name stays 'southern foods' (DB), canonical_name='Sofo Foods'

## vps-migrate.sql versions
- v050: T0 seed gating; v051: T1 columns; v052: T3 alias conflicts
- v053: T5 matched updates; v054: T6 82-row import; v055: T8 classification
- File ends at ~line 2119 (was 1507 before this migration)
