---
name: Legacy scope columns and discovery predicates
description: Why exact-match predicates on later-added scope columns silently hide all pre-contract data, and the evidence-based way to widen them safely.
---

## The failure shape

When a scoping contract is introduced (e.g. source-property binding), the columns
it adds to existing tables are nullable, because rows created before the contract
have nothing to put in them. Any query that filters on those columns with an exact
match therefore splits the data into a *post-contract* era it can see and a
*pre-contract* era it cannot — and it does so **before any row is examined**, so
the operation reports a clean, successful, empty result rather than an error.

This is what made a duplicate-remediation REPORT return zero groups while the
duplicates it was looking for plainly existed. Preflight passed, scope resolution
passed, and the run "succeeded". A passing readiness check says nothing about
whether the *discovery* predicate can see the data.

**Why:** `coalesce(col, '') = :scopeValue` reads like a null-safe comparison, but a
legacy NULL coalesces to `''`, which can never equal a real bound id. The guard
that looks defensive is the exclusion.

## How to widen safely

Do NOT relax the predicate to "NULL matches anything". Unset genuinely is
ambiguous whenever more than one owner could claim the row.

Adopt an unset-scope row only when both hold:

1. **Uniqueness of owner, scoped to the right level.** Check that only one
   candidate owner exists *at the level where the ambiguity actually lives* — for
   a batch already proven to belong to a store, the remaining question is which
   property feeds *that store*, not how many bindings the company has. Scoping
   this check too broadly rejects legitimate data; too narrowly permits leakage.
2. **Positive attribution of the individual row**, from downstream evidence that
   does carry scope (e.g. every count session sourced from the batch belongs to
   this company and store, and at least one exists).

**Absence of evidence is not evidence.** A row with no downstream references
cannot be attributed and must be rejected, not assumed in-scope.

## Unify the predicate across all phases

The same scope predicate is typically duplicated across discovery, the
mutation-time authorization check, and any reconciliation. If they are separate
copies of the SQL they will drift, and the failure is asymmetric:

- discovery narrower than apply → data is mutable that was never reviewed;
- discovery wider than apply → items are found but permanently unrepairable.

Resolve scope once in a shared helper and have every phase consume its output.
When converting a fail-closed `LEFT JOIN ... IS NULL` check into a `NOT IN` over a
resolved id set, preserve two things: an empty set must mean "everything is a
violation" (not an empty `NOT IN`, which SQL evaluates the other way), and a NULL
key must fail rather than making the comparison NULL and quietly passing.

**How to apply:** any time a report/discovery pass returns a suspiciously empty
result, check the predicate funnel one condition at a time against raw columns
before touching the grouping logic. Build the diagnostic so it re-derives scope
independently of the resolver under suspicion — a shared resolver reproduces the
bug in the tool meant to find it.
