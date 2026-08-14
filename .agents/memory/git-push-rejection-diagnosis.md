---
name: Diagnosing GitHub push rejections in this workspace
description: The workspace push-error banner misreports causes, and a push can succeed on the remote even when the local command exits non-zero.
---

The workspace "PUSH_REJECTED" banner always blames remote commits missing locally. Treat that text as a placeholder, not a diagnosis — read the actual `git push` stderr instead.

**Why:** A push that was really rejected for a missing token permission (GitHub refuses to create or update `.github/workflows/*` without `workflow` scope) surfaced in the UI as a history-divergence error, which sends you toward a pull/rebase or force-push that is both unnecessary and destructive here.

**How to apply:**
- Before assuming divergence, check `git merge-base --is-ancestor <remote-sha> HEAD`. If it returns success, local is strictly ahead and a plain fast-forward push is correct — never force-push.
- Confirm token capability from the API response headers on `https://api.github.com/user` (`x-oauth-scopes`) rather than guessing; pushing anything under `.github/workflows/` needs `workflow` in addition to `repo`.
- When `git push` fails with "Invalid username or token. Password authentication is not supported", the workspace's cached git credential is dead and no git-level retry will work. The authorized GitHub *connector* is a separate, working credential path: publish individual files through its Contents API (GET for the blob sha, then PUT with `branch`) instead. This lands one file as its own remote commit and does not push local history, so say so explicitly rather than implying the branch was pushed.
- **A non-zero exit from `git push` does not mean the remote was unchanged.** In read-only (Plan) mode the objects and ref update reach GitHub first, then the local remote-tracking ref write fails on `.git/refs/remotes/origin/main.lock`. Always verify the true outcome with `git ls-remote origin refs/heads/main` before retrying, or you will re-run a push that already landed.
