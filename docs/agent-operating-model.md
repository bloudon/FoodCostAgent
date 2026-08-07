# FnB Cost Pro Engineering Operating Model

This is the working process for significant FnB Cost Pro work. It protects approved product architecture without creating permanent organizational layers.

## External roles

- **Product Owner** — final business and product decision.
- **Primary PM / Architect** — defines significant product or architecture direction and reviews shipped work.
- **Independent Challenger** — provides a second opinion on Significant work.
- **Replit** — engineering implementation and technical review.

## Replit operational roles

Use only these three roles:

### Builder

Implements the approved task. The Builder records what shipped, deviations, tests, risks, and decisions but cannot certify its own independent review.

### Reviewer

Checks architecture, security, authentication, authorization, tenant/company/store isolation, shared contracts, data integrity, costing and valuation logic, inventory mutation semantics, and deviations from the approved task. The Reviewer may **BLOCK** work, may recommend an architecture change, and may not approve or invent new product architecture.

### QA

Checks acceptance behavior, regressions, edge cases, and test evidence. QA may **BLOCK** a task and may not waive a Reviewer block.

## Independent review rule

For Significant work:

- The Builder may not certify its own Reviewer or QA result.
- Reviewer and QA should run in fresh, separately instantiated agent workstreams or sessions when the platform supports this.
- If the platform cannot create that separation automatically, stop after the Builder phase and tell the Product Owner exactly which fresh session must be started next.
- Do not simulate independence by relabeling one continuous session.
- If separation cannot be verified, report:

  `PROCEDURAL REVIEW — INDEPENDENCE UNVERIFIED`

## Task classification

Use only two classes.

### Routine

Copy changes, styling, isolated visual fixes, and low-risk refactors with no behavioral impact.

Flow: **Build → Test → Done**

### Significant

Any work that can affect user behavior, stored data, API behavior or contracts, authentication, authorization, tenant/company/store scoping, calculations or costing, inventory mutations, schema or migrations, mobile architecture, shared contracts, vendor integrations, AI interpretation contracts, destructive changes, or another feature's behavior.

Flow: **PM decision → Build → separate Reviewer → separate QA → task report → external review**

If risk is unclear, classify the task as Significant.

## Always-active guardrails

- Never commit or expose secrets.
- Never bypass tenant, company, store, outlet, or storage-location scoping.
- Never silently change authentication contracts or approved shared contracts.
- Preserve the established `mobileToken`/WebView bridge, embedded-route whitelist, and waste voice bridge v1 unless an approved decision changes them.
- Preserve approved inventory mutation semantics, unit/pack normalization, and atomic accumulation behavior.
- Treat costing, valuation, theoretical cost, variance, and purchasing calculations as high-risk data-integrity logic.
- Preserve existing working behavior unless replacement is explicitly in scope.
- Document material deviations from the approved task.

## Skills

The retained project skills are:

- `.agents/skills/fnb-review/SKILL.md`
- `.agents/skills/fnb-qa/SKILL.md`
- `.agents/skills/fnb-mobile/SKILL.md`

Backend, web, security-review, and task-handoff guidance is now part of the active project guidance, `fnb-review`, or `fnb-mobile` where it is specifically mobile. Do not create permanent skills merely for symmetry.

## Task reports

Significant work requires a concise report using `docs/task-reports/README.md`. Routine work does not require a formal report.

The report must state Reviewer and QA outcomes separately, include whether independent session/workstream separation was **VERIFIED** or **UNVERIFIED**, and include mandatory Git evidence: Base SHA, Final SHA, and Diff/PR.

## External review

Every Significant task should receive an independent second-opinion review after the Replit Builder/Reviewer/QA cycle. Routine tasks do not require external Challenger review.

## Workspace Custom Instructions

The proposed universal guardrails are in `docs/replit-custom-instructions.md`. Installing them is a manual Product Owner action in Workspace Settings. This project cannot install them from files.

## Architecture decisions

Existing approved or pending architecture decisions remain useful historical context and are not rewritten by this process update. Reviewers may surface a proposed change, but only the Product Owner/PM approval loop can make a new product architecture authoritative.

Implementation completion is not product approval.