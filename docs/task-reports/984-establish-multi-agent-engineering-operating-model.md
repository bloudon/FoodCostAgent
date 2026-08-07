# Task #984 — Establish the Multi-Agent Engineering Operating Model

## Requested

Configure the project for explicit engineering roles, Level 1–3 approval gates, independent QA and Security/Architecture review, focused reusable Skills, completion reports, and predictable external PM handoffs. Do not change product functionality.

## Shipped

- Added the project operating model and role boundaries.
- Added Level 1–3 approval rules, including financial calculations and inventory/data-integrity risks in Level 3.
- Added shared-contract, independent-review, blocking-review, parallel-work, ADR, merge-gate, and PM-handoff rules.
- Added the task completion-report format and review-status matrix.
- Added five focused Skills at the requested paths.
- Added proposed Workspace Custom Instructions for manual installation.
- Updated `replit.md` with a concise operating-model section and pointers.

## Deviations

None.

## Major Files Changed

- `replit.md`
- `docs/agent-operating-model.md`
- `docs/task-reports/README.md`
- `docs/replit-custom-instructions.md`
- `.agents/skills/fnb-backend/SKILL.md`
- `.agents/skills/fnb-mobile/SKILL.md`
- `.agents/skills/fnb-qa/SKILL.md`
- `.agents/skills/fnb-security-review/SKILL.md`
- `.agents/skills/fnb-task-handoff/SKILL.md`

## Contracts Changed

None. This task changed process documentation only.

## Tests and Verification

- Validated required files and Skill paths exist.
- Validated each Skill has YAML frontmatter and all seven required operational sections.
- Ran `git diff --check`.
- Confirmed no application source, API, schema, artifact, or workflow files changed.

## Regression Review

Existing product functionality was not exercised because this task made no product or application changes. Existing mobile architecture decisions and the reconciliation report were preserved.

## Review Status

| Review | Result | Reviewer / workstream | Notes |
|---|---|---|---|
| Implementation | Complete | Integration Lead | Documentation/configuration setup only |
| Automated tests | PASS | Integration Lead | Structural and whitespace checks completed |
| Regression QA | NOT APPLICABLE | QA / Regression workstream | No product behavior changed |
| Security/Architecture | PASS WITH FOLLOW-UP | Security / Architecture workstream | Follow-up: install Workspace Custom Instructions manually and use the model on a Level 3 task |
| PM approval required | Yes | External PM | PM review of the operating model and future Workspace Settings configuration |

## Known Issues / Technical Debt

- Workspace Custom Instructions cannot be installed from project files and require manual Workspace Settings configuration.
- Skills are project-local guidance; their usefulness should be evaluated during the first Level 3 mobile consolidation task.
- A future `fnb-data-integrity` reviewer Skill may be considered after the operating model has been exercised; it is intentionally out of scope here.

## Decisions Required

- Install the proposed Custom Instructions in Workspace Settings.
- Confirm the operating model is the required process baseline for future work.

## Git Evidence

- Branch: `main`
- Setup commit SHA: recorded after the first implementation commit
- Report commit SHA: recorded after the report update commit
- Relevant earlier commits: mobile architecture reconciliation commit on `main`