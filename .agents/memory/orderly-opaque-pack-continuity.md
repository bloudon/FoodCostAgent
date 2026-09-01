---
name: Orderly opaque pack continuity
description: Approved three-way compatibility rule for unsupported Orderly pack geometry and review-phase consistency.
---

Treat identical opaque geometry across vendors as continuity when the raw description and every available tier/unit fact agree. Different opaque units are incompatible. For measurable evidence, compare normalized base-unit quantity rather than requiring identical case/inner-pack tiers: a different purchasing configuration of the same measurable unit can be compatible. Opaque-versus-resolved geometry remains blocked only when no resolved measurable evidence can confirm the catalog identity or quantity.

**Why:** The source system can place multiple vendor products under one ingredient even when both vendor packs are represented only as the same opaque package, such as `1/1 Case`. Forking those products loses real source continuity, while equating unlike geometry invents unsupported conversion facts. But `LB` is itself measurable: a 1/15 LB or 1/30 LB purchase pack can confirm an existing 240 OZ catalog quantity even if a prior export incorrectly persisted `1/1 Case`; the case/pack shape is not the identity.

**How to apply:** Carry this distinction through preview, saved-decision validation, bulk actions, and approval-time under-lock revalidation. Resolve measurable units to canonical base units and compare totals; retain separate vendor relationships and prices for distinct purchase packs. Never populate normalized quantity or unit price from opaque evidence alone, and never let an opaque historical row veto independently resolved compatible evidence.

For the same vendor and inventory item, a later opaque source row does not supersede an existing verified vendor pack. Preserve the verified geometry and normalized pricing record unchanged while importing the later row's own quantity, price, and value as source evidence. A later resolved pack with a different measurable purchase configuration is compatible when its canonical total matches the catalog; a genuinely different resolved total remains a hard conflict.

**Why:** Orderly may temporarily drop vendor-product pack detail during routine code churn and later restore measurable pack detail. Treating source silence or a changed case/pack configuration as a contradiction discards stronger historical evidence and can abort an otherwise reviewed batch.

**How to apply:** Limit this exception to measurable, canonical-unit-compatible evidence for the same reviewed item/property scope. Do not apply it to cross-vendor linking without identity evidence, incomplete persisted packs, or resolved incoming totals that disagree with the catalog.