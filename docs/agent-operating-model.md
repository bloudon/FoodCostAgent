# FnB Cost Pro Agent Operating Model

This document defines how future agent work is scoped, implemented, reviewed, and handed off for external PM review. It is a working process guide, not a replacement for approved product architecture.

## Source-of-truth layers

1. **Git source code** is the truth for what is implemented.
2. **`replit.md`** contains durable project architecture decisions, domain conventions, approved contracts, and concise implementation notes.
3. **Workspace Custom Instructions** contain universal engineering guardrails. The proposed text is in `docs/replit-custom-instructions.md`; installing it requires Workspace Settings access.
4. **Focused project Skills** contain role-specific playbooks and activate only for relevant work.
5. **`docs/task-reports/`** contains one completion report for each meaningful Level 2 or Level 3 implementation task.

Do not copy detailed architecture, task reports, and operating instructions into every layer.

## Roles

### Integration Lead

Owns the approved task handoff, dependency analysis, workstream sequencing, integration, and confirmation that required reviews are complete. The Integration Lead coordinates work but does not override approved architecture or approve a new product decision.

### Backend Engineer

Owns Express APIs, Drizzle/Postgres, schemas and migrations, authentication implementation, authorization, tenant/company/store scoping, server-side business rules, and API contracts. Backend work must follow approved shared contracts and must surface proposed contract changes for approval.

### Web Engineer

Owns the React web application, management workflows, responsive web UX, shared web components, and browser-specific behavior. Web work follows the approved native-versus-embedded ownership model and embedded route contracts.

### Mobile Engineer

Owns Expo/React Native, native navigation, camera, microphone, scanning, SecureStore, WebView bridge implementation, and mobile-specific UX. Mobile work follows the approved native-versus-embedded architecture and must preserve reviewed mutation semantics.

### QA / Regression Engineer

Independently owns acceptance testing, regression testing, edge-case verification, and evidence that implementation satisfies the task. QA does not merely restate the implementer's test results and must record a review outcome.

### Security / Architecture Reviewer

Independently reviews authentication, authorization, tenant/company/store isolation, token handling, shared API contracts, migrations, cross-artifact architecture, security-sensitive WebViews, and breaking changes. Reviewers may recommend an architectural change or block completion, but may not approve or invent a new product architecture. Proposed changes return to the Product Owner/PM approval loop.

## Approval classes

### Level 1 — routine

Examples include copy changes, isolated styling, minor UI bugs, and low-risk refactors.

Required: implementation and basic validation.

### Level 2 — product behavior

Examples include new workflows, new API endpoints, meaningful mobile/web UX, integration changes, and AI behavior.

Required: implementation, independent QA review, and a task completion report.

### Level 3 — architecture, security, data integrity, financial calculations, destructive changes, or shared contracts

Examples include:

- Authentication, permissions, and tenant isolation
- Schema changes and destructive migrations
- Shared API contracts, mobile architecture, WebView authentication, and mobile bridges
- Inventory mutation semantics
- Recipe costing, theoretical food cost, inventory valuation, purchase-unit conversions, pack normalization, variance calculations, waste valuation, and predictive ordering math
- Vendor integrations and AI interpretation contracts

Required: approved architecture decision before implementation, implementation, independent QA review, independent Security/Architecture review, and explicit PM/user review before destructive cleanup or merge when requested. Passing tests does not constitute architecture approval.

## Shared-contract rule

Implementation agents may not casually change authentication contracts, company/store permission models, `mobileToken` or WebView authentication, embedded route contracts, mobile voice bridges, inventory mutation semantics, shared API DTOs, schema conventions, or cross-artifact interfaces.

When an approved contract appears insufficient:

1. Stop short of silently changing it.
2. Document the conflict and affected behavior.
3. Produce a proposed ADR or architecture-decision update.
4. Mark it as requiring Product Owner/PM approval.

## Independent review rule

An implementation workstream may not certify itself as having completed independent QA or Security/Architecture review. Completion evidence should identify the workstreams separately:

```text
Implemented by: Mobile workstream
QA reviewed by: QA / Regression workstream
Architecture reviewed by: Security / Architecture workstream
```

## Review outcomes and blocking behavior

Use exactly one of these outcomes for each applicable review:

- `PASS` — no blocking findings.
- `PASS WITH FOLLOW-UP` — safe to proceed, with a documented non-blocking follow-up.
- `BLOCKED` — completion or merge must not proceed until the finding is resolved or the approval path changes.
- `NOT APPLICABLE` — the review genuinely does not apply; explain why.

QA and Security/Architecture reviewers may block a task. The Integration Lead must record the finding, prevent completion while it is unresolved, and route any architecture change for approval rather than treating a reviewer recommendation as approval.

## Parallel work

Parallelize only genuinely independent workstreams. Establish shared interfaces and approved contracts first. Good candidates include an independent backend endpoint and UI consumer, mobile and web consumers of an approved API contract, or implementation and independent test creation. Do not parallelize tightly coupled design decisions that could create competing contracts.

## Merge gates

Before recommending completion of a Level 3 task:

1. Implementation is complete.
2. Relevant automated tests pass.
3. Independent QA regression review is complete.
4. Independent Security/Architecture review is complete.
5. No unexplained deviations from approved architecture remain.
6. The task completion report is written.
7. The `replit.md` implementation note is updated when applicable.
8. Remaining PM/user decisions are explicitly marked.

Do not delete or quarantine replaced implementations until the required regression gate passes and the cleanup is explicitly in scope.

## ADR convention

Future architecture decisions use sequential identifiers:

```md
### ADR-004 — Mobile WebView Authentication

Date: 2026-08-07
Status: Proposed

#### Decision
...
```

Allowed statuses are `Proposed`, `Approved`, and `Superseded`. Existing architecture decisions are not rewritten solely to fit this convention. A new ADR becomes authoritative only after the required Product Owner/PM approval.

## External PM handoff

1. The Product Owner/PM approves an architecture decision or task.
2. Replit implements the approved scope.
3. Replit writes the task completion report.
4. Replit commits and publishes the result.
5. The PM reviews the task report, architecture decision, and relevant diff/code.
6. Findings return as a new approved task or architecture decision.

Implementation completion is not product approval.