---
name: Explaining a mismatched report/manifest hash
description: How to diagnose two different hashes claimed for "the same" report before concluding a binding is wrong or regenerating.
---

When a reviewer reports that a snapshot's hash differs from the one a
downstream artifact stores, do not assume "internal hash vs physical file
hash" and do not regenerate. Both values are frequently the *same* algorithm
over *different populations*.

**Rule:** find the hash function in the codebase, read what it actually covers,
then reproduce each candidate value locally by feeding it the populations it
might have seen — including the degenerate empty-population case.

**Why:** a canonical hash computed over `(scope, groups)` still returns a
perfectly valid, stable digest when `groups` is empty. An earlier failed
discovery run that found zero rows therefore emits a real-looking hash for the
same scope. Recomputing `hash(scope, [])` and matching it exactly turns an
unexplained discrepancy into a fully accounted-for artifact of a prior run, and
proves the current binding was never wrong. Regenerating instead would have
destroyed a correct, already-reviewed approval.

**How to apply:** import the production hash function directly in a read-only
script rather than reimplementing it — a reimplementation that disagrees proves
nothing about the real binding. Recompute and compare: the stored hash inside
the snapshot, the hash over the parsed population, the empty-population hash,
and any remainder/partial hash the downstream artifact stores. Report physical
file digests separately and explicitly, since they legitimately differ from
canonical hashes and from each other when a file has a CLI preamble stripped.

**Related trap:** a verification script that reads a field name the artifact
does not use (e.g. `unapprovedRemainderHash` when the schema says
`unapprovedReportHash`) reads `undefined` and reports a false mismatch. Any
"mismatch" against a hardcoded field name should be checked against the actual
key list before it is believed — same failure mode as verifying a delta against
a nonexistent column and getting a meaningless zero.
