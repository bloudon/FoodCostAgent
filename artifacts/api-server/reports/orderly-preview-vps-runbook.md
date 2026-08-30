# Orderly Preview and Approval VPS Runbook

## Required precondition: source-property binding

A missing source-property binding is not a harmless legacy state. It silently
disables property-scoped historical resolution and can make a preview look fast
and healthy while producing unnecessary recode or new-pack decisions.

Before the first import for a re-onboarded company, verify all of the following:

- One active `import_source_property_bindings` row exists for the Orderly
  property.
- The binding belongs to the current company and destination store.
- Every staged batch records both `source_property_binding_id` and
  `source_property_id`.
- Preview includes an expected known historical match before approval.

Do not treat a fast preview with null binding metadata as acceptance evidence.

## Nginx timeout headroom

Preview is read-only, but approval can take 60–130 seconds and is the
irreversible operation. Configure explicit headroom for both routes in the
active HTTPS server block that proxies `/api/` to port `3004`:

```nginx
location ~ ^/api/inventory-import/orderly/batches/[^/]+/(resolution-preview|approve)$ {
    proxy_pass http://127.0.0.1:3004;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 10s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
}
```

Place this more-specific location before the general `/api/` location. Preserve
any authentication, CORS, buffering, or WebSocket directives already present
in the production proxy rather than replacing the whole server block.

Set `NGINX_CONF` to the active site file, back it up, validate, and reload:

```bash
NGINX_CONF='/etc/nginx/sites-enabled/fnbcostpro'
NGINX_BACKUP="${NGINX_CONF}.before-orderly-timeouts.$(date +%Y%m%d%H%M%S)"
sudo cp --preserve=all "$NGINX_CONF" "$NGINX_BACKUP"
sudo nginx -t && sudo systemctl reload nginx
```

If validation fails, do not reload. If the reload succeeds but health or route
behavior regresses, roll back the exact saved file and validate before reload:

```bash
sudo cp --preserve=all "$NGINX_BACKUP" "$NGINX_CONF"
sudo nginx -t && sudo systemctl reload nginx
curl -fsS https://fnbcostpro.com/api/healthz
```

## Install the supporting indexes before restarting the app

Do not let API startup build these indexes: ordinary `CREATE INDEX` can block
writes on an active production database. From the application directory, build
the checked-out commit, then run the dedicated operator command while the
current PM2 process remains healthy:

```bash
cd /home/administrator/apps/CostPro/fnbcostpro
pnpm --filter @workspace/api-server run build

PID="$(pm2 pid fnbcostpro | head -n 1)"
DB_URL="$(tr '\0' '\n' < "/proc/$PID/environ" | \
  sed -n 's/^DATABASE_URL=//p')"
test -n "$DB_URL" || {
  echo "DATABASE_URL is not present in the fnbcostpro PM2 process"
  exit 1
}

nohup env DATABASE_URL="$DB_URL" \
  pnpm --filter @workspace/api-server run orderly:preview-indexes \
  > /tmp/orderly-preview-indexes.log 2>&1 < /dev/null &
echo "Index operation started in background; inspect /tmp/orderly-preview-indexes.log after reconnecting."
unset DB_URL PID
```

The command uses a dedicated PostgreSQL session, `CREATE INDEX CONCURRENTLY`,
a five-second lock timeout, a non-blocking advisory guard, and post-create
validity/definition checks. It prints only the database name and verified index
definitions. A non-zero exit is a deployment stop; do not restart PM2.
If the command reports a valid but mismatched same-named index, remove only the
reported index concurrently, then rerun the installer:

```sql
DROP INDEX CONCURRENTLY IF EXISTS inv_import_batches_orderly_history_idx;
DROP INDEX CONCURRENTLY IF EXISTS inv_import_rows_batch_code_idx;
```

## Capture a production query plan before changing data

For a representative pending July batch, set `BATCH_ID` and `COMPANY_ID` to
the already-known IDs, then run this read-only, 30-second-bounded plan and
count check through the PM2 database environment. It does not expose the
connection string or change data:

