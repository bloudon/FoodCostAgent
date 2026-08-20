---
name: Production database source of truth
description: How to treat conflicting Replit production-query and VPS application database evidence.
---

When checking a VPS-hosted production invariant, the production database
interface available from Replit is evidence only after its target identity has
been reconciled with the database selected by the VPS application environment.
If the two disagree, the authorized VPS operator's read-only report is the
source of truth for the serving application; do not relabel the Replit result
as the live VPS result.

**Why:** A Replit production query returned a materially older vendor-item
population and schema that contradicted the VPS startup invariant. Treating
that result as authoritative would have produced a false “no duplicates”
clearance.

**How to apply:** Record sanitized database identity on both sides, report any
schema/count contradiction explicitly, and issue a checksum-pinned,
read-only operator command. Do not access the VPS directly, infer parity, or
perform a remediation from the non-reconciled Replit target.