---
name: Cross-vendor pack identity
description: PM rule for distinguishing a true pack variant from another vendor's pack of the same inventory item.
---

# Cross-vendor pack identity

A pack difference is not automatically a different inventory item. When the normalized product name matches and the vendor differs, the default outcome is one inventory item with a separate vendor-item record carrying that vendor's pack geometry and price. When the same vendor supplies genuinely different physical forms, keep separate inventory items.

Unknown or contradictory evidence still fails closed. Cross-vendor linking must not silently discard pack geometry or price, and it must not weaken the existing rule that unknown geometry cannot prove compatibility.

**Why:** PM found 39 May-to-June catalog forks where every removal paired by name with an addition. Produce and dry-goods examples were the same product from another vendor in a different pack, preventing cross-vendor price comparison. The current Orderly path creates no vendor-item records, so simply linking would lose vendor-specific evidence.

**How to apply:** Before the next Bay Hill reseed, add an explicit cross-vendor review outcome, persist a vendor-item record with vendor-specific geometry and price, default eligible different-vendor/name-matched rows toward that outcome, and show impending duplicate creation in Category 2 bulk review. Keep same-vendor minis, bottle tiers, and other genuinely distinct forms separate.