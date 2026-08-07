# Task Completion Reports

Create one report at `docs/task-reports/<task-number>-<short-slug>.md` for every meaningful Level 2 or Level 3 implementation task. Reports describe what actually shipped and are the primary handoff artifact for independent review and external PM review.

## Required format

```md
# Task #NNN — Title

## Requested

Concise summary of the approved scope.

## Shipped

What was actually implemented.

## Deviations

Differences from the approved plan. Use `None` when there were no material deviations.

## Major Files Changed

List important files, components, routes, and schemas. Do not dump every changed file.

## Contracts Changed

Identify changes to API contracts, schema, auth, permissions, mobile bridges, and shared interfaces. Use `None` when no shared contract changed.

## Tests and Verification

State exactly which automated tests ran, which manual flows were checked, and the results.

## Regression Review

State existing functionality specifically checked because it could have been affected.

## Review Status

| Review | Result | Reviewer / workstream | Notes |
|---|---|---|---|
| Implementation | Complete |  |  |
| Automated tests | PASS |  |  |
| Regression QA | PASS |  |  |
| Security/Architecture | NOT APPLICABLE |  |  |
| PM approval required | No |  |  |

Allowed review results are `PASS`, `PASS WITH FOLLOW-UP`, `BLOCKED`, and `NOT APPLICABLE`. An implementation workstream may not fill in independent QA or Security/Architecture approval for itself.

## Known Issues / Technical Debt

List remaining issues.

## Decisions Required

Anything that still needs user or PM approval.

## Git Evidence

- Branch:
- Setup commit SHA:
- Report commit SHA:
- Relevant earlier commits:
```

## Review rules

- A `BLOCKED` result prevents recommending completion until the finding is resolved or the approval path changes.
- `PASS WITH FOLLOW-UP` must include a concrete follow-up.
- `NOT APPLICABLE` must include a reason.
- Level 3 reports must show independent QA and Security/Architecture review, even when the result is `NOT APPLICABLE`.
- Reports should distinguish implementation evidence from product or architecture approval.