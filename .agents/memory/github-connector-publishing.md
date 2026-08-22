---
name: GitHub connector publishing
description: Safe repository publication when local HTTPS Git authentication fails.
---

When a verified local commit cannot be pushed because the `origin` HTTPS credential is invalid, use the attached GitHub connector's Octokit client rather than requesting or handling a personal token. First read `refs/heads/main` and require the expected reviewed parent SHA. Create blobs, a tree based on that parent, a commit, then fast-forward the branch with `force: false`.

**Why:** The connector injects an authorized credential safely, while the local Git credential may be stale or unavailable. Parent verification prevents publishing over an intervening remote change.

**How to apply:** Fetch and prune `origin` before classifying a branch as divergent; a stale tracking ref can hide an already-published mainline build. Treat the API-created commit as the published artifact; it will have a different SHA from the local commit even when the parent, message, and tree are identical. Do not reset or force-push local history until the tree equivalence and remote state are explicitly verified.