---
name: PostgreSQL REAL money casts
description: Direct REAL-to-NUMERIC casts can fabricate rounded money mismatches in diagnostics.
---

Never compare legacy money stored as PostgreSQL `REAL` by casting it directly to `NUMERIC`; promote it to double precision first, or compare against authoritative row-level numeric evidence.

**Why:** PostgreSQL rendered the exactly representable float4 value `254299.75` as `254300` during a direct `REAL`-to-`NUMERIC` cast, causing a false 25-cent production reconciliation failure.

**How to apply:** Use `real_value::double precision` before numeric rounding or comparison, and keep persisted raw source money as the reconciliation authority. New monetary schema should avoid `REAL`.