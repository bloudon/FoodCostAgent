---
name: Derived approval lists for remediation batches
description: What to do when an approval decision cites an external reviewed exclusion list that does not exist in the workspace.
---

An approval decision may instruct you to use "the exact reviewed list" of
exclusions and explicitly forbid reconstructing it from prose — while that
reviewed artifact is nowhere in the workspace.

**Rule:** do not hand-reconstruct the list from prose, and do not silently
substitute a heuristic. Derive the set deterministically from the accepted
source data using a rule the decision itself implies, then verify the
derivation reproduces every count the decision states independently. Report it
as a derivation, not as the reviewed artifact, and require explicit
confirmation before any mutating step.

**Why:** approval arithmetic stated at multiple independent points (a subset
count, a distinct-total count, and a final approved count) is a strong integrity
check — a wrong derivation rule almost never satisfies all three at once with no
tuning. But agreement is evidence, not proof of identity with the human's list,
so the gap must be surfaced rather than closed by assumption.

**How to apply:** when a decision names a category like "free-text source
identity", look for a structural property in the data that separates it cleanly
(e.g. whitespace in a field that should hold a code/SKU), confirm the derived
count matches the stated count exactly, confirm any specifically named members
land in the derived set, and confirm overlaps the decision describes actually
overlap. Persist both the approved and the held lists as files so the human can
diff them against the original review.

**Related trap:** verifying a "$0.00 expected delta" claim against a field that
does not exist in the source JSON silently returns 0 for every row and proves
nothing. Confirm the field name exists in the actual schema, and prefer
re-deriving the value from primitives (before/after sums) over trusting a
pre-computed column.
