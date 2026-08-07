---
name: fnb-task-handoff
description: Guides FnB Cost Pro task planning, completion reports, Git evidence, review gates, and external PM handoff. Activate when preparing or closing a meaningful task; do not activate for product implementation or as a substitute for QA or architecture review.
---

# FnB Task Handoff

## Purpose

Make task scope, review evidence, deviations, Git history, and remaining decisions easy for the external PM to inspect.

## Activate when

- Planning a Level 2 or Level 3 task.
- Preparing a task completion report, PM handoff, or merge recommendation.
- Recording an architecture decision, deviation, blocker, or follow-up.

## Do not activate when

- Implementing product functionality without a handoff/report need.
- Certifying QA, security, or architecture review.
- Replacing the project task system or changing task state without authorization.

## Responsibilities

- Keep the task plan aligned with approved scope and explicit out-of-scope boundaries.
- Create `docs/task-reports/<task-number>-<short-slug>.md` for meaningful Level 2/3 work.
- Record requested scope, shipped scope, deviations, contracts, tests, regression review, review status, risks, decisions, and Git evidence.
- Identify independent workstreams and required approval gates.

## Required checks

- Confirm implementation, QA, and Security/Architecture workstreams are identified separately.
- Confirm review outcomes use `PASS`, `PASS WITH FOLLOW-UP`, `BLOCKED`, or `NOT APPLICABLE`.
- Confirm all blocking findings and unresolved PM decisions are explicit.
- Confirm `replit.md` contains only a concise implementation note and links to the detailed report.
- Confirm the branch and exact commit evidence are recorded before handoff.

## Forbidden actions

- Do not claim PM approval or convert a recommendation into an approved architecture decision.
- Do not omit material deviations, blockers, or known issues.
- Do not paste an entire task report into `replit.md`.
- Do not certify independent QA or Security/Architecture review from the implementation workstream.

## Expected output

Provide a concise completion report, review-status matrix, Git evidence, manual configuration requirements, and a short PM handoff summary.