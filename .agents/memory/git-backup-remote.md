---
name: gitsafe-backup remote divergence
description: Why pushes/pulls against the gitsafe-backup remote fail and must not be forced
---

The `gitsafe-backup` remote's `main` holds an unrelated legacy (pre-monorepo) FnB Cost Pro history, so pushes from the current monorepo `main` are rejected as non-fast-forward.

**Why:** The project was rebuilt as a pnpm monorepo on a fresh history; the backup remote was never repointed. Rebasing onto it replays foreign commits and corrupts the workspace layout.

**How to apply:** Never pull from or push to `gitsafe-backup` until it is explicitly reconciled. A force-push requires an explicit user decision.