```bash
cd /home/administrator/apps/CostPro/fnbcostpro
BATCH_ID='JULY_BATCH_ID'
COMPANY_ID='BAY_HILL_COMPANY_ID'
PID="$(pm2 pid fnbcostpro | head -n 1 | tr -d '[:space:]')"
DB_URL="$(tr '\0' '\n' < "/proc/$PID/environ" | \
  sed -n 's/^DATABASE_URL=//p')"
test -n "$DB_URL" || { echo "DATABASE_URL missing from PM2"; exit 1; }

timeout 30s env PGOPTIONS='-c statement_timeout=25s -c lock_timeout=1s' \
  psql -X "$DB_URL" -v ON_ERROR_STOP=1 \
  -v batch_id="$BATCH_ID" -v company_id="$COMPANY_ID" <<'SQL'
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
WITH current_batch AS (
  SELECT id, company_id, source_property_id, inventory_date
  FROM inventory_import_batches
  WHERE id = :'batch_id'
    AND company_id = :'company_id'
    AND source_system = 'ORDERLY'
),
latest_predecessor AS (
  SELECT p.id, p.inventory_date
  FROM inventory_import_batches p
  INNER JOIN current_batch c
    ON c.company_id = p.company_id
   AND c.source_property_id = p.source_property_id
  WHERE p.source_system = 'ORDERLY'
    AND p.status = 'approved'
    AND p.inventory_date < c.inventory_date
  ORDER BY p.inventory_date DESC, p.uploaded_at DESC, p.id DESC
  LIMIT 1
),
current_codes AS (
  SELECT DISTINCT source_item_code
  FROM inventory_import_rows
  WHERE batch_id = :'batch_id'
    AND source_item_code IS NOT NULL
)
SELECT p.inventory_date, r.row_index, r.source_item_code,
       r.resolved_inventory_item_id
FROM latest_predecessor p
INNER JOIN inventory_import_rows r ON r.batch_id = p.id
INNER JOIN current_codes c ON c.source_item_code = r.source_item_code
WHERE r.resolved_inventory_item_id IS NOT NULL
ORDER BY r.row_index;

WITH current_batch AS (
  SELECT id, company_id, source_property_id, inventory_date
  FROM inventory_import_batches
  WHERE id = :'batch_id'
    AND company_id = :'company_id'
    AND source_system = 'ORDERLY'
),
latest_predecessor AS (
  SELECT p.id, p.inventory_date
  FROM inventory_import_batches p
  INNER JOIN current_batch c
    ON c.company_id = p.company_id
   AND c.source_property_id = p.source_property_id
  WHERE p.source_system = 'ORDERLY'
    AND p.status = 'approved'
    AND p.inventory_date < c.inventory_date
  ORDER BY p.inventory_date DESC, p.uploaded_at DESC, p.id DESC
  LIMIT 1
),
current_codes AS (
  SELECT DISTINCT source_item_code
  FROM inventory_import_rows
  WHERE batch_id = :'batch_id'
    AND source_item_code IS NOT NULL
)
SELECT p.id AS predecessor_batch_id,
       p.inventory_date AS predecessor_date,
       count(r.id) AS matching_resolved_rows,
       count(DISTINCT r.source_item_code) AS matching_source_codes
FROM latest_predecessor p
LEFT JOIN inventory_import_rows r
  ON r.batch_id = p.id
 AND r.resolved_inventory_item_id IS NOT NULL
INNER JOIN current_codes c
  ON c.source_item_code = r.source_item_code
GROUP BY p.id, p.inventory_date;
SQL
unset DB_URL PID BATCH_ID COMPANY_ID
```

Save the sanitized plan, execution time, predecessor batch/date, and matching
row/code counts with the deployment evidence. A timeout, sequential scan over
multiple history batches, or missing predecessor is a stop condition.

## Post-deploy preview verification

1. Confirm `/api/build-info` reports the deployed commit and `/api/healthz`
   returns `{"status":"ok"}`.
2. Request the July resolution preview through public Nginx, not directly on
   port `3004`, and make curl report the measured result:

   ```bash
   curl --silent --show-error --output /tmp/july-preview.json \
     --write-out 'http=%{http_code} duration=%{time_total}s\n' \
     --cookie /path/to/operator-cookie.txt \
     'https://fnbcostpro.com/api/inventory-import/orderly/batches/JULY_BATCH_ID/resolution-preview'
   ```

   Use the operator's existing authenticated cookie handling; never paste or
   commit cookie contents.
3. Record the exact wall-clock duration and HTTP status. Success without a
   duration is insufficient; a result near the proxy ceiling has no growth
   margin.
4. Confirm row 2499 resolves to the approved June inventory item.
5. Confirm all 228 saved review decisions remain and review the changed
   `create_variant` count.
6. Do not retry approval until preview correctness and duration are accepted.

## Approval timing evidence

The approval POST normally returns `202` after durably claiming the job; the
irreversible work then continues asynchronously. The Nginx timeout protects
request setup and recovery responses, but it does not measure apply duration.
After approval is explicitly authorized, record the POST response time and then
poll the job endpoint until `completed` or `failed`. Preserve the returned
`startedAt`, `completedAt`, final status, and elapsed wall-clock duration in the
sanitized operator evidence. A `202` response alone is not approval evidence.