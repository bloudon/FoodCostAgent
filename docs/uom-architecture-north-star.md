# FnB Cost Pro — UOM architecture north star

**Status:** Reference for product and engineering decisions. This records the approved boundaries and the limits of current evidence; it does **not** approve a unit migration, historical-count correction, production rollout, or new UOM subsystem.

**Use for:** inventory setup, Orderly imports, purchasing, counting, receiving, valuation, recipes, and changes to item units or pack sizes. The detailed investigation remains in the [UOM architecture recovery audit](uom-architecture-recovery-audit.md). Product decisions outrank current implementation; retained source evidence outranks assumptions about a pack.

## Four distinct concepts

> Store inventory in a stable product unit. Buy it through vendor-specific packs. Let the kitchen use whichever practical units it needs.

That is the [PM-approved principle](../attached_assets/Pasted--PM-verdict-Do-not-approve-722-as-written-Approve-the-s_1785429309991.txt) (lines 540–563). It rejects making one vendor's case the inventory item's identity or costing anchor.

| Concept | Meaning and owner | Not automatically |
| --- | --- | --- |
| **Canonical inventory unit** | One vendor-independent unit per item for stored on-hand quantity and per-unit valuation. | A vendor case or the employee's count input. |
| **Vendor purchase pack** | A supplier product's orderable unit, outer/inner pack geometry, price basis, and provenance. An item can have multiple vendor packs, including different case sizes. | The item's canonical identity or its current physical count configuration. |
| **Physical count configuration** | The item's verified operational case, countable container/package, fractions, and conversion to canonical quantity. | A recipe measurement or the newest imported vendor pack. |
| **Recipe / issue unit** | Item-specific units for kitchen consumption or operational issue, converted against the canonical item unit under their respective rules. | A purchasing unit or physical count input. Recipe and issue capabilities are distinct. |

These are existing boundaries, not a proposed replacement model: [inventory item and operational geometry](../lib/db/src/schema/schema.ts) (lines 423–450), [count lines](../lib/db/src/schema/schema.ts) (lines 841–855), and [recovery audit §1](uom-architecture-recovery-audit.md). Before adding a Count Unit field or generalized conversion model, PM requires showing why the existing item/package definitions cannot meet the need ([unit-integrity direction](../attached_assets/Pasted--PM-Direction-Unit-Integrity-and-August-Counting-Decisi_1789614586048.txt), lines 39–45).

## Operational rules

1. **Staff count identifiable physical things.** With verified package geometry, offer cases, containers, and permitted fractions—not oz or mL just because the canonical unit is oz or mL. Genuinely bulk/catch-weight items require an explicit appropriate input, not a fictional fixed container. Existing input modes distinguish package, direct, catch, and unconfigured ([count quantity service](../artifacts/api-server/src/services/inventory/countQuantity.ts), lines 59–87; [audit §4](uom-architecture-recovery-audit.md)).
2. **The server converts package entries to canonical quantity.** With valid geometry: `case count × packages per case × canonical units per package + individual package count × canonical units per package`. Fractions use the same verified factor. Retain entry parts as evidence, and store the result in the item's canonical unit. Missing or contradictory geometry must not silently read 5.5 bottles as 5.5 mL. PM's acceptance example is **5.5 bottles × 750 mL = 4,125 mL** ([direction](../attached_assets/Pasted--PM-Direction-Unit-Integrity-and-August-Counting-Decisi_1789614586048.txt), lines 13–21, 47–56).
3. **Prices retain their basis.** A $203.16 case of 12 bottles is $16.93/bottle; only verified 750 mL bottles support a derived price of approximately $0.022573/mL. Do not display purchase-unit cost as canonical-unit cost without conversion. Receiving and WAC must use actual canonical received quantity and extended value, not an unverified pack estimate ([direction](../attached_assets/Pasted--PM-Direction-Unit-Integrity-and-August-Counting-Decisi_1789614586048.txt), lines 23–29, 49–56; [audit §§1, 6](uom-architecture-recovery-audit.md)).
4. **A supplier pack is not a count-standard switch.** `4 × 5 lb` and `1 × 5 lb` can both be real supplier packs of one product. Neither erases the other's historical meaning. A current count standard needs verified item-level physical geometry and an evidenced operator decision, not an inference from the newest import. Existing [supplier-pack history](../artifacts/fnb-cost-pro/src/components/supplier-pack-history.tsx) (lines 193–216) distinguishes dated transitions from saved counts. The current item model supports one primary operational count configuration at a time; multiple simultaneous configurations are **not an approved assumption** ([audit §4](uom-architecture-recovery-audit.md)).
5. **Kitchen conversions stay separate.** A recipe can use ounces of an item stored in pounds without turning ounces into the physical count input. Do not infer weight-to-volume or a weight for a mixed-content case without item-specific evidence ([audit §§1, 3](uom-architecture-recovery-audit.md)).

