# Gate 7 Evidence — Bay Hill Batch 1 (Sections 1–6 only)

**Scope: this run stops at Gate 7. Do NOT run `--mode apply`.** The apply
command is not in this sheet on purpose. Fill every blank; a blank field is a
STOP, not an omission.

Companion to `PRODUCTION-RUNBOOK.md` — that document is authoritative; this is
the operator's copy-paste sheet and the fill-in record the PM will review.

## Session setup (run once)

```bash
cd /home/administrator/apps/CostPro/fnbcostpro
REMEDIATE="pnpm --filter @workspace/api-server run orderly:remediate --"
MANIFEST=/home/administrator/apps/CostPro/fnbcostpro/reports/bay-hill-batch1/bay-hill-batch1-manifest.json
```

## 1. Preconditions

```bash
date -u; hostname; git rev-parse HEAD; git status --short; sha256sum "$MANIFEST"
```

| Field | Recorded value |
| --- | --- |
| Operator (name + user ID for later `--operator`) | |
| UTC timestamp | |
| VPS host | |
| Repo path | |
| Git commit (`git status` must be clean — dirty = STOP) | |
| App version/build | |
| Manifest SHA (must equal `64570b455c2ec84c4a03c2d85b5a83f171570314550b3111766c793f01289756`) | |

## 2. Recovery point

Managed snapshot **or** logical dump (see runbook §2). If dump:

```bash
mkdir -p /home/administrator/backups
pg_dump "$DATABASE_URL" -Fc -f /home/administrator/backups/fnb-pre-bayhill-batch1-$(date -u +%Y%m%dT%H%M%SZ).dump
pg_restore --list /home/administrator/backups/fnb-pre-bayhill-batch1-*.dump | head -5
sha256sum /home/administrator/backups/fnb-pre-bayhill-batch1-*.dump
```

| Field | Recorded value |
| --- | --- |
| Mechanism (snapshot / pg_dump) | |
| Recovery-point identifier (snapshot ID or filename) | |
| Dump SHA-256 + byte size (if dump) | |
| Timestamp | |
| Completion verified how (exit 0 + `pg_restore --list` TOC) | |
| Covers production DB (host/db name only — no credentials) | |

## 3. Stop application writers

```bash
pm2 ls
crontab -l; sudo ls /etc/cron.d/ 2>/dev/null
systemctl list-units --type=service --state=running | grep -iE 'fnb|cost|node|queue|worker' || true
```

| Process / job | MUST STOP or MAY REMAIN | Reason (one line) | Stopped? |
| --- | --- | --- | --- |
| | | | |

Then `pm2 stop <each MUST STOP>` and disable classified cron entries.
Record `pm2 ls` after: every MUST STOP process shows `stopped`.

**PM caution: do not rush this section — quiescence is standing in for a
locking architecture.** Enumerate everything; when unsure whether a process
can write FnB tables, classify it MUST STOP or stop and investigate.

## 4. Verify write quiescence

```bash
pm2 ls
ps aux | grep -iE 'fnbcostpro|api-server|worker' | grep -v grep
psql "$DATABASE_URL" -c "
  SELECT pid, usename, application_name, client_addr, state, backend_start
  FROM pg_stat_activity
  WHERE datname = current_database()
  ORDER BY backend_start;"
```

| Field | Recorded value |
| --- | --- |
| Surviving sessions (user / application_name / state, sanitized) | |
| Each positively identified as operator or admin/monitoring? (yes = PASS) | |
| Any application/worker session, active write txn, or unidentifiable session? (**any yes = ABORT**) | |

## 5. Final manifest integrity check

```bash
sha256sum "$MANIFEST"
```

| Field | Recorded value |
| --- | --- |
| SHA (must equal `64570b45…289756` exactly — mismatch = ABORT) | |

## 6. Policy preflight (read-only)

```bash
$REMEDIATE --mode policy-preflight --manifest "$MANIFEST" --json
```

| Field | Required | Recorded |
| --- | --- | --- |
| manifestId | `bay-hill-batch1-2026-08-15` | |
| totalGroups | 848 | |
| authorizedGroups | 848 | |
| blockedGroups | 0 | |
| A_LEGACY_MISSING_SCOPE | 932 | |
| B_DEMONSTRABLY_FOREIGN | 0 | |
| C_AMBIGUOUS | 0 | |
| scopedBatchCount | 2 | |
| legacyAdoptionPermitted | true | |
| remediationWrites | 0 | |
| reportHash | `4eec609c…dd501e` | |
| Exit code | 0 | |

Any deviation on any row = STOP; keep writers stopped and escalate.

## Gate 7 block for the PM

```text
recovery point: recorded and verified   [ref: __________]
manifest SHA: exact match
writers: quiesced                       [processes stopped: __________]
unexpected DB writers: none
policy-preflight:
  groups=848
  authorized=848
  blocked=0
  A=932
  B=0
  C=0
  legacy batches=2
  writes=0
```

**STOP HERE.** Bring this completed sheet back. The APPLY command is issued
only after the PM/Product Owner returns the fresh authorization, which will be
recorded in runbook Section 7 before Section 8 is executed.

Evidence hygiene: transcribe verdict facts only. Do not paste raw terminal
dumps, `DATABASE_URL`, credentials, or environment contents into this file or
the chat.
