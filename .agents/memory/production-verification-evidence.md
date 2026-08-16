---
name: Production verification evidence hygiene
description: Why raw VPS terminal pastes fail completion review as evidence, and what a production confirmation record must contain instead.
---

## The rule

A production verification task's deliverable is a **sanitized, structured record**, not the
terminal output that produced it. Raw pastes of production CLI runs must not be committed
to the repository as evidence.

**Why:** verbatim output from this project's production runs carries inventory pricing,
quantities, storage-location names, internal entity ids, import-batch ids, and VPS
host/path context. None of it is a credential, so no secret scanner objects — but it is
confidential operational data, and completion review rejects it as unnecessary disclosure.
An unstructured paste also fails on substance: it proves a command ran, not that the right
tenant was checked or that the result passed.

## What the record must state

- The tenant/location by name, and that the run was scoped to it.
- When it ran and against which build.
- Which commands ran, in order, and which deliberately did **not** (for read-only
  confirmations, say plainly that no manifest/apply was invoked).
- Aggregate numbers **reconciled against the scope**. A large group count on a
  single-location confirmation looks like an unscoped platform-wide query unless the
  record explains that the scope legitimately contains that many groups.
- An explicit pass/fail conclusion, and — when the report classifies something as safe —
  why, plus a note that the classification is not an authorization to mutate.

## How to apply

Ask the operator for the narrow slice of output needed (a funnel, a verdict line, specific
totals), transcribe the findings into the task report, and keep the raw text out of version
control. If a paste was already committed, remove it from the working tree and from any
branch that will be pushed; do not rewrite the workspace checkpoint branch to scrub it,
since that destroys the user's rollback history — note the residual location in the report
instead.

## CLI working-directory guard

When invoking a package-filtered CLI, pnpm runs the script from the package directory rather than the repository root. Production operator commands must use an absolute manifest path (or the correct relative path from `artifacts/api-server`) and checksum the file before and after.

**Why:** the first approved preflight attempt failed with ENOENT before evaluation solely because a repository-root-relative manifest path was resolved from the package working directory.

**How to apply:** prefer `/home/administrator/apps/CostPro/fnbcostpro/reports/...` for VPS evidence commands; treat ENOENT as a failed preflight, not as evidence about the database.
