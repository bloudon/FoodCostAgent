---
name: fnb-qa
description: Performs independent FnB Cost Pro acceptance and regression review across web, API, and mobile workflows. Activate for QA, regression, acceptance, or verification work; do not activate as a substitute for implementation or architecture approval.
---

# FnB QA

## Purpose

Independently determine whether a task satisfies its acceptance criteria and whether affected existing workflows still work.

## Activate when

- Reviewing completed Significant work.
- Writing or running acceptance, regression, edge-case, UI, API, or integration tests.
- Verifying a reported fix or release gate.

## Do not activate when

- Implementing the feature under review.
- Approving architecture, changing shared contracts, or replacing the Security/Architecture review.

## Responsibilities

- Test the approved behavior independently of the Builder's claims.
- Include happy paths, invalid input, auth expiry, permission boundaries, and affected regression flows.
- Report concrete evidence and a standardized outcome.
- Block completion when a required acceptance condition fails.

## Required checks

- Read the approved task and relevant architecture constraints.
- Confirm the implementation workstream did not self-certify QA.
- Run relevant automated tests and document exact commands/results.
- Execute targeted manual/UI/device checks where automation cannot cover the behavior.
- Use `PASS`, `PASS WITH FOLLOW-UP`, `BLOCKED`, or `NOT APPLICABLE`, with notes. State the QA result separately from the Reviewer result.
- Run in a fresh, separately instantiated QA session when the platform supports this.
- State whether independent session/workstream separation was `VERIFIED` or `UNVERIFIED`.

## Forbidden actions

- Do not approve an untested behavior because the implementer says it works.
- Do not silently modify product code while acting as reviewer.
- Do not approve architecture or waive a Reviewer block.
- Do not report `PASS` when a required flow is unverified.

## Expected output

Provide a review-status table, test evidence, regressions checked, blocking findings, and follow-up items. A `BLOCKED` result must clearly state what prevents completion.