---
name: Labeled Orderly unit normalization
description: How to recover explicit count or measure evidence from labeled unit tokens without inferring container contents.
---

Treat a container label as count geometry only when the source states the
multiplier; never infer its weight or volume. A labeled measurable token may be
normalized when both its quantity and unit are explicit, and a context-specific
single-letter unit is valid only when the label removes the ambiguity.

**Why:** `#10` states a can count but not fill weight, while `KEG 5.16G` states
an explicit gallon volume and distinguishes `G` from grams. Normalizing unit
punctuation must preserve decimal points or the stated quantity is corrupted.

**How to apply:** accept explicit labeled quantities, strip only non-decimal
unit punctuation, and leave bare labels or content-free `Case` geometry
unknown. Keep raw pack identity independent from the normalized projection.