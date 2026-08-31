---
name: Orderly UI and API verification
description: How to prevent stale frontend bundles from corrupting Orderly production reconciliation.
---

For Orderly production verification, record the serving content-hashed web
bundle alongside every browser-derived count. Do not compare a browser counter
with a corrected API response until the serving bundle is confirmed to include
the reviewed frontend changes.

**Why:** Content-hashed bundles can remain stale across backend deployments,
making browser counters look internally plausible while reflecting older
calculation logic.

**How to apply:** Treat the API response as the reconciliation authority.
Rebuild and deploy the web artifact before UI verification, record the bundle
filename, and require the current client's displayed arithmetic to match the
API inputs before accepting any browser-derived count.