---
name: Orderly opaque pack continuity
description: Approved three-way compatibility rule for unsupported Orderly pack geometry and review-phase consistency.
---

Treat identical opaque geometry across vendors as continuity when the raw description and every available tier/unit fact agree. Different opaque units are incompatible. Opaque-versus-resolved geometry, incomplete unequal opaque evidence, and conflicting normalized evidence remain unknown or incompatible and must stay blocked.

**Why:** The source system can place multiple vendor products under one ingredient even when both vendor packs are represented only as the same opaque package, such as `1/1 Case`. Forking those products loses real source continuity, while equating unlike or resolved geometry invents unsupported conversion facts.

**How to apply:** Carry the same three-way result through preview, saved-decision validation, bulk actions, and approval-time under-lock revalidation. Identical opaque vendor products may share one item while retaining separate vendor relationships, prices, and incomplete geometry; never populate normalized quantity or unit price from opaque evidence.

For the same vendor and inventory item, a later opaque source row does not supersede an existing verified vendor pack. Preserve the verified geometry and normalized pricing record unchanged while importing the later row's own quantity, price, and value as source evidence. A later resolved pack that conflicts with the verified pack remains a hard conflict.

**Why:** Orderly may temporarily drop vendor-product pack detail during routine code churn and later restore the same resolved pack. Treating that silence as a contradiction discards stronger historical evidence and can abort an otherwise reviewed batch.

**How to apply:** Limit this exception to the already-resolved same vendor/item relationship with a valid verified canonical quantity. Do not apply it to cross-vendor linking, incomplete persisted packs, or resolved incoming contradictions.