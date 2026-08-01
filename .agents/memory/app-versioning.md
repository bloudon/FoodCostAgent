---
name: App versioning & migration state
description: Current app version, CHANGELOG history, schema migration tags, patch-versioning convention, and how the version/migration system works.
---

# App Versioning & Migration State

## Current state (as of 2026-08-01)

- **App version**: `1.12.1` (set in `package.json:3`; imported as `APP_VERSION` in `server/routes.ts:6`)
- **CHANGELOG**: exists at `CHANGELOG.md`; documented from `1.5.0` (2025-04-01) through `1.12.1` (2026-08-01).

---

## Versioning convention (established 2026-08-01)

**Always use 3-part semver: `MAJOR.MINOR.PATCH`**

- **PATCH** (`1.12.x`) — bump after every batch of shipped work in a session, even small changes. Do not wait for a "big release".
- **MINOR** (`1.x.0`) — bump when a meaningful new capability ships (new page, new integration, major workflow change).
- **MAJOR** — reserved for architecture breaks.

**Rule:** Every session that ships code should end with a version bump + CHANGELOG entry. Do not accumulate work across multiple sessions without bumping.

---

## Version history summary

| Version | Date | Headline |
|---------|------|----------|
| 1.5.0 | 2025-04-01 | Sub-entry count history, nested recipe costing, prep chart recipe links, onboarding wizard |
| 1.6.0 | 2025-05-23 | Menu item variant costing, prep-style links, formal x.x.x versioning scheme, "What's New" panel |
| 1.7.0 | 2026-05-24 | Compound pack-size parsing ("6/5 LB"), EA auto-derivation, QuickBooks to Settings |
| 1.8.0 | 2026-05-27 | Unit-aware case price math, unit-override selector on review screen, deriveUnitPrice refactor |
| 1.9.0 | 2026-05-28 | Name-count hint system (amber inline hints, suspicious ratio banner), 60+ new unit tests, Playwright Firefox |
| 1.10.0 | 2026-07-10 | PFS & SOFO connectors, detectConnectorFromVendorName, Drizzle ANY() batch bug fix |
| 1.11.0 | 2026-07-24 | Operating console dashboard, overdue PO alerts, stale-price warnings, route consolidation, PRICE_MAINTENANCE_ALERT_DAYS constant |
| 1.12.0 | 2026-07-30 | Global search (10 entity types), GA4 analytics, marketing page translations (Spanish), Orderly snapshot → count session import, vendor pack geometry normalization |
| 1.12.1 | 2026-08-01 | Recipe builder compact layout, account & locations overview (/choose-plan rewrite), plan-catalog.ts, Stripe billing alignment, feature gate refactor, Get Operational card streamlined, security lockfile scrub |

**How to bump the version**: update `package.json` `"version"` and add the matching entry to `CHANGELOG.md`.

---

## Schema migration system

Two separate tracking tables exist — both run idempotently at startup in `server/index.ts`:

### `_migration_log` (version-keyed, for seed gating)
```sql
CREATE TABLE IF NOT EXISTS _migration_log (
  version     text        PRIMARY KEY,
  description text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
)
```
Currently used to gate the vendor-registry v2 seed: checks for `pvr-mvp-seed-v1` before inserting the 82 distributor rows (`server/index.ts:417,716-718`).

### `_migrations` (name-keyed, for legacy named migrations)
Used by `server/routes.ts` for older one-off migrations: `tier_system_init`, `vendor_receive_by_unit`, etc. Schema: `name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW()`.

### Numbered migration blocks (`vNNN` tags in `server/index.ts`)
All startup migrations run via raw `db.execute(sql\`...\`)` — no ORM migration runner. Only two explicit `vNNN` tags exist:

| Tag | Location | Description |
|-----|----------|-------------|
| v064 | `server/index.ts:763` | Browser-extension price sync: `vendor_items.price_transport`, 7 `order_guides` columns, `extension_pairing_codes`, `extension_tokens`, `extension_sync_jobs`, `extension_ingestion_batches` tables |
| v065 | `server/index.ts:858` | Extension capture completeness: `capture_warning` on `extension_sync_jobs`; `paginated_pages`, `expected_row_count`, `visible_row_count`, `captured_row_count`, `capture_warning` on `extension_ingestion_batches` |

Earlier migrations (v001–v063) are not visible as tagged blocks; the numbering likely existed in an earlier codebase era. The comment at `server/index.ts:987` references a "v066 migration above" for `primary_sales_method` but no actual `// v066` block exists — it appears the label was dropped during editing.

### Task-labeled migrations (post-v065)
These are `// Task #NNN` comments on individual `ALTER TABLE` / `CREATE TABLE` statements, with no vNNN tag:

| Task | Change |
|------|--------|
| #540 | `pos_connections.token_key_version` integer (AES encryption versioning) |
| #541 | `pos_connections.token_refreshed_at` |
| #542 | Partial unique index `pos_sync_jobs_one_running_per_connection` |
| #543 | `daily_menu_item_sales`: `connection_id`, `external_order_id`, `external_line_item_id`; partial unique indexes for POS vs CSV idempotency |
| #544 | `pos_location_mappings.external_timezone` |
| #546 | `pos_sync_jobs.adhoc_items jsonb` |
| #612 | `companies.primary_sales_method text CHECK(...)` + unique index `pos_connections_one_active_per_company` |
| #632 | `pos_item_mappings.ignored integer` |
| #635 | `menus`, `menu_sections`, `menu_entries` tables + Main Menu seed |
| #679 | Orderly snapshot import infrastructure |
| #724 | `vendor_items`: 7 pack-geometry columns |
| #808 | `companies.subscriptionPlan`, `billingInterval` columns; backfill existing companies to `'platform'` |

---

## How to add a new migration

1. Add `// Task #NNN — description` comment before the `await db.execute(sql\`...\`)` block in `server/index.ts` (after all existing blocks).
2. All `ALTER TABLE … ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS` patterns are idempotent — safe to re-run at startup.
3. Update `shared/schema.ts` Drizzle table definition to match.
4. If the migration produces derived-only columns (server-computed, never client-written), add them to the `.omit()` list in `createInsertSchema` in `shared/schema.ts`.
5. Bump `package.json` version and add CHANGELOG entry when shipping the release.

**Why:** No ORM migration runner is used — all schema changes are idempotent raw SQL at startup so the dev/VPS/production DBs converge on every restart without manual migration steps.

---

## CHANGELOG maintenance

- File: `CHANGELOG.md` (root)
- Format: `## [X.Y.Z] — YYYY-MM-DD` header, `### Feature Area` sub-headers, bullet points
- Fully up to date through `1.12.1`
