---
name: Orderly→FnB costing validation constraints
description: Why Orderly recipe-cost fixtures cannot validate FnB costing on their own, and the two conversion-engine hazards any such comparison must report.
---

# Validating FnB costing against Orderly source data

## Orderly conversion appendices carry no numeric factors

Harvested Orderly "Conversions" appendices list an ingredient name and a single
converted-unit label, but the from-UOM and conversion-factor columns are empty.

**Why:** without factors, Orderly's own arithmetic cannot be replayed. Any
agreement between an FnB line cost and an Orderly displayed line cost is
coincidental, not verified. Treat matching totals as unverified.

**How to apply:** when a validation task asks whether FnB costing agrees with
Orderly, first check whether the fixture actually contains factors. If not, say
the comparison cannot judge costing, rather than reporting a variance.

## Same ingredient name appears with multiple converted units

Appendices routinely contain duplicate ingredient names mapped to different
units (e.g. a produce item as both Cup and Each), and component names can
collide with parent menu-item names.

**Why:** name-only matching silently picks the wrong conversion basis.

**How to apply:** classify these as source-data ambiguity and refuse to treat a
name match as authoritative.

## The two conversion engines disagree numerically, not just structurally

FnB has a modern per-item path and an older global-conversion path. They are not
merely different code — they return different numbers for the same inputs:

- Cross-kind volume→weight resolves via a global conversion row in one path and
  via the water-density fallback in the other, differing by roughly 4%.
- Count→volume resolves in the global-row path but is unresolvable in the
  per-item path.
- Same-kind conversions agree.

**Why:** which number a recipe gets depends on which code path executed, not on
the data. A report that only says "the paths differ" understates it.

**How to apply:** when comparing or consolidating costing paths, quantify the
divergence on cross-kind conversions specifically, and never assume the paths
are interchangeable because same-kind cases match.

## Sub-recipe cost-per-unit mixes dimensions without a check

Sub-recipe costing normalizes the child's yield through its unit base ratio and
multiplies the parent component's qty by its own base ratio, with no check that
both are the same dimension. A weight component drawn against a volume yield
produces a plausible-looking number instead of an error.

**Why:** this fails silently and is far harder to spot than an unresolved line.

**How to apply:** flag any parent/child pair whose component unit kind differs
from the child yield unit kind before trusting the resulting cost.

## No stale-price concept exists

Effective unit cost is selected with no date input and there is no unresolved
reason code for staleness, so a years-old price is used as if current.

**How to apply:** when a source system excludes a price for staleness, report it
as a source classification and note that FnB would silently use the old price;
do not infer the source system's staleness threshold.
