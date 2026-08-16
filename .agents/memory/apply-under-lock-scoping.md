---
name: Under-lock revalidation scoping
description: Why per-group transaction rechecks must be scoped to the group, and what benchmark tooling must guarantee.
---

The remediation APPLY path was ~105 s/group because the under-lock freshness recheck rebuilt the WHOLE-SCOPE discovery report inside every group's transaction (~64k queries/group at 848-group scale). A group's derived facts (candidates, classification, evidence, per-group hash) depend only on its own source code's rows/mappings/audits, so the under-lock rebuild can be filtered to that one code with byte-identical group output (215 queries, sub-second).

**Why:** Whole-scope invariants (remainder hash, scope gate, merge-content gate) only need proving once immediately before mutation; repeating them under each lock adds no safety, just O(scope × groups) cost. A parity test must assert the filtered group object and per-group hash are deep-equal to the full report's.

**How to apply:** When a per-item transaction re-derives evidence "fresh under lock", scope the re-derivation to that item's own dependency set; keep manifest-wide gates as a single pre-mutation pass. Filtered report-level totals/hashes describe a different population — never compare them to whole-report hashes.

Benchmark tooling that mutates data needs a fail-closed database-identity guard checked BEFORE any DB import: NODE_ENV is not a database identity; require an exact-host opt-in env var, a code-owned unconditional rejection of the documented production endpoint, and a REQUIRED declared production host (missing configuration is refusal, not permission). Cleanup scripts must target an explicit run id, never a name-prefix sweep. Also: detached background processes in this workspace die silently — keep benchmark runs under the shell timeout and add heartbeats.
