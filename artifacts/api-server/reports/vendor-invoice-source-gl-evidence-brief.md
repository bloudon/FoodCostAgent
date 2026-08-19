# Vendor Invoice Source GL Evidence — PM Decision Brief

## Decision

The invoice workbook's **GL Code** and **Category** are immutable historical
source evidence. The invoice review screen must show them before approval and
continue to show them after approval. Missing values are valid and display as
an em dash (`—`).

## Approved storage boundary

- Parse the workbook's `GL Code` and `Category` cells.
- Retain both values on staged invoice lines.
- Return both values in the resolution preview for pending and approved batches.
- Persist both values in each approved historical invoice line's GL snapshot.
- Do not write either value to `vendor_items` or `inventory_items`.

## Explicitly out of scope

- Master accounting classification
- Company-level GL/category mappings
- Item or category overrides
- QuickBooks or accounting-export architecture

If separately approved later, the intended direction is:

`source GL/category evidence → optional company mapping → accounting/export classification`