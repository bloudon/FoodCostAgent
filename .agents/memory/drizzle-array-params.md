---
name: Drizzle ORM array parameters in raw sql``
description: How to safely pass a JS string[] into a raw Drizzle sql`` query for IN/ANY clauses — what fails and what works.
---

## Rule
Never pass a plain JS array directly into a Drizzle `sql` template tag for `ANY()` or attempt to cast it with `::uuid[]`.

**What fails:**
```ts
sql`WHERE id = ANY(${ids})`          // "requires array on right side"
sql`WHERE id = ANY(${ids}::uuid[])`  // "cannot cast type record to uuid[]"
```
Drizzle serialises a JS `string[]` as a PostgreSQL record type, not a typed array, so both forms break.

**What works — use `sql.join` to build individual parameters:**
```ts
sql`WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`
```
Each `${id}` becomes a properly-typed scalar parameter; `IN (...)` works without any explicit cast.

**Why:** Drizzle's `sql` template tag does not automatically convert a JS array to a PG array literal. You must decompose the array into individual `sql` fragments and join them yourself.

**How to apply:** Any time `getVendorCasePricesBatch` (or any raw-sql function) needs to filter by a list of IDs, use the `sql.join` pattern above instead of `ANY($1)`.
