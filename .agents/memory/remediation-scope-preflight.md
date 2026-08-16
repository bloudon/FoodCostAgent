---
name: Remediation scope preflight
description: Production-safe approval of bulk duplicate remediation when candidate identities may have references outside the approved property.
---

# Validate all cross-scope references before approval and apply

Bulk remediation preflight must scan the complete approved candidate set for
references outside the approved company, store, source system, and source
property. It must reject the manifest before APPLY when any are found, with a
reviewable exclusion or explicitly authorized exception set.

**Why:** Per-group fail-closed checks protect data integrity, but discovering
cross-property references during a live production APPLY creates a partial,
slow-running operation that cannot meet an all-or-nothing approval expectation.

**How to apply:** Put the same scope predicate behind manifest generation,
read-only preflight, and APPLY. Tests must cover candidates with one and
multiple outside-scope mappings and prove rejected manifests produce no
remediation mutation or audit attempt.

# One shared function, not two that agree

"Preflight and APPLY use the same rule" is only true when both call the *same*
function. Two implementations written to match will drift, and the drift is
invisible until a production run discovers a blocker preflight missed.

**Why:** The gap that suspended a production run was not a wrong check — the
APPLY-side check was correct. It was that the check existed *only* inside the
mutation path, so it could not run before mutation, and it evaluated one group
at a time. The fix is structural: one decision function that returns violations
plus the exact stop reason, a throwing wrapper for APPLY, and a
whole-manifest loop for preflight.

**How to apply:** Make the shared validator the only place the predicate is
expressed, and have the mutation-path module re-export it rather than keep a
copy. Keep the operator-visible reason text inside that function too — if each
caller formats its own message, the same evidence gets described two ways and
the audit trail stops being comparable. Keep the in-transaction re-check as
defence in depth: preflight proves the manifest was clean when it ran, the
transaction re-check proves it is still clean under lock.

# A gate enforced at the call site is not enforced

The all-or-nothing manifest gate must live inside the mutation function itself,
not in the operator CLI that usually calls it.

**Why:** Having the CLI run the whole-manifest gate and the mutation function
run only its per-group check looks equivalent — the same validator runs either
way — but it leaves the mutation function callable directly with no gate at
all. Any other caller (a route, a script, a job, a test) silently gets the old
group-by-group behaviour, which applies clean groups and discovers a blocker
only when the loop reaches it. The guarantee has to be a property of APPLY, not
of one call site remembering to ask.

**How to apply:** Put the gate at the top of the mutation entry point, before
the first transaction or audit write, and let the operator front-end call it
again first for progress output and forensics. A duplicated SELECT-only
evaluation on a rare operator action is a cheap price for a guarantee that
cannot be bypassed. When adding it, expect existing tests that asserted a
per-group "stopped" result to now assert a manifest-level refusal — the correct
evidence becomes "no audit row at all", since no group was ever attempted.

# Enumerate every blocker; never stop at the first

A blocked manifest must report the complete blocker set in one read-only pass.

**Why:** Failing on the first blocker turns one blocked manifest into a sequence
of failed production runs, each discovering the next problem. Operators need one
decision, not N.

**How to apply:** Collect violations rather than throwing at the point of
detection; refuse the manifest as a whole afterward. Never offer to apply "the
clean subset" of a manifest that was approved as a unit — that silently
substitutes a scope nobody reviewed.

# Missing scope metadata is a question, not permission

A NULL or empty scope column is neither authorized nor foreign. It is an
unanswered ownership question that must fail closed and be surfaced for a human
ruling.

**Why:** Reading absent metadata as "safe" lets one property's approval rewrite
another's records; reading it as "foreign" solely because it is absent
permanently strands legitimate legacy data. Note that a NOT NULL column with a
`''` default means "missing scope" arrives as the empty string, not NULL —
handle both identically.

**How to apply:** Classify diagnostically (legacy-looking / demonstrably foreign
/ ambiguous) using positive provenance evidence, and require *both* that the
item's own history sits entirely inside the scope *and* that only one property
is bound to the store before calling anything legacy-looking. Classification
must never unblock: a diagnosed group still blocks until a Product Owner sets
policy. Say so in the code and in the operator output, or the label will be read
as an approval.

# Concurrency is handled by write quiescence, not locking (PM decision)

For the one-time Bay Hill remediation, the PM ruled against adding a
manifest-level lock. Concurrent-writer safety comes from an operational
runbook instead: recovery point → stop API/application writers on the VPS →
confirm no background writers → policy-preflight the unchanged manifest →
APPLY only if clean → reconcile → post-APPLY verification → restart → health
check. Transaction-time scope validation stays as defense in depth.

**Why:** A distributed locking mechanism solely for a controlled one-time
migration is not worth its complexity; quiescence gives the same all-or-nothing
guarantee operationally.

**How to apply:** Every future APPLY of this manifest requires fresh Product
Owner authorization plus that runbook — never a live-traffic apply. If
remediation ever becomes a routine live capability with active writers, revisit
manifest-level concurrency as a separate architecture requirement. The Batch 1
Class A policy is closed too: 848/848 groups authorized under the existing
narrowly bound policy (932 Class A, 0 B, 0 C); do not broaden it.

# Bound suspended-run verification to the run

Proving an aborted run mutated nothing must be scoped to that run's manifest id,
plus a direct check over exactly the item ids that manifest named.

**Why:** Aggregate "does production look clean" cannot distinguish this run's
effects from an unrelated earlier repair, and passes silently when it scanned
the wrong population.
