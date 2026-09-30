---
name: DB-backed tests vs real dev data
description: What to do when a DB-backed suite inserts a real-world unique key (e.g. the Bay Hill source-property binding) that now exists in the dev database.
---

# DB-backed suites that seed real unique keys collide with real dev data

A suite that inserts a fixture carrying a REAL production identity key (e.g. the
ORDERLY source-property binding `24472`, globally unique on
(source_system, source_property_id)) passes on a clean database and fails with a
23505 the moment the real row is adopted into dev.

**Why:** The service under test hard-locks the real key (z.literal + binding
lookup), so the test cannot randomize it, and the global-unique constraint is
intentional policy — weakening either to make the test pass would destroy the
guarantee being tested.

**How to apply:** Treat the failure as environmental, not a regression. Run the
suite against an isolated schema-identical database: `CREATE DATABASE x;` on the
local dev Postgres, `pg_dump --schema-only` from dev piped into it, then run
vitest with `DATABASE_URL` pointed at it. Note: suites whose beforeAll depends on
seeded reference data (e.g. an `ea` unit) will self-skip on a schema-only clone —
run those against dev, where run-suffixed ids keep them collision-free.

For destructive-route regression suites, clone the schema from the **active
application connection**, not a similarly named auxiliary database URL. The two
can point to different schemas even within one workspace; a successful
schema-only dump from the wrong one may omit tables the route needs. Make the
fixture suite refuse any connection except its dedicated local database,
including in teardown, and select the local PostgreSQL driver explicitly.

**Why:** A disposable clone from an auxiliary URL lacked migration-created
tables; the local app then tried the serverless transport until the driver mode
was set. A test guard in setup alone is insufficient if teardown still runs
after a failed setup.

**How to apply:** Confirm the source is the connection used by the running app,
check required tables after restore, set local driver mode for the test, and
guard both fixture writes and cleanup before running actual mutation tests.

# Historical count-session destination is the batch's, not the caller's

`createCountSession` must reject any client storeId that differs from the
approved batch's persisted targetStoreId (code `BATCH_STORE_MISMATCH`), failing
closed before any write; legacy null-target batches keep working. User
accessibility to another store is never destination authority.

**Why:** Reviewer found the route only checked accessibility, letting a
multi-store user land one property's historical snapshot in another store —
the same class of bypass as the approval-boundary lesson.
