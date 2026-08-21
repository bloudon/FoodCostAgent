---
name: Gate 2 apply CLI design
description: Why a separate package-bound apply CLI exists instead of reusing the existing merge CLI for production runs.
---

# Gate 2 apply CLI design

## The rule
Production Gate 2 apply uses `vendorItemDuplicateGate2ApplyCli.ts`, NOT the existing `vendorItemDuplicateMergeCli.ts`.

**Why:** The existing merge CLI derives its own live classification and runs B→A promotion logic. The PM authorization was strictly Class A from the reviewed package, not including any promoted B groups. Using the merge CLI directly for production would include unauthorized scope.

## How it works
- `loadAndValidatePackage()` is the core — exported, testable, injectable file reader.
- Re-hashes both bound evidence files from their absolute paths stored in the package.
- Re-derives the packageId from the core (sans packageId field) using `sha256(canonicalJson(core))`.
- Explicitly rejects both Sysco held vendor-item IDs (04f822ba / ca185955) anywhere in the scope.
- Passes `expectPromotion=false` to every `applyGroup()` call — these are Class A, no promotion.

## VPS wrapper
`scripts/vps/run-vendor-item-gate2-apply.sh`:
- Phase 1 (always): dry-run, verifies live Class A ≤ 2429 and package scope 2429/6038.
- Phase 2 (VENDOR_ITEM_GATE2_APPLY=yes): apply, verifies 0 stopped groups.
- Requires `VENDOR_ITEM_BACKUP_CONFIRMED=yes` as a backup gate.
- Cross-checks `VENDOR_ITEM_GATE2_EXPECT_DB` against the package's bound database before any CLI call.

**How to apply:** The operator must supply the Gate 2 package JSON path (produced earlier by `build-vendor-item-gate2-package.sh`), set all required env vars, and run Phase 1 first. Phase 2 is gated behind explicit opt-in.
