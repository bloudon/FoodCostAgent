# Standard FnB Cost Pro VPS release

Use this release lane only for an already-reviewed application update that has
been published to GitHub `main`. It updates the existing `fnbcostpro` PM2
process, which serves on port `3004`.

Do not use this procedure for:

- Orderly production preflight, preview, approval, or APPLY work
- database migration operations
- a dirty VPS checkout
- the separate `kaye-api` service on port `8080`

## Routine release

On the VPS:

```bash
cd /home/administrator/apps/CostPro/fnbcostpro
scripts/vps/update-fnbcostpro-from-main.sh
```

The helper refuses a dirty checkout, fetches GitHub `main` once, captures the
resulting `origin/main` commit, switches to `main`, and fast-forwards only to
that captured commit. It never uses `git pull` or follows a later movement of
the remote-tracking branch. It installs locked dependencies, builds both the
web artifact and API, refreshes the `fnbcostpro` PM2 environment with
`PORT=3004`, verifies that PM2 itself remains configured for that port, and
then verifies both API endpoints:

```text
http://127.0.0.1:3004/api/healthz
http://127.0.0.1:3004/api/build-info
```

It also extracts the content-hashed JavaScript entry point from the generated
web `index.html`, confirms that `https://fnbcostpro.com/` serves that exact
entry point, and confirms that the public asset bytes have the same SHA-256 as
the generated file. Its final JSON record contains the Git commit, API build
identity, frontend bundle, and bundle digest that are actively serving.

The helper is intentionally bound to this exact production target:

```text
checkout: /home/administrator/apps/CostPro/fnbcostpro
GitHub origin: bloudon/FoodCostAgent
branch: main
PM2 process: fnbcostpro
API port: 3004
```

It rejects environment overrides for those values. If the deployment topology
changes, update and review the helper rather than redirecting it ad hoc.

## Pinned release

For a reviewed commit, `EXPECTED_GIT_SHA` optionally pins the helper to one
full, lowercase 40-character commit SHA. The helper validates the pin before
any release mutation, fetches once, and refuses a mismatch before switching
branches, merging, installing/building, changing `.env`, or restarting PM2.
After the fast-forward merge it verifies that `HEAD` is exactly the captured
commit (and the pin, when supplied) before proceeding.

Always run the helper body from the pinned commit itself for a pinned rollout.
Do not invoke an older helper already on the checkout: that shell can continue
executing the old body even after an update advances the checkout. From the
application checkout, copy and run this whole block. It uses a strict Bash
child, so a refusal prints `STOP` and does not close the operator's parent SSH
shell:

```bash
bash -s <<'BASH'
set -Eeuo pipefail

EXPECTED_GIT_SHA=0123456789abcdef0123456789abcdef01234567
readonly EXPECTED_HELPER_SHA256=45fc12b77356dc47b7197705b3a1a5e05ad2337b1510058d030be5a7490796de

stop() {
  printf 'STOP: %s\n' "$*" >&2
  exit 1
}

[[ "$EXPECTED_GIT_SHA" =~ ^[0-9a-f]{40}$ ]] \
  || stop "EXPECTED_GIT_SHA must be exactly 40 lowercase hexadecimal characters."
git fetch --prune origin \
  || stop "Could not fetch origin; no release helper was run."

origin_sha="$(git rev-parse --verify 'refs/remotes/origin/main^{commit}')" \
  || stop "Could not resolve origin/main; no release helper was run."
[[ "$origin_sha" = "$EXPECTED_GIT_SHA" ]] \
  || stop "Fetched origin/main does not equal the reviewed commit."
pinned_commit="$(git rev-parse --verify "${EXPECTED_GIT_SHA}^{commit}")" \
  || stop "The reviewed commit is unavailable locally; no release helper was run."
[[ "$pinned_commit" = "$EXPECTED_GIT_SHA" ]] \
  || stop "The resolved commit does not exactly equal EXPECTED_GIT_SHA."

helper_file="$(mktemp /tmp/fnbcostpro-release-helper.XXXXXX)" \
  || stop "Could not create a temporary helper file."
trap 'rm -f "$helper_file"' EXIT
git show "${EXPECTED_GIT_SHA}:scripts/vps/update-fnbcostpro-from-main.sh" \
  > "$helper_file" \
  || stop "Could not extract the pinned helper; no release helper was run."
[[ -s "$helper_file" ]] \
  || stop "The extracted pinned helper is empty; no release helper was run."
chmod 700 "$helper_file" \
  || stop "Could not secure the temporary helper; no release helper was run."
actual_helper_sha256="$(sha256sum "$helper_file" | awk '{print $1}')" \
  || stop "Could not verify the extracted helper checksum."
[[ "$actual_helper_sha256" = "$EXPECTED_HELPER_SHA256" ]] \
  || stop "Pinned helper SHA-256 mismatch; no release helper was run."

if EXPECTED_GIT_SHA="$EXPECTED_GIT_SHA" bash "$helper_file"; then
  printf '%s\n' "Pinned release helper completed."
else
  helper_status=$?
  stop "Pinned release helper refused or failed (status ${helper_status})."
fi
BASH
```

Replace the example SHA with the reviewed full commit. The block requires that
exact commit to be `origin/main`, verifies that `git show` produced a nonempty
helper body with the reviewed helper SHA-256 shown above, and cleans up the
temporary file on success or refusal. The extracted pinned helper then fetches
again and independently requires `origin/main` to still resolve to that same
commit. Never fall back to the checkout's helper.

The commit gate does not change database safety requirements. This release lane
does not run explicit database migration or `db:push` commands, but restarting
the API can execute the application's existing idempotent startup schema
checks. Any new or non-idempotent startup DDL still requires its separate
review/authorization and required production backup/recovery point before
rollout; any candidate change involving startup DDL (including idempotent DDL)
remains subject to those existing gates. The pin gate does not change or waive
the startup-DDL and backup requirements. This helper is not approval for DDL
or a substitute for that backup.

## Stop conditions

Stop rather than bypass a failure when:

- `git status` is not clean
- `origin/main` does not match `EXPECTED_GIT_SHA` when pinned
- the captured commit or resulting `HEAD` does not match expectations
- the captured commit cannot fast-forward
- PM2 is not running this checkout's `artifacts/api-server/dist/index.mjs`
- the API build fails
- the frontend build fails
- the public site does not serve the newly generated frontend bundle
- either verification endpoint fails or the returned build ID differs

Do not use `git reset`, `git pull --rebase`, `git stash`, a force-push, or the
old `deploy-reviewed-orderly-preflight.sh` script to work around these checks.
Resolve the branch or process mismatch first.