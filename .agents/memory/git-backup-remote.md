---
name: gitsafe-backup remote divergence
description: Resolution of the gitsafe-backup remote conflict and why it was removed
---

The `gitsafe-backup` remote held unrelated legacy (pre-monorepo) FnB Cost Pro history on `main`, making pushes from the current monorepo `main` non-fast-forward.

**Resolution (2026-08-08):** The remote was removed from local git config (`git remote remove gitsafe-backup`). Force-push was not possible — the gitsafe server enforces two hard hook policies: append-only (no force-push) and main-branch-only (no archive branches). The legacy history remains on the gitsafe server at commit `9ef68477` ("Attach error log for debugging").

**Why:** Keeping the stale remote caused agents to fail on routine push workflows. With the remote gone, there are no more push failures. The gitsafe backup service would need an admin-level reset (outside of git commands) if backup functionality is wanted again.

**How to apply:** Do not re-add `gitsafe-backup` unless the gitsafe service has been reset to accept the current monorepo history. If backup is needed, use the `origin` GitHub remote or a fresh backup service seeded from current `main`.
