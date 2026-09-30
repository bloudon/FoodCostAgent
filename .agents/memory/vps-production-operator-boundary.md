---
name: VPS production operator boundary
description: Production operating model for VPS-based FnB Cost Pro rollouts.
---

Replit must not connect directly to the FnB Cost Pro production VPS. For
production readiness work, prepare exact, checksum-verifiable operator commands
and expected sanitized output; the authorized production operator executes them
and returns the sanitized evidence for review.

Replit publishing is not part of this project's release process. Configured
Replit workflows and previews are for development verification only.

**Why:** The production environment is intentionally separated from the Replit
workspace. This preserves operational access control and makes the human
operator's live evidence, rather than an agent-side assertion, the review
artifact.

**How to apply:** Do not request or use VPS credentials for this project.
Provide copy/paste commands that fail closed, avoid credentials in output, and
state the exact hard stop. Treat a production step as unverified until the
operator returns its sanitized output and PM reviews it. Do not suggest
publishing the app through Replit.

Operator-only read queries must tolerate production schema lag: do not require
recent optional columns for a historical evidence extract. If the live schema
rejects a query, stop, revise only the read projection, and reconcile the
completed output before drawing row-level conclusions.

**Why:** A read-only count-draft extract stopped on a development-only
pack-snapshot column. The failed run had partial session summaries but no
completed row-level result.

**How to apply:** Require a complete terminal result through `ROLLBACK` and
check row counts against the session totals before classifying saved lines.
Keep raw operator output private; commit only structured findings with the
scope and evidence limits stated.

The standard release helper treats empty or partial health/build-info responses
during PM2 restart as normal readiness retries without printing JSON parse noise;
the final JSON record remains the authoritative release result.

**Why:** The helper retries readiness probes, but its inline JSON validator
must not turn expected empty responses during restart into alarming stack traces.

**How to apply:** Do not treat intermediate parse noise alone as a failed
release. Require the final record to match the expected commit/build identity
and show `healthVerified: true` plus `buildIdentityVerified: true`; stop on the
helper's final failure instead.