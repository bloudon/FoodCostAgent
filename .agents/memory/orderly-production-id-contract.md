---
name: Orderly production identifier contract
description: Orderly company identifiers are strings even when some environments use numeric values.
---

Orderly production diagnostics must treat `company_id` as a bounded non-empty string, not as a UUID-only field. Batch IDs may remain UUID-validated when the reviewed production batch is known to be UUID-shaped. On hardened VPS hosts, procfs may deny access to the PM2 environment; the diagnostic may fall back to the same checkout's locked `.env` without printing it.

**Why:** The database schema declares `inventory_import_batches.company_id` as `VARCHAR`; a UUID-only diagnostic guard blocked the approved read-only incident report before it could query production. The VPS also denied `/proc/<pid>/environ` access even under the expected operator account, so a procfs-only DB lookup was not runnable.

**How to apply:** Validate company IDs with a safe identifier allowlist that rejects blank values and shell/metacharacters, while keeping the SQL query parameterized and the batch/company scope exact. Prefer the live PM2 environment; if procfs is inaccessible, read only `DATABASE_URL` from the expected checkout `.env` in memory and keep it out of logs/output.