---
name: Bulk invoice importer PM disposition
description: Permanent contracts of the Orderly bulk invoice importer, follow-up scoping rules, and the Bay Hill production gate.
---

# Bulk invoice importer — PM disposition (2026-08-18)

The merged bulk invoice importer's review fixes are **permanent contracts** — never regress:
- backdated imports cannot replace newer current prices; dated observations are retained even when price is unchanged
- all batch operations enforce destination-store access; batch listings respect store scope
- upload and approval are race-safe/idempotent; invoice identity is vendor-scoped
- approved-batch reporting reflects persisted results; Category and GL Code retained as historical source evidence

**Why:** PM accepted the task explicitly on these terms.
**How to apply:** Treat any change weakening one of these as a scope change requiring PM sign-off.

## Follow-up dispositions
1. **Held-line resolution workflow — approved for scoping, minimal:** explicit selection of existing vendor product/inventory item, tenant/store/vendor scope validation, authorized identity mapping, link line, record dated observation. Prohibited: inventory-item auto-create, fuzzy auto-authorization, source evidence rewrite, bulk merge tooling, AI matching requirement. Must be idempotent with full provenance. Additive resolution of immutable evidence only.
2. **Messy vendor rehearsal — REQUIRED before production bulk loading.** QA/rehearsal, not a feature. Run a less-clean vendor export (split invoices, credits, freight/tax, No Account, unknown codes, pack conflicts, zero-dollar lines, reconciliation gaps) and return a PM summary (invoices/lines/dollars/match rate/holds by reason/reconciliation warnings/duplicates/observations proposed/unrepresentable shapes). Do not add code just to make the fixture green; fail-closed is acceptable.
3. **Vendor catalog deduplication — PARKED.** Never combine catalog consolidation with invoice import; it is a separate PM-gated identity program.

## Production gate
No Bay Hill production bulk invoice loading until: merged reviewer/QA pass, Community Coffee dev evidence retained, at least one messy-vendor rehearsal, and PM review of the resulting summary.
