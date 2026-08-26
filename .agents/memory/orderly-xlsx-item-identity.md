---
name: Orderly XLSX item identity
description: How a reliable Orderly XLSX Item Code establishes one FnB inventory item, and why the mapping row (not the resolution logic) must be the identity authority.
---

# Orderly XLSX item identity

A reliable XLSX **Item Code is authoritative only within the authorized company + Orderly source property** context. It must resolve or create exactly one inventory item while preserving every per-location count row.

**Why:** one source product counted in several physical locations was creating a separate inventory item per location, corrupting on-hand and cost totals.

**How to apply:** scope external mappings by `(company, source system, source property, external code)`. Company-only scoping lets two authorized properties in one company collide on the same code.

## The XLSX code is not the API identity

The Orderly *API* identity is `ORDERLY + sourcePropertyId + packSize.id`. The XLSX Item Code is a different namespace and must never be written into or matched against the API identity, even though both live in the same mappings table.

## The mapping row is the identity authority

Every reliable-code resolution path — batch cache, group-wide safe match, manual override, confident auto-match, and new-item creation — must settle through the committed mapping inside the approval transaction: adopt an existing mapping, else claim one with insert-first `ON CONFLICT DO NOTHING`, else adopt the race winner.

**Why:** guarding only the *creation* branch is insufficient. Two concurrent approvals can each match the same code to two *different pre-existing* items; one mapping survives while the other batch's rows stay linked to a different item. A mapping committed between preview and approval must also be adopted.

**How to apply:** when a claim loses the race, only delete the candidate item **if this transaction just created it** and it differs from the winner. Deleting unconditionally destroys a pre-existing catalog item. Guard the delete on a `created` flag, not on a comment promising the invariant.

## Code reliability is a gate before mapping

Only a compact, vendor-code-like XLSX Item Code may create a durable Orderly mapping. Free-text labels or shorthand placed in the Item Code column are review evidence, not identity; they must block approval until corrected and may never create either a raw-code or derived name-and-pack mapping.

**Why:** source exports can put product descriptions into the code field. Treating that prose as a code silently makes a weak name match permanent and prevents later correction.

**How to apply:** classify reliability during preview, return it to the reviewer UI, and enforce the same classification again before every mapping/derived-identity write. Keep source pack contradictions as a separate, pre-transaction approval blocker.

## Identity stability

Location, month/file, vendor, pricing, par/target, and ordinary count changes never alter core identity. Conflicts stay narrow: materially different product evidence, incompatible case geometry, or incompatible base units.

- Partial-count notation (`6/6 ML`, `6/0.3 ML`, `6/0 ML`) is a fractional count, **not** a geometry difference — it must not conflict. Exclude inner-pack values from compatibility.
- Compare **all row pairs**, not each row against the first. A no-evidence first row makes two mutually incompatible later rows each look compatible.
- Blank codes stay unresolved unless a safe existing match exists. Never invent a synthetic item from a blank code.

## Derived product evidence for location siblings

When an Orderly export omits a code, group rows by normalized cleaned product name plus complete, canonicalized pack evidence. A blank-code row may follow one unambiguous coded sibling or a previously confirmed `ALT|<name>|<pack>` mapping; it may never independently create a catalog item.

**Why:** Orderly represents one physical product across storage locations, sometimes with a blank-code sibling. Name-only matching would merge meaningful variants, while row-level processing either creates duplicates or leaves a known sibling behind.

**How to apply:** persist derived identities in the existing property-scoped external-mapping table, keep real Item Codes in their own namespace, and fail closed if a derived mapping is already confirmed for a different canonical item. Supplier is supporting evidence only, never part of the alternate identity.

## Gate before loading history

Do not load the Aug 2025–Jul 2026 Bay Hill history until a read-only preview is reviewed. A preview showing `existingItemResolutions: 0` with thousands of `proposedNewItemCreations` means the batch would seed the catalog from scratch — that needs Product Owner sign-off, not an approval click.
