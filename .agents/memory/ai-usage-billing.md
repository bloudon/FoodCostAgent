---
name: AI usage-based billing design
description: Commercial terms and architectural invariants for AI token metering/overage billing
---

Commercial terms (user decision, Aug 2026): 2,000,000 included tokens per company per month; overage = blended OpenAI cost prorated to overage tokens × 1.4 markup; charged on the next Stripe renewal invoice; no hard cap — instead a warning + explicit acceptance when the threshold is crossed (Replit-style).

Invariants to preserve:
- **Canonical period key**: usage periods are always UTC calendar months keyed `YYYY-MM`. Usage aggregation, per-period consent, and the Stripe billing ledger all join on this one key — never match periods by timestamp equality or by deriving windows from Stripe invoice lines.
  **Why:** an earlier design derived the billing window from the invoice's line period and matched acknowledgments by exact period_start timestamps; review showed this silently skips billing for accepted overage.
- **Charging is a durable state machine**: pending/billed/failed ledger + Stripe idempotency key `ai-overage-{companyId}-{periodKey}`. Never insert a "billed" marker before the Stripe call succeeds; failed months retry on the next renewal invoice.
- **Gate fails closed**: if the usage check errors, block paid AI requests (503), don't allow them.
- **Consent is admin-only** and only recordable while approvalRequired is true.
- Unknown models are priced at the highest known rate to avoid underbilling.

**How to apply:** any new AI feature must write to ai_token_usage (that's the sole metering source), and any new billing surface must reuse the period key + ledger rather than inventing its own window.
