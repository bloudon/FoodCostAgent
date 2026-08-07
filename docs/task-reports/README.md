# Task Completion Reports

Create one report at `docs/task-reports/<task-number>-<short-slug>.md` for each Significant implementation task. Reports describe what actually shipped and are the handoff artifact for Reviewer, QA, and external review. Routine work follows **Build → Test → Done** and does not require a formal report.

## Required format for Significant work

```md
# Task #NNN — Title

## Asked

What was requested.

## Shipped

What changed.

## Deviations

Anything different from the approved plan. Use `None` when there were no material deviations.

## Review

Reviewer: PASS | PASS WITH FOLLOW-UP | BLOCKED
QA: PASS | PASS WITH FOLLOW-UP | BLOCKED
Independent session/workstream separation: VERIFIED | UNVERIFIED

Include evidence, reviewer/workstream identity, and any blocking finding.

## Tests

What was actually tested, including exact commands and relevant manual checks.

## Risks / Decisions

Anything unresolved or requiring Product Owner/PM approval.

## Git

Branch:
Base SHA:
Final SHA:
Diff / PR:
```

The Base SHA, Final SHA, and Diff/PR are mandatory for Significant work.

## Review rules

- The Builder may not fill in its own independent Reviewer or QA result.
- Reviewer and QA outcomes must be stated separately.
- If fresh-session separation cannot be verified, record `PROCEDURAL REVIEW — INDEPENDENCE UNVERIFIED`.
- `BLOCKED` prevents completion until the finding is resolved or the approval path changes.
- `PASS WITH FOLLOW-UP` must include a concrete follow-up.
- QA may not waive a Reviewer block.
- Review evidence does not constitute Product Owner/PM approval.