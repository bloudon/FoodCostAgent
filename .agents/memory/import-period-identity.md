---
name: Import period identity
description: Why a batch's own date and its row dates both mislead when deciding which accounting period an import belongs to.
---

# Deciding which period an inventory import covers

A batch's stored inventory date is typically the **count-close date**, not the
period. A month-end count taken the following morning is persisted with the next
month's date. A scope check asserting that date falls inside the target month will
reject the correct batch and misread it as the following period's import.

Row-level dates mislead in the opposite direction. A source "purchase date" is when
stock was **acquired**, not when it was counted, so a correct period count legitimately
contains purchases from many earlier months and prior years. Asserting "every dated row
falls in month X" fails on structurally normal data.

**The correct test is directional: no source row may postdate period end.** That is
what an "only period X, never later" rule actually encodes. Corroborate with the source
filename and the maximum row date rather than an equality check.

**Why:** Both naive checks were written against real data and both rejected a correct,
approved batch. Only the directional check distinguishes "this period, counted late"
from "later data leaked in", which is the distinction the policy cares about.

**How to apply:** When scoping an import to an accounting period — adoption, backfill,
remediation, or a load gate — assert `max(row_date) <= period_end` plus a positive
corroborating signal. Never infer the period from the batch's own date column alone,
and never require row dates to sit inside the period.
