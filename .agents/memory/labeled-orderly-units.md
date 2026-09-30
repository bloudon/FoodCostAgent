---
name: Orderly operational pack notation
description: How to preserve Orderly source pack labels while keeping normalized quantity and costing semantics separate.
---

Treat a container label as count geometry only when the source states the
multiplier; never infer its weight or volume. A labeled measurable token may be
normalized when both its quantity and unit are explicit, and a context-specific
single-letter unit is valid only when the label removes the ambiguity.

Treat slash values such as `1/3 GAL` as Orderly pack notation, not mathematical
fractions. Preserve the raw string as the operational display label while
keeping canonical volume units internal for quantity and cost calculations.

**Why:** `#10` states a can count but not fill weight, while `KEG 5.16G` states
an explicit gallon volume and distinguishes `G` from grams. Normalizing unit
punctuation must preserve decimal points or the stated quantity is corrupted.
The user confirmed that showing the retained `1/3 GAL` and `1/2 GAL` notation
in the mobile count index is correct; interpreting those strings as one-third
or one-half gallon would corrupt existing pack geometry and costs.

**How to apply:** accept explicit labeled quantities, strip only non-decimal
unit punctuation, and leave bare labels or content-free `Case` geometry
unknown. Keep raw pack identity independent from the normalized projection.
For display, use the raw pack label only when all mappings for the item agree;
missing or conflicting evidence must fall back to generic case/container text.