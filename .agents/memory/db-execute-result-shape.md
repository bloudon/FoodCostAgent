---
name: db.execute result shape differs by driver
description: Raw db.execute returns a QueryResult under one driver and a bare array under the other, so a wrong cast silently reads zero rows.
---

# `db.execute` result shape is driver-dependent

Raw `db.execute(sql\`...\`)` does not return the same shape under both drivers this
project selects between: one yields a driver `QueryResult` (rows under `.rows`), the
other yields a bare array. Casting the result directly to an array type compiles
cleanly under both and then reads **zero rows** under the wrong one.

That failure mode is dangerous because it is silent and inverts meaning. An evidence
or safety check written as "count rows that violate the rule, require zero" passes
vacuously when the shape is wrong — the guard reports success precisely because it
read nothing. A count-based verification that has never been seen to fail has not
been shown to work.

**Why:** A period-evidence check in a data-adoption script read `[0].dated` off a
`QueryResult`, got `undefined`, and reported "no dated rows" on a batch with 4,319 of
them. Had the assertion been phrased as "zero violations" rather than "must have
dated rows", it would have passed silently and authorised a write.

**How to apply:** Normalise through a helper that accepts both shapes before reading
rows from raw `db.execute`. Prefer the query builder when it can express the query.
For any safety check built on a count, also assert the population is non-empty, so an
empty read fails loudly instead of looking like compliance.
