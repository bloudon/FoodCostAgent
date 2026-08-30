# Orderly production preflight — VPS operator commands

This is the operator handoff for the reviewed, read-only production preflight.
Replit does not connect to the production VPS. The production operator runs
these commands and returns only the sanitized JSON report.

## Fixed reviewed identity

```text
Git SHA:       7c8f75f750602cc7227a807bf6dbc10fd141fa15
API version:   1.15.0
APP_BUILD_ID:  api@1.15.0:7c8f75f750602cc7227a807bf6dbc10fd141fa15
Property:      24472
```

Do not substitute another branch, Git SHA, API version, or build ID. Replace
only values shown as `<...>` below with the reviewed production values.

## 1. Transfer and verify the operator bundle

Run this from a reviewed checkout containing `scripts/vps/`:

```bash
export REPLIT_CHECKOUT='<absolute-path-to-reviewed-checkout>'
export VPS_HOST='<production-vps-host>'
export VPS_USER='<production-vps-user>'
export VPS_SSH_PORT='<production-ssh-port>'
export OPERATOR_DIR='/secure/orderly-operator-scripts'

ssh -p "$VPS_SSH_PORT" "$VPS_USER@$VPS_HOST" \
  "mkdir -p '$OPERATOR_DIR' && chmod 700 '$OPERATOR_DIR'"

scp -P "$VPS_SSH_PORT" \
  "$REPLIT_CHECKOUT/scripts/vps/deploy-reviewed-orderly-preflight.sh" \
  "$REPLIT_CHECKOUT/scripts/vps/run-orderly-production-preflight.sh" \
  "$REPLIT_CHECKOUT/scripts/vps/summarize-orderly-production-preflight.mjs" \
  "$REPLIT_CHECKOUT/scripts/vps/SHA256SUMS" \
  "$VPS_USER@$VPS_HOST:$OPERATOR_DIR/"

ssh -p "$VPS_SSH_PORT" "$VPS_USER@$VPS_HOST" \
  "cd '$OPERATOR_DIR' && sha256sum -c SHA256SUMS && chmod 700 *.sh && chmod 600 SHA256SUMS summarize-orderly-production-preflight.mjs"
```

Expected checksum output:

```text
deploy-reviewed-orderly-preflight.sh: OK
run-orderly-production-preflight.sh: OK
summarize-orderly-production-preflight.mjs: OK
```

If any checksum fails, stop. Do not run either script.

## 2. Inspect the VPS before deployment

Run on the VPS:

```bash
export APP_DIR='<absolute-production-checkout-path>'
export API_PORT='<existing-local-api-port>'
export PM2_NAME='fnbcostpro'
export VPS_ENV_FILE="$APP_DIR/.env"

cd "$APP_DIR"
git status --short
git rev-parse HEAD
pm2 jlist | node --input-type=module -e '
  import fs from "node:fs";
  const apps = JSON.parse(fs.readFileSync(0, "utf8"));
  const app = apps.find((candidate) => candidate.name === process.env.PM2_NAME);
  if (!app) throw new Error("PM2 process not found");
  console.log(JSON.stringify({
    name: app.name,
    cwd: app.pm2_env?.pm_cwd,
    execPath: app.pm2_env?.pm_exec_path,
    status: app.pm2_env?.status,
  }, null, 2));
'
```

Expected pre-deployment conditions:

- `git status --short` is empty.
- The PM2 process exists, is online, and its `cwd` is `APP_DIR`.
- Its entrypoint is `APP_DIR/artifacts/api-server/dist/index.mjs`.
- `VPS_ENV_FILE` exists and contains `DATABASE_URL` and `PORT` entries.

If the checkout is dirty, the PM2 process is missing, or the PM2 entrypoint is
the legacy `dist/index.js`, stop. Do not stash, overwrite, create a second
process, or change the PM2 definition under this preflight.

## 3. Preserve known VPS-local files without deletion

This step is authorized only for the known VPS-local files discovered during
inspection. It records their metadata, keeps them in place, and uses the
checkout-local Git exclude list so the exact-SHA deployment guard can still
detect tracked source changes. It does not delete, expose, copy, or alter
dotenv contents, uploads, backups, or investigation evidence.

Run on the VPS after confirming there are no tracked changes:

```bash
cd "$APP_DIR"

git diff --quiet && git diff --cached --quiet || {
  echo "STOP: tracked source changes require separate review."
  exit 1
}

export PRESERVATION_DIR="$HOME/costpro-vps-preflight-preservation-$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$PRESERVATION_DIR"

git status --porcelain=v1 > "$PRESERVATION_DIR/git-status-before.txt"
while IFS= read -r -d '' path; do
  stat -c '%F|%U:%G|%s|%n' -- "$path"
done < <(git ls-files --others --exclude-standard -z) \
  > "$PRESERVATION_DIR/untracked-file-metadata.txt"

cat >> .git/info/exclude <<'EOF'
# Reviewed VPS-local preservation entries for Orderly production preflight.
/.env
/.env.*
/uploads/
/artifacts/api-server/bay-hill-remainder-analysis.json
/bay-hill-batch1-forensics.json
/bay-hill-policy-preflight-after-stop.json
/report.json
EOF

git status --short
```

Expected result: the final `git status --short` is empty or contains only
unrecognized paths. If any path still appears, stop and return only its
filename and the two preservation metadata files for review. Do not use `git
clean`, `git reset --hard`, `git stash`, or an unrestricted cleanup command.

## 4. Deploy the reviewed code and allowed startup schema checks

Run on the VPS:

