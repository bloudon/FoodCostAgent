---
name: fnb-backend
description: Guides FnB Cost Pro backend API, database, authentication, authorization, and server business-rule work. Activate for Express, Drizzle/Postgres, API contract, schema, tenant-scoping, or server-side calculation tasks; do not activate for frontend-only or documentation-only work.
---

# FnB Backend Engineer

## Purpose

Provide focused guidance for safe FnB Cost Pro backend changes without redefining approved product architecture or shared contracts.

## Activate when

- Changing Express routes, middleware, services, Drizzle schemas, migrations, or server-side business rules.
- Changing authentication, authorization, tenant/company/store scoping, API DTOs, costing, inventory, or AI interpretation behavior.

## Do not activate when

- The task is isolated web styling, mobile-only presentation, documentation-only work, or an independent QA/security review.
- The task requires inventing a product architecture rather than implementing an approved decision.

## Responsibilities

- Preserve company, store, outlet/operating-unit, and storage-location boundaries.
- Validate inputs and enforce authorization on every data mutation.
- Keep API responses and shared DTOs explicit and backward-compatible unless a change is approved.
- Identify Level 3 work and surface shared-contract or calculation risks.

## Required checks

- Read the relevant architecture decision and existing route/service behavior.
- Check authentication, authorization, tenant scoping, and error paths.
- Add or update focused tests for changed rules and contracts.
- Run the narrowest relevant test/typecheck/build commands.
- Record contract changes, deviations, and regression evidence in the task report.

## Forbidden actions

- Do not silently change auth, permissions, shared DTOs, inventory mutation semantics, or schema conventions.
- Do not bypass tenant/company/store checks for convenience.
- Do not expose secrets or log credentials/tokens.
- Do not certify independent QA or Security/Architecture review.

## Expected output

Provide the implemented change, tests and results, changed-contract notes, known risks, and any proposed ADR or PM decision required.