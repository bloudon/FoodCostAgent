---
name: Historical evidence retention
description: Rules for migration-source "evidence" tables (retained invoices/documents) — immutability enforcement, conflict granularity, and identity resolution safety.
---

# Retained migration evidence

Tables that retain source documents from a system we are leaving are **evidence**, not
live domain records. They follow different rules from operational tables.

## Immutability must be enforced in the database

A service that "only inserts" is not accepted as immutability. Put a `BEFORE UPDATE`
trigger on the header and line tables that raises an exception; keep all mutable review
state (status, counts, resolution/conflict rows) in *separate* batch/conflict tables.

**Why:** review rejected service-convention-only immutability as a blocking finding — any
future code path or manual query could silently rewrite retained evidence, destroying the
audit value that justified the migration.

**How to apply:** create the trigger in the same idempotent startup migration as the tables
(`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`). Note the
service can then only UPDATE the batch row — verify no insert helper tries to backfill a
header/line after the fact. Drizzle wraps driver errors, so tests must assert on
`err.cause.message`, not `err.message`.

## Conflict detection needs three-way granularity

Hashing a whole document and comparing one hash is not enough. On re-import compare:
1. the header hash **with lines stripped** → header-changed conflict
2. each incoming line hash against the stored line hash → changed/added line
3. each *stored* line id absent from the incoming payload → removed line

**Why:** a single whole-document hash detects that *something* changed but cannot say what,
and iterating only incoming lines silently loses deletions — a source line disappearing from
a re-import produced no conflict at all until this was caught in review.

## Never trust an external-identity mapping row alone

An external-id → internal-id mapping row is a *hint*. Before linking, re-verify the target
actually belongs to the acting tenant by joining through the ownership chain (vendor →
company, item → company). A stale or corrupted mapping must degrade to "unresolved", never
resolve across a tenant boundary.

## Resolve retained lines through an immutable mapping overlay

Never relax the evidence-table update trigger to attach a later relationship. Store the
confirmed source identity in paired inventory-item and vendor-product mappings, then project
that relationship when retained invoices are read. Future imports must consume and validate
the same pair; the vendor-product mapping is authoritative even when its catalog SKU differs
from the source code.

**Why:** historical source rows must remain unchanged, while a confirmed repair still needs
to affect every matching retained occurrence and later imports. An inventory-only mapping
cannot identify a non-SKU vendor product, and a vendor-only mapping cannot prove the
canonical inventory item.

**How to apply:** require company, source system, source property, source code, vendor,
inventory ownership, and pair agreement on every read/import. Fail closed on missing,
competing, cross-tenant, or disagreeing mappings; never backfill historical evidence rows.

## Scope every read on the full identity, not just company

Completeness/report queries must filter company **and** destination store **and** source
system **and** source property — on every table in the report (batches, headers, and lines
joined through their header). Filtering headers correctly while filtering lines by company
alone produces internally inconsistent totals and leaks other stores' data.
