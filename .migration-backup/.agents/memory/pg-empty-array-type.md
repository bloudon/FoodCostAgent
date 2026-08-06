---
name: pg-driver empty array type
description: Why bare '{}' fails as an empty array literal in Node.js pg driver INSERT statements on VPS, but works on Neon serverless / psql.
---

## The Rule
Never use bare `'{}'` as an empty array value in INSERT VALUES inside a Drizzle `sql` tagged template executed via the Node.js `pg` driver. Always use `ARRAY[]::text[]` (or the appropriate type) instead.

**Why:** The Node.js `pg` driver sends queries using the extended (prepared statement) protocol. In this protocol, PostgreSQL parses the query before binding parameter types, and cannot infer the column type for an untyped empty array literal `'{}'` when it appears in a VALUES list. This triggers PG error `42P18 — cannot determine type of empty array`.

**Affected context:** `db.execute(sql`...`)` calls in `server/index.ts` (startup migrations) when running on the VPS with standard PostgreSQL + pg-pool.

**Not affected:**
- Replit / Neon serverless driver — uses a different execution path that resolves types correctly
- `psql` command-line (vps-migrate.sql) — uses simple query protocol where column context is available

**How to apply:**
- In all `sql` template literals with INSERT VALUES containing empty arrays, use `ARRAY[]::text[]` not `'{}'`
- In DDL DEFAULT clauses (`DEFAULT '{}'`) the issue doesn't arise — PostgreSQL knows the column type. But `DEFAULT ARRAY[]::text[]` is also valid and more explicit.
- If you see `42P18` in PM2 logs, search for `'{}'` in `server/index.ts` INSERT statements.
