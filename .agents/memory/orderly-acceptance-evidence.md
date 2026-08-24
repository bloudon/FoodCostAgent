---
name: Orderly acceptance evidence
description: Evidence standards for approving the Orderly import flow before production use.
---

# Orderly approval requires runtime and write-path evidence

Treat structural code review, authenticated browser acceptance, and an actual
development approval dry run as separate gates. A code review can pass while a
resume/navigation state defect remains live, and persistence tests can pass while
the saved decision is not yet proven to control the approval mutation.

**Why:** The irreversible step depends on both runtime state hydration and the
write path. Missing either kind of evidence leaves a production-seed risk that
static review cannot expose.

**How to apply:** Before production approval, diagnose identity-suite failures,
prove a saved draft controls approval with an empty-body request, validate the
authenticated resume flow, and run the full dev dry run only with explicit
authorization at the Approve action.