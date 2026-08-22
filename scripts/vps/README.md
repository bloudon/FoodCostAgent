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

The helper refuses a dirty checkout, fetches GitHub `main`, performs only
`git pull --ff-only origin main`, installs locked dependencies, builds the API,
refreshes the `fnbcostpro` PM2 environment with `PORT=3004`, verifies that
PM2 itself remains configured for that port, and then verifies both endpoints:

```text
http://127.0.0.1:3004/api/healthz
http://127.0.0.1:3004/api/build-info
```

Its final JSON record contains the Git commit and build identity that are
actively serving.

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

## Stop conditions

Stop rather than bypass a failure when:

- `git status` is not clean
- the pull cannot fast-forward
- PM2 is not running this checkout's `artifacts/api-server/dist/index.mjs`
- the API build fails
- either verification endpoint fails or the returned build ID differs

Do not use `git reset`, `git pull --rebase`, `git stash`, a force-push, or the
old `deploy-reviewed-orderly-preflight.sh` script to work around these checks.
Resolve the branch or process mismatch first.