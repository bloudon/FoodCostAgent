# Task #984 — Simplify the Engineering Operating Model

## Asked

Replace the six-role/three-level operating model with the smallest structure that protects against self-certification, hallucinated architecture, auth and tenant-scoping mistakes, data-integrity and costing errors, shared-contract drift, and regressions. Do not change product functionality.

## Shipped

- Reduced the Replit operating roles to Builder, Reviewer, and QA.
- Reduced classification to Routine and Significant.
- Added the explicit fresh-session/workstream independence rule and `PROCEDURAL REVIEW — INDEPENDENCE UNVERIFIED` outcome.
- Consolidated architecture, security, authorization, tenant isolation, shared-contract, inventory, and costing guardrails into `fnb-review` and active project guidance.
- Retained the specialized mobile skill and its SecureStore, WebView, route-whitelist, camera, microphone, scan, and voice-bridge contracts.
- Simplified Significant task reports to Asked, Shipped, Deviations, separate Reviewer/QA outcomes, Tests, Risks/Decisions, and mandatory Git evidence.
- Replaced the proposed Workspace Custom Instructions with the concise eight-line block.
- Updated `replit.md` with current architecture truth, project map, guardrails, and the simplified process.

## Deviations

None from the uploaded Update #984 scope. Useful historical mobile architecture decisions were preserved. No application code, API, auth, schema, artifact, or workflow files changed.

## Review

Reviewer: NOT APPLICABLE — this is the operating-model documentation update itself; the new Reviewer role is defined by this change.

QA: PASS — structural verification completed against the uploaded requirements.

Independent session/workstream separation: UNVERIFIED — this documentation update was completed in one Builder session; the new rule requires fresh Reviewer and QA sessions for future Significant product work.

## Tests

- Confirmed the active model presents only Builder, Reviewer, and QA.
- Confirmed only Routine and Significant task classes remain.
- Confirmed the separate-session rule and unverified-separation wording are explicit.
- Confirmed FnB shared-contract and data-integrity guardrails remain visible.
- Confirmed Significant reports require Base SHA, Final SHA, and Diff/PR.
- Confirmed the retained skill set is exactly `fnb-review`, `fnb-qa`, and `fnb-mobile`.
- Confirmed no application files changed.
- Ran `git diff --check`.

## Risks / Decisions

- Workspace Custom Instructions still require manual Product Owner installation through Workspace Settings.
- Product Owner/PM approval is still required before this becomes the formal process baseline.
- The external Challenger review remains required for future Significant work.

## Git

Branch: `main`

Base SHA: `93ef85152f96b59efd7277e27d7e36a0e945c3ab`

Final SHA: `5280f90095b632b45806e9f0e5d406594ff6bb25`

Diff / PR: local commit on `main`; no PR created