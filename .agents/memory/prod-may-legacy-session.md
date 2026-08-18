---
name: Production May 2026 legacy session state
description: Production already holds an APPLIED, pre-historical-model May 2026 Bay Hill session — reload is forbidden and any change is PM-gated.
---

# Production May 2026 is an applied legacy session — never reload

Production (VPS DB) already contains the May 2026 Bay Hill import: batch
`fce3be2b-23b0-449a-9cd4-73788072e3e3` (approved 2026-08-02) and session
`d76d4676-0793-421f-bd11-5d7f6061a8ad` with `applied=1`,
`is_historical_import=0`, 2,513 resolved lines, ZERO unresolved-evidence links
(schema exists but predates the session's creation path). The current model
would resolve 2,092 lines and hold 1,031 blank-code rows as evidence.

**Why:** PM decision (hard-stop branch): a second May import/session is
forbidden — the goal is one authoritative May snapshot. The applied session
mutated live on-hand, so migrating it is an unwind-and-migrate design problem,
not a metadata flip.

**PM scope reduction (2026-08-17):** the May/June sessions are the ORIGINAL
imports that created the duplicate-identity population — valuations reconciled
exactly through remediation. Default disposition is ACCEPT MAY/JUNE AS
HISTORICAL BASELINE unless a concrete material mapping error is proven
(lines referencing superseded items, stopped groups touching those sessions,
or a demonstrably wrong old-only resolution). Do NOT unwind or re-import
merely because the current matcher would resolve rows differently. Coherence
check script: `reports/bay-hill-may-gate/verify_may_june_baseline_coherence.sql`.

**How to apply:** Any May-related production work starts read-only (script at
`artifacts/api-server/reports/bay-hill-may-gate/verify_may_production_readonly.sql`)
and requires explicit PM sign-off before any write. Watch the file-hash dedupe:
only `force_new` could create a duplicate — never use it on prod for May.
