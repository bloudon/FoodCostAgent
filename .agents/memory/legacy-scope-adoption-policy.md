---
name: Legacy scope adoption policy
description: How a narrowly bounded exception to a fail-closed scope validator is granted without weakening it, and why the authorization is code-owned rather than manifest-owned.
---

A fail-closed scope validator can be given a legacy-adoption exception only as a
*positively evidenced* allow path: the classifier must independently prove the
mapping belongs to the approved scope (its own provenance, single active
property binding), and a separate trusted authorization object must match the
exact population — scope tuple, manifest id, accepted report hash, unapproved
remainder hash, group count, and resolved legacy batch count. Every field is
re-verified inside the validator; supplying the object is not permission.

The authorization is **code-owned**, never read from the manifest or CLI flags.
The manifest only supplies the binding values that get compared against the
code-owned policy, so a mismatch blocks.

**Why:** "missing scope metadata" is the single largest class of blocked rows in
this kind of remediation, which makes `property IS NULL => in scope` extremely
tempting. That predicate silently authorizes any future row that happens to
lack metadata, including genuinely foreign ones, and it cannot be un-shipped
once historical data has been merged under it. Binding the exception to one
proven population keeps the general rule fail-closed.

**How to apply:** when a scope/authorization exception is requested,
- add the allow path to the ONE shared decision function both preflight and the
  mutation path already call — never an apply-only branch, and pass the same
  authorization object into the transaction-time recheck;
- keep the diagnostic classification separate from the authorization decision,
  so evidence reports stay unchanged and reviewable;
- keep group-level pass as "zero remaining violations", so a mixed group
  containing one unauthorized mapping still blocks;
- assert the policy constants in a test — the constants ARE the authorization
  contract, and drift in them silently widens the exception;
- default (no authorization supplied) must reproduce the old behavior exactly.

Proving an authorization-semantics change is safe is easiest when the candidate
population is held byte-identical: run the unchanged manifest through read-only
preflight and show it now authorizes. If the manifest is regenerated at the same
time, nothing distinguishes "we changed who is allowed" from "we quietly changed
who is asking".