```bash
cd "$APP_DIR"
APP_DIR="$APP_DIR" \
API_PORT="$API_PORT" \
PM2_NAME="$PM2_NAME" \
VPS_ENV_FILE="$VPS_ENV_FILE" \
bash "$OPERATOR_DIR/deploy-reviewed-orderly-preflight.sh"
```

The script:

- refuses a dirty checkout;
- fetches and verifies the reviewed SHA is present in `origin/main` history;
- checks out that immutable SHA;
- installs the frozen pnpm lockfile with build-time devDependencies even
  when `NODE_ENV=production`;
- builds the full workspace;
- persists and injects the reviewed `APP_BUILD_ID`;
- restarts only the already-verified PM2 process; and
- verifies the active local `/api/build-info` response.

The API restart may run the reviewed idempotent startup schema checks. This is
the only database schema-update path allowed in this operation. Do **not** run
`pnpm --filter @workspace/db run push`, `drizzle-kit push`, `db:push`, or an
ad-hoc SQL migration. If the required schema is still missing after restart,
stop and report `HOLD`; do not improvise a migration.

Expected deployment output:

```json
{
  "operation": "reviewed-vps-deployment",
  "gitSha": "7c8f75f750602cc7227a807bf6dbc10fd141fa15",
  "apiVersion": "1.15.0",
  "buildId": "api@1.15.0:7c8f75f750602cc7227a807bf6dbc10fd141fa15",
  "pm2ProcessVerified": true,
  "startupMigrationPath": "application-startup-idempotent-schema-checks",
  "dbPushExecuted": false,
  "productionPreviewExecuted": false,
  "catalogApplyExecuted": false,
  "servingBuildVerified": true
}
```

## 5. Run the read-only production preflight

First place the immutable reviewed manifest and exact raw Orderly source export
on the VPS. Their paths must be absolute and must not contain credentials or
session headers.

Set the reviewed production values on the VPS:

```bash
export ORDERLY_MANIFEST_PATH='/secure/reviewed/orderly-vendor-product-adoption-manifest-24472.json'
export ORDERLY_SOURCE_PATH='/secure/reviewed/allSpecsForRestaurant_24472_raw.json'
export ORDERLY_PREFLIGHT_OUT='/secure/reports/orderly-vendor-product-adoption-production-preflight.json'
export ORDERLY_EXPECTED_COMPANY_ID='<reviewed-production-company-id>'
export ORDERLY_EXPECTED_STORE_ID='<reviewed-production-store-id>'
export ORDERLY_EXPECTED_DB_HOST='<reviewed-production-db-host>'
export ORDERLY_EXPECTED_DB_PORT='<reviewed-production-db-port>'
export ORDERLY_EXPECTED_DB_NAME='<reviewed-production-db-name>'
```

Then run:

```bash
cd "$APP_DIR"
APP_DIR="$APP_DIR" \
API_PORT="$API_PORT" \
ORDERLY_MANIFEST_PATH="$ORDERLY_MANIFEST_PATH" \
ORDERLY_SOURCE_PATH="$ORDERLY_SOURCE_PATH" \
ORDERLY_PREFLIGHT_OUT="$ORDERLY_PREFLIGHT_OUT" \
ORDERLY_EXPECTED_COMPANY_ID="$ORDERLY_EXPECTED_COMPANY_ID" \
ORDERLY_EXPECTED_STORE_ID="$ORDERLY_EXPECTED_STORE_ID" \
ORDERLY_EXPECTED_DB_HOST="$ORDERLY_EXPECTED_DB_HOST" \
ORDERLY_EXPECTED_DB_PORT="$ORDERLY_EXPECTED_DB_PORT" \
ORDERLY_EXPECTED_DB_NAME="$ORDERLY_EXPECTED_DB_NAME" \
bash "$OPERATOR_DIR/run-orderly-production-preflight.sh"
```

Expected CLI summary:

```json
{
  "mode": "production-readiness-preflight",
  "isProductionPreview": false,
  "writesExecuted": 0,
  "manifestId": "orderly-adoption-evidence-v1:<reviewed-manifest-sha256>",
  "candidateCount": 3323,
  "catalogUnchanged": true,
  "nextAllowedStep": "Obtain PM authorization, then run the separately-authorized production preview during the writer-quiescence window."
}
```

The candidate count is evidence-driven; the operator must return the actual
value from the run, not this example value.

## 6. Return sanitized evidence and hard stop

Return only the sanitized file:

```bash
cat "${ORDERLY_PREFLIGHT_OUT%.json}.sanitized.json"
```

Do not return the raw operator report, `DATABASE_URL`, dotenv contents, session
headers, source rows, or SSH details.

The sanitized report must include:

- serving build identity and `APP_BUILD_ID`;
- Git SHA and API version;
- hashed production DB host/name plus port, driver, and SSL mode;
- company/store binding and Orderly property `24472`;
- manifest ID/SHA, raw-source SHA, and canonical source fingerprint;
- required tables, columns, and exact index names;
- inventory, vendor-item, vendor, mapping, and price-history counts;
- duplicate reliable vendor-product identities;
- duplicate Orderly property plus `packSize.id` mappings;
- orphan mappings;
- before/after catalog counts and `unchanged: true`;
- `writesExecuted: 0` and `databaseWritesExecuted: 0`; and
- complete prerequisite status and next-step message.

After returning the sanitized report, stop. Do not run production preview,
writer quiescence, backup/recovery-point mutation, APPLY, held-conflict
resolution, #1217 remediation, or July inventory import.