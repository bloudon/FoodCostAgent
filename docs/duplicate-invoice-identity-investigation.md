# Duplicate invoice identity — investigation (Task #1183, for PM review)

**Status: investigation only. No contract change was made.** The importer's
dedupe identity remains `vendor + invoice number` exactly as shipped in the
Orderly importer. This document records the evidence from the Progressive
Distribution rehearsal export and proposes a deterministic identity for PM
review before any change is considered.

## Evidence (Progressive_Distribution_Line_Items2 export, Sep 2025–Jul 2026)

The `Invoice Totals` sheet contains a genuine duplicate pair:

| Invoice # cell (verbatim)   | Date       | Amount  | Lines under this id |
|-----------------------------|------------|---------|---------------------|
| `W-239314`                  | 2025-10-01 | $300.00 | (lines under W-239314) |
| `2025-10-01 (DUPLICATE)`    | 2025-10-01 | $300.00 | 1                   |

Key observations:

1. **The source system itself flagged the duplicate** — the second row's
   Invoice # cell literally reads `2025-10-01 (DUPLICATE)`, i.e. the export
   substituted a date-plus-label string for the invoice number.
2. Because the label string differs from `W-239314`, the current
   `vendor + invoice number` dedupe treats the pair as **two distinct
   invoices**. In the rehearsal both imported (25 invoices persisted), with the
   labeled row importing under the literal string as its "invoice number".
3. The two rows are indistinguishable on date and amount alone; the only
   distinguishing source fields are the Invoice # text itself and the line
   membership beneath each id.

## Risk of the current identity

- A re-export that renames or drops the `(DUPLICATE)` label would change the
  identity string and could double-import or orphan the labeled row.
- Any source row whose Invoice # cell is not a stable document number (dates,
  labels, blanks made unique by suffixing) silently becomes its own identity.

## Proposed deterministic identity (for PM review — NOT implemented)

Treat an invoice's import identity as:

```
vendor + normalized invoice number,
where a row whose Invoice # does not match the vendor's document-number shape
(e.g. Progressive: /^W-\d+$/) is quarantined for manual review instead of
being adopted as an identity.
```

Concretely:

1. **Pattern gate (per vendor, configurable):** rows whose Invoice # fails the
   vendor's document-number pattern are staged but flagged
   `identity_unverified`, excluded from auto-approval, and surfaced in the
   review UI with their date/amount/line evidence.
2. **Duplicate detection stays fail-closed:** a flagged row that matches an
   existing invoice on (vendor, date, amount) is presented as a *suspected
   duplicate of* that invoice; the reviewer decides merge vs. import.
3. **No synthetic identities:** never derive an identity from date+amount —
   two same-day, same-amount deliveries are legitimate at beer vendors.

## Decision needed from PM

- Approve/deny the pattern-gate + manual-review approach above.
- If approved, per-vendor pattern configuration source (binding metadata vs.
  vendor record) and the review-UI surface are follow-up scope, not part of
  #1183 or #1182.
