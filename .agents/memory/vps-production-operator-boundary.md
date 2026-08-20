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