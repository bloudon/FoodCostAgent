---
name: Orderly production identifier contract
description: Orderly company identifiers are strings even when some environments use numeric values.
---

Orderly production diagnostics must treat `company_id` as a bounded non-empty string, not as a UUID-only field. Batch IDs may remain UUID-validated when the reviewed production batch is known to be UUID-shaped.

**Why:** The database schema declares `inventory_import_batches.company_id` as `VARCHAR`; a UUID-only diagnostic guard blocked the approved read-only incident report before it could query production.

**How to apply:** Validate company IDs with a safe identifier allowlist that rejects blank values and shell/metacharacters, while keeping the SQL query parameterized and the batch/company scope exact.