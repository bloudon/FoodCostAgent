---
name: VPS production operator boundary
description: Production operating model for VPS-based FnB Cost Pro rollouts.
---

Replit must not connect directly to the FnB Cost Pro production VPS. For
production readiness work, prepare exact, checksum-verifiable operator commands
and expected sanitized output; the authorized production operator executes them
and returns the sanitized evidence for review.

**Why:** The production environment is intentionally separated from the Replit
workspace. This preserves operational access control and makes the human
operator's live evidence, rather than an agent-side assertion, the review
artifact.

**How to apply:** Do not request or use VPS credentials for this project.
Provide copy/paste commands that fail closed, avoid credentials in output, and
state the exact hard stop. Treat a production step as unverified until the
operator returns its sanitized output and PM reviews it.

The standard release helper treats empty or partial health/build-info responses
during PM2 restart as normal readiness retries without printing JSON parse noise;
the final JSON record remains the authoritative release result.

**Why:** The helper retries readiness probes, but its inline JSON validator
must not turn expected empty responses during restart into alarming stack traces.

**How to apply:** Do not treat intermediate parse noise alone as a failed
release. Require the final record to match the expected commit/build identity
and show `healthVerified: true` plus `buildIdentityVerified: true`; stop on the
helper's final failure instead.