---
name: Drizzle array params hit ROW-expression cap
description: How to pass large id lists to raw SQL through drizzle/neon without the 1664-entry limit
---

Binding a JS array into a drizzle `sql` template (e.g. `= ANY(${ids})`) expands it into a ROW expression, and Postgres caps those at 1664 entries — large id lists fail with error 54011.

**Why:** drizzle serializes the array as individual placeholders rather than one array parameter.

**How to apply:** pass the list as a single jsonb parameter and unnest it: `WHERE col IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`. Works for SELECT/UPDATE/DELETE at any list size. Same shape works inside `sql.raw` when quoting the json string literal.
