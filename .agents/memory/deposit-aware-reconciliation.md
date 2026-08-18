---
name: Deposit-aware importer reconciliation
description: Contract for explaining keg-deposit gaps in vendor-invoice XLSX imports; feeds the vendor deposit ledger.
---

**Rule:** An invoice header−lines gap may only become `explained_deposit_flow` when ALL hold: vendor has a configured effective-dated deposit rate, the rate is effective on the invoice business date, exactly one rate applies, and the gap is an exact signed integer multiple (integer-cent arithmetic). Everything else fails closed to a normal warning. Deposits are NEVER synthesized as product lines and never reach price history. Explained events are persisted on the import batch at approval (signed amount, signed keg count, rate, derivation, sourceInvoiceId); downstream ledgers consume persisted events only — never re-derive gaps.

**Why:** PM-approved bounded amendment; source-proven sign convention (positive = keg charged out, negative = credited return). Rates are per vendor (e.g. $50 Progressive, $30 City Beverages) — never hard-code.

**Ledger:** Downstream ledger idempotency keys must use the FULL persisted source-invoice identity (company + source system + source property + invoice id, mirroring historical_invoices) — a vendor can legitimately reuse an invoice number across properties, and a narrower key + ON CONFLICT DO NOTHING silently drops valid financial events. Financial evidence rows need DB-level immutability triggers, not just application convention; deletes only via a transaction-local code-owned opt-in.

**How to apply:** Rate configuration is company-admin-only and overlap-rejected atomically (per-vendor advisory lock); approval must re-read rates and re-classify under that same lock, never trust a preview snapshot, or a rate change between preview and approval leaks stale evidence. Totals sheet name tolerance: exactly one sheet named/starting with "Invoice Totals", fail closed on multiple. Duplicate-invoice identity is unchanged; a pattern-gate proposal awaits a PM decision (documented in the repo docs).