## Orderly and historical count contract

- Retain the original source row and pack notation, parsed outer/inner/base geometry, item identity, Case/Pack/UOM count tiers, source-computed total, and value ([import-row schema](../lib/db/src/schema/schema.ts), lines 2737–2795). A reused code does not establish identical pack geometry.
- **Reconcile each historical count to its dated source evidence**, not today's `caseSize`: source row and pack, tier meanings, unit identity, source total, value, and any row-to-item/location aggregation. The [historical count path](../artifacts/api-server/src/services/orderly/orderlyCountSession.ts) (lines 694–711, 1258–1318) uses source `totalUnits` (or a tier fallback), retains tier parts, and merges rows by item/location; it does not multiply an old case by today's item size.
- Answer three questions separately: **(a)** Was the dated source faithfully represented in the saved count? **(b)** Is the saved numeric quantity actually in the saved line's declared unit? **(c)** What physical package should staff count *now*? A source row may establish (a) without establishing (b) or (c). Source `totalUnits` is not by itself proof of the unit claimed by the saved line.
- New manual package entries can retain their actual conversion in `countPackSnapshot` ([count quantity service](../artifacts/api-server/src/services/inventory/countQuantity.ts), lines 16–37). Legacy/imported lines can lack that snapshot ([count-line schema](../lib/db/src/schema/schema.ts), lines 841–855). Their parts and retained source are evidence, **not** permission to divide them by today's container size. A changed case size governs future entries; it neither rewrites nor automatically invalidates a prior count. Hold only specific rows whose dated source-to-saved meaning cannot be reconciled, and name the missing evidence.
- Preserve historical source, quantity, and value. Any proposed correction requires separate review and authorization; this reference supplies none.

### American Yellow Sliced: an investigation, not a conversion order

The [Bay Hill remaining-count register](../reports/bay-hill-remaining-count-review-2026-09-28.csv) records `1/5 LB` source rows with Orderly totals of 5 and 22.5, while corresponding saved quantities are labeled in oz (and a 3-loose-LB source row has a saved numeric quantity of 3 oz). This is a **potential unit-identity discrepancy**. Trace the raw rows, tier/`totalUnits` semantics, mapping and aggregation, saved `unitId`, and valuation before judging correctness. Do **not** multiply counts by 16, change the item unit, or alter approved value on this observation alone. The alternative `4/5 LB` purchase pack does not itself invalidate the older `1/5 LB` source counts.

## Canonical-unit selection: decision boundary

The approved model requires a stable, vendor-independent inventory/valuation basis—not copying the first unit token from a purchase pack. A later [Bay Hill countability worklist](../attached_assets/Pasted--Count-Unit-Should-Follow-How-Staff-Count-Not-How-The-P_1790216183897.txt) (lines 9–16, 35–94) argues that discrete products such as bags, muffins, and bottles should be counted as items rather than assigned oz/mL solely from pack notation. It also uses “canonical unit” to mean what a person picks up. **This terminology conflicts with treating canonical storage and physical count entry as always separate.** Treat the worklist's proposed defaulting rule as an item-classification proposal requiring review, not authorization to bulk-rewrite approved inventory units or histories. The legitimate concern about inappropriate oz/ml assignments remains.

For each item, decide with evidence whether stable stock/valuation should be in each, weight, or volume, and define its physical packages separately. If the intended basis conflicts with saved data, review every dependent quantity, cost, count, receipt, and recipe before any migration. The PM's four-five-pound-bag example establishes the architecture; **the reviewed sources do not specifically authorize converting American Yellow Sliced from oz to lb**.

**Still open:** the intended canonical unit of particular disputed items; interpretation of opaque or contradictory historical tiers; whether any item truly needs multiple simultaneous physical count configurations; and any item-specific historical correction. None can be resolved from a generic pack-size conflict alone.

## Checklist before changing a UOM

1. Identify the item, supplier products, dated source rows, and pack identities; distinguish source pack from item identity.
2. State canonical inventory unit, physical counting package/fractions, vendor purchase packs, and recipe/issue units **separately**.
3. Prove conversion and price factors with complete source geometry; leave variable-weight and opaque packs unresolved without actual evidence.
4. Check imports, web/mobile counts, count history, purchasing, receiving, WAC/on-hand, valuation, recipes, and issues/transfers for unit and price-basis continuity.
5. Reconcile saved unit identity, source tiers/totals, snapshots where present, aggregation, and extended value before proposing any historical correction.
6. Verify the actual signed-in workflow and relevant unit/valuation tests before calling a rollout accepted. A code-path review or a read-only register is not production acceptance.

**Not authorized by this document:** choosing today's pack from historical vendor rows alone; silently ratifying ambiguous counts; introducing a Count Unit subsystem; migrating canonical units; rewriting May–July imports or saved counts; or changing production data.