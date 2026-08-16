# Bay Hill Batch 1 — Production Remediation Runbook

**Status: DOCUMENTATION ONLY. Executing any step past Gate 7 requires the fresh
Product Owner authorization recorded in Section 7. This document authorizes
nothing by itself.**

This runbook executes the one-time Bay Hill Batch 1 duplicate remediation under
**operational write quiescence** (PM decision: no manifest-level locking is
added for this controlled migration; the transaction-time scope validation
remains defense in depth).

Every step is fail-closed: **any deviation from an expected value is a STOP,
never a judgment call made at the terminal.** Deviations are captured as
evidence and escalated to the Product Owner / PM.

---

## Fixed identities (verify, never edit)

| Field | Value |
| --- | --- |
| Manifest ID | `bay-hill-batch1-2026-08-15` |
| Manifest file (repo-relative) | `reports/bay-hill-batch1/bay-hill-batch1-manifest.json` |
| Manifest file (VPS absolute) | `/home/administrator/apps/CostPro/fnbcostpro/reports/bay-hill-batch1/bay-hill-batch1-manifest.json` |
| **Required manifest SHA-256** | `64570b455c2ec84c4a03c2d85b5a83f171570314550b3111766c793f01289756` |
| Bound report hash (`reportHash`) | `4eec609ca3d1bc34c8ac2aa4e0d292920f95df62b502a9af77978e4114dd501e` |
| Unapproved remainder hash | `a20be1dc5c099bfc42f49b3924bb797bdb3d149ef4fa4f02a9619739ecee792a` |
| Approved population | **848 groups** (848 unique source Item Codes) |
| companyId | `43abaf82-44ce-4231-9570-7a01e7c85ced` (Bay Hill CC) |
| storeId | `ee9e1530-50db-45f4-ae61-2c45e86827f0` |
| sourceSystem / sourcePropertyId | `ORDERLY` / `24472` |

The manifest **must not be regenerated, edited, or moved**. The CLI refuses a
hand-edited manifest (report-binding and per-group hashes), but the SHA-256
checks below are the operator-visible guarantee.

All CLI commands run from the production repo root. Because
`pnpm --filter` changes the working directory to `artifacts/api-server`, the
manifest path in every command below is the **VPS absolute path** — a
root-relative path produced an ENOENT on a prior preflight attempt. An ENOENT
is a failed step, not evidence about the database.

Base command used throughout:

```bash
cd /home/administrator/apps/CostPro/fnbcostpro
REMEDIATE="pnpm --filter @workspace/api-server run orderly:remediate --"
MANIFEST=/home/administrator/apps/CostPro/fnbcostpro/reports/bay-hill-batch1/bay-hill-batch1-manifest.json
```

The CLI prints which database answered on every refusal
(`describeDatabaseTargetLine`). If the reported target is not the production
PostgreSQL database, **STOP** — this is the stale-environment failure mode
documented for this VPS (a passing `psql "$DATABASE_URL"` proves the shell's
credentials, not the credentials PM2-loaded processes are using).

---

## 1. Preconditions

Record in the evidence log (Section E) before anything else:

- Operator name and user ID (the same ID passed to `--operator` later)
- Timestamp (UTC and local)
- VPS host
- Production repo path (expected: `/home/administrator/apps/CostPro/fnbcostpro`)
- `git rev-parse HEAD` and `git status --short` (must be clean; a dirty tree = STOP)
- Application version / build identifier
- Manifest ID, path, SHA-256 (from the check below), expected population = 848
- Approved production scope (table above)

**Manifest byte-identity check #1:**

```bash
sha256sum "$MANIFEST"
```

Required: `64570b455c2ec84c4a03c2d85b5a83f171570314550b3111766c793f01289756`
— **any mismatch = ABORT** (do not proceed to any later step).

Also confirm the deployed build contains the manifest-wide APPLY gate: the
apply run must print `Validating all 848 approved group(s) against the scope
validator before any mutation…` before any group output. If that line is
absent from a dry inspection of the deployed CLI source, the build is stale —
STOP and redeploy before continuing.

## 2. Recovery point

Vague "take a backup" is not acceptable. The operator must execute the
provider-specific procedure and record the actual reference.

1. Identify the production PostgreSQL backup mechanism actually in use on the
   VPS (managed-provider snapshot, `pg_dump`, or `pg_basebackup`). Record which.
2. If no managed snapshot exists, take a logical dump as the recovery point:

   ```bash
   pg_dump "$DATABASE_URL" -Fc \
     -f /home/administrator/backups/fnb-pre-bayhill-batch1-$(date -u +%Y%m%dT%H%M%SZ).dump
   ```

3. Record in the evidence log:
   - the exact command or provider action taken,
   - the recovery-point identifier (snapshot ID or dump filename + its
     `sha256sum` + byte size),
   - the timestamp,
   - confirmation of completion (exit code 0; for a dump, verify with
     `pg_restore --list <file> | head` returning a table of contents),
   - confirmation it covers the **production PostgreSQL database** (compare
     the dump's database name/host against the production `DATABASE_URL`
     target — record host/db name only, never credentials).
4. **Rollback procedure — reference only.** The executable restore command is
   deliberately NOT written in this section: no database-mutating command
   appears anywhere before the Section 7 authorization gate. The restore
   procedure lives in **Appendix R** (after the failure matrix) and may be
   executed only on an explicit Product Owner/PM rollback decision reached
   through Section 13. In this section the operator records only that
   Appendix R is applicable to the recovery point just taken (snapshot vs.
   dump) and which variant applies.

**No recovery reference recorded → the run stops here.**

## 3. Stop application writers

"API stopped" is not sufficient. The quiesced set is **every process capable of
writing tables touched by remediation** (`inventory_items`,
`inventory_item_external_mappings`, `inventory_count_lines`,
`inventory_counts`, `store_inventory_items`,
`inventory_item_location_assignments`, remediation audit tables, and
import/staging tables).

1. Enumerate candidates and record the full list:

   ```bash
   pm2 ls
   crontab -l; sudo ls /etc/cron.d/ 2>/dev/null
   systemctl list-units --type=service --state=running | grep -iE 'fnb|cost|node|queue|worker' || true
   ```

2. Classify every PM2 process / cron entry / service as **MUST STOP** (FnB API,
   any background worker, scheduled job, queue consumer, import worker, or
   inventory/count writer using the FnB production database) or **MAY REMAIN**
   (unrelated applications — do not stop these). Record the classification
   with a one-line reason each. *The actual production process names must be
   taken from the `pm2 ls` output at run time and written into the evidence
   log — do not guess.*
3. Stop only the MUST STOP set:

   ```bash
   pm2 stop <name-or-id> [...]   # each classified writer
   ```

   Disable any classified cron entries for the window (comment out, record).
4. Record `pm2 ls` after stopping, showing every MUST STOP process as `stopped`.

## 4. Verify write quiescence (read-only)

All checks below are read-only. Expected surviving DB connections: the
operator's own CLI/psql session and any administrative monitoring — identified
by application name/user, **not** by connection count alone.

```bash
pm2 ls                                # every MUST-STOP process: stopped
ps aux | grep -iE 'fnbcostpro|api-server|worker' | grep -v grep   # no writer processes

psql "$DATABASE_URL" -c "
  SELECT pid, usename, application_name, client_addr, state, backend_start
  FROM pg_stat_activity
  WHERE datname = current_database()
  ORDER BY backend_start;"
```

- **PASS:** every remaining session is the operator's session or a recognized
  administrative/monitoring connection.
- **ABORT condition:** any session whose `application_name`/`usename`/source
  matches the application or a worker, any session in an active write
  transaction, or any session the operator cannot positively identify.

Record the sanitized session list (user, application_name, state — no
addresses beyond what identification requires).

## 5. Final manifest integrity check

Immediately before policy preflight (check #2):

```bash
sha256sum "$MANIFEST"
```

Required: `64570b455c2ec84c4a03c2d85b5a83f171570314550b3111766c793f01289756`
— mismatch = **ABORT**.

## 6. Production policy-preflight (read-only)

```bash
$REMEDIATE --mode policy-preflight --manifest "$MANIFEST" --json
```

Required output — **every** line must match; any deviation = STOP (the CLI
also exits non-zero if any group is blocked):

| Field | Required value |
| --- | --- |
| `manifestId` | `bay-hill-batch1-2026-08-15` |
| `totalGroups` (groups evaluated) | 848 |
| `authorizedGroups` | 848 |
| `blockedGroups` | 0 |
| `mappingClassDistribution.A_LEGACY_MISSING_SCOPE` | 932 |
| `mappingClassDistribution.B_DEMONSTRABLY_FOREIGN` | 0 |
| `mappingClassDistribution.C_AMBIGUOUS` | 0 |
| `scopedBatchCount` | 2 |
| `legacyAdoptionPermitted` (policy binding) | PASS / `true` |
| `remediationWrites` | 0 |
| `reportHash` | `4eec609c…dd501e` (full value above) |

Record the sanitized summary object. This mode performs no writes and cannot
transition into APPLY.

## 6b. Production merge-content preflight (read-only) — **ADDED AFTER THE 2026-08-15 APPLY ABORT**

The first production APPLY passed the scope gate and still stopped its first
ten groups on store-settings collisions (`primaryLocationId` disagreement).
Per the PM-approved Option A rule, a store-settings row pair that differs
ONLY on `primaryLocationId` is now mergeable (canonical's primary retained,
duplicate's discarded, discarded value recorded in audit evidence, location
union preserved); every other protected-field difference still blocks. This
section verifies, read-only, that the WHOLE manifest is eligible under those
rules before any authorization is sought. It runs the same pure decision
functions APPLY runs.

```bash
$REMEDIATE --mode merge-preflight --manifest "$MANIFEST" --json
```

Required output — **every** line must match; any deviation = STOP (the CLI
exits non-zero if any group carries another conflict):

| Field | Required value |
| --- | --- |
| `manifestId` | `bay-hill-batch1-2026-08-15` |
| `readOnly` | `true` |
| `remediationWrites` | 0 |
| `totalGroups` (groups evaluated) | 848 |
| `eligibleGroups` (clean + primary-location-only) | 848 |
| `conflictGroups` (other conflicts) | 0 |
| `reportHash` | `4eec609c…dd501e` (full value above, unchanged) |

`cleanGroups` / `primaryLocationOnlyGroups` may split 848 between them in any
proportion; their sum must be 848. Record the sanitized summary object,
including `primaryLocationMergeCount`. This mode performs no writes and cannot
transition into APPLY.

**Option A authorization boundary.** The primary-location-only merge rule is
NOT a general service behavior: it activates only when the run presents the
code-owned `BAY_HILL_PRIMARY_LOCATION_MERGE_POLICY` (registered by reference
in the approved-policy registry and bound to this exact manifest id, report
hash, scope, and 848-group count). This CLI mints that authorization itself in
`merge-preflight` and `apply` modes; a direct caller of the remediation
service without it gets the original fail-closed collision behavior.
Additionally, the **canonical-absent shape fails closed even with the
authorization**: if the canonical item has no store row and two duplicates
disagree on primary location, there is no approved retention source and the
group blocks in both preflight and APPLY. Duplicates are always processed in
deterministic manifest (`supersededItemIds`) order, so the preflight verdict
and the APPLY outcome are computed over the identical sequence.

## 7. Fresh Product Owner authorization gate — **HARD STOP**

**No APPLY command may be typed, queued, or scripted until this section is
completed in writing.** The preceding sections deliberately never construct
the apply command; it appears only after this gate.

Sign-off record (all fields required):

| Field | Value |
| --- | --- |
| Product Owner approval (name + explicit "APPROVED TO APPLY") | |
| Date/time of approval (UTC) | |
| Manifest SHA-256 approved | `64570b45…289756` (must be restated in full) |
| Recovery-point reference (from Section 2) | |
| Policy-preflight result (from Section 6, incl. 848/848/0) | |
| Merge-content preflight result (from Section 6b, incl. 848 evaluated / 848 eligible / 0 other conflicts) | |
| PO acknowledges the canonical-absent primary-only shape is FAIL-CLOSED (not merged) and would require separate approval | |
| PO acknowledges duplicates are merged in deterministic manifest order (preflight verdict = APPLY outcome) | |
| Operator identity executing the APPLY | |

If any earlier section produced a deviation, this gate cannot be signed.
Approval of a *different* manifest hash is not approval of this run.

## 8. APPLY

Only with Section 7 fully signed. The command uses the unchanged manifest, the
production operator ID, and the explicit production confirmation flag. It does
**not** regenerate the manifest, and all existing scope/policy guards remain
active (the CLI re-runs the full manifest-wide scope gate itself before the
first mutation — expect `Scope gate passed: 848/848 group(s) clean` before any
group output — and then re-runs the manifest-wide merge-content gate; a
deterministic merge conflict anywhere in the manifest aborts the whole APPLY
with `MERGE_CONTENT_BLOCKED` before the first transaction opens).

```bash
$REMEDIATE --mode apply \
  --manifest "$MANIFEST" \
  --operator <production-operator-user-id> \
  --confirm-production-apply
```

Expected success output (aggregate line at the end):

```
applied=848 alreadyRemediated=0 stopped=0
```

with per-group `APPLIED` lines for all 848 groups.

- Any `STOPPED` group, any `alreadyRemediated > 0`, a
  `RemediationManifestBlockedError` refusal, or any aggregate other than
  `848 / 0 / 0` → go directly to Section 13 (failure handling). Do not re-run,
  do not reconcile as successful.

## 9. Reconcile — immediately after APPLY, writers still stopped

**Do not restart the application before this passes.**

```bash
$REMEDIATE --mode reconcile
```

Required:

| Check | Required value |
| --- | --- |
| May 2026 valuation | `$254,286.67`, delta `$0.00`, `MATCH` |
| June 2026 valuation | `$261,007.67`, delta `$0.00`, `MATCH` |
| Exit code | 0 (any `MISMATCH` exits non-zero) |

A mismatch means orphaned references, unauthorized scope spill, or an
unexpected valuation change — Section 13, reconciliation-failure branch.

## 10. Post-APPLY report — writers still stopped

```bash
$REMEDIATE --mode report
```

Expected remaining population (**the report will NOT be empty** — held groups
remain by design):

| Population | Expected |
| --- | --- |
| Remaining `SAFE_CANDIDATE` groups | **45** — the 44 independently-reviewed held groups (`batch1-held-safe-codes.txt` / the review CSV) plus the separately held Stella Artois `99682`, all untouched |
| Remaining `AMBIGUOUS` groups | **4** — `10149134`, `7468556`, `7023177`, `9021845`, untouched |
| Batch 1 approved 848 groups | no longer present as active remediation candidates |

Verify the held set by **membership**, not count: every code in
`batch1-held-safe-codes.txt` (45 codes incl. `99682`) must still appear, and
no code from `batch1-approved-codes.txt` may appear as an active candidate.
Note: post-run classification of held groups can legitimately shift labels as
surrounding duplicates disappear; **any held or ambiguous code showing as
mutated/superseded = failure**. If any expected classification changes — even
with the code untouched — remain stopped, record the evidence, and escalate to
the Product Owner/PM before restarting anything; the operator does not decide
whether a reclassification is benign. Deviation from the expected populations →
Section 13.

## 11. Restart application

Only after Sections 8, 9, and 10 all passed.

```bash
pm2 start <name-or-id> [...]   # exactly and only the processes stopped in Section 3
pm2 ls
```

Re-enable any cron entries disabled in Section 3. Do not start anything that
was not stopped by this runbook.

## 12. Health verification

- `pm2 ls` — all restarted processes `online`, restart counter not climbing.
- API health endpoint returns HTTP 200 (record the endpoint and status only).
- Production logs (`pm2 logs <api> --lines 200 --nostream`) show a clean
  startup: no migration errors and **no PostgreSQL `28P01`** — the known
  stale-PM2-environment failure on this VPS. A healthy endpoint does not prove
  DB auth; check the logs.
- DB connectivity from the application confirmed by a database-backed request
  (e.g., an authenticated page or API call returning real data), not just the
  health route.

Record the expected vs. observed health responses.

## 13. Failure / rollback matrix

| Situation | Action |
| --- | --- |
| **Failure before APPLY** (Sections 1–7) | No rollback needed — nothing was written. Fix or escalate; either keep writers stopped or restart them safely (Sections 11–12) depending on the issue. |
| **APPLY refuses / zero mutations** (manifest blocked, `applied=0`) | Do **not** reconcile as successful. Capture the refusal output and blocker codes. Investigate. No DB restore unless evidence shows unexpected writes occurred (run `--mode verify-suspended --manifest "$MANIFEST"` to prove mutation-free). |
| **Partial / unexpected APPLY** (any `stopped>0`, aggregate ≠ 848/0/0) | Keep writers stopped. **Do not improvise, do not re-run.** Capture the full per-group result set and audit state as sanitized evidence. If integrity cannot be positively proven, restore the Section 2 recovery point per its rollback procedure. |
| **Reconciliation failure after a successful APPLY** | Keep writers stopped. Do not restart the application. Capture evidence. Escalate to Product Owner/PM for the rollback decision — the recovery point is used only on their instruction. |
| **Post-report mismatch** (Section 10) | Same fail-closed treatment as reconciliation failure. |
| **App fails health check after clean reconciliation** | Do **not** automatically roll back the remediation. Diagnose application startup separately (first suspect on this VPS: PM2 loading a stale `DATABASE_URL` — compare PM2's loaded environment target with the shell's without printing credentials), unless evidence indicates remediation damage. |

---

## Appendix R — Database restore (rollback) procedure

**Executable only after a Section 13 escalation ends in an explicit Product
Owner/PM rollback decision, recorded in the evidence log with name and UTC
timestamp.** Never run this proactively, and never before Gate 7 has been
reached — before APPLY there is nothing to roll back.

1. Confirm all application writers are still stopped (re-run Section 4 checks).
2. Restore the Section 2 recovery point:
   - **Managed snapshot:** perform the provider's snapshot-restore action for
     the recorded recovery-point identifier.
   - **Logical dump:**

     ```bash
     pg_restore --clean --if-exists -d "$DATABASE_URL" <recorded-dump-file>
     ```

3. Prove the pre-run state is back, read-only:

   ```bash
   $REMEDIATE --mode verify-suspended --manifest "$MANIFEST"
   $REMEDIATE --mode reconcile
   ```

   Required: mutation-free verification passes and May 2026 shows
   `$254,286.67`, delta `$0.00`, `MATCH`.
4. Only then restart the application (Sections 11–12) and record the restore
   evidence per Section E.

## E. Evidence handling

At each numbered gate, append a sanitized structured entry to
`reports/bay-hill-batch1/PRODUCTION-RUN-EVIDENCE.md` (created at run time):
gate name, UTC timestamp, command run (with credentials-free arguments), the
minimum facts proving the gate (hashes, counts, MATCH/PASS lines, sign-off),
and PASS/STOP.

**Never commit:** raw terminal dumps containing production-sensitive values
(pricing, quantities, entity IDs beyond those already in this runbook),
`DATABASE_URL`, credentials, environment files, or secrets. Transcribe the
verdict facts; keep the raw text out of version control.

**Manifest byte-identity check #3 (post-run):** after the run — and after the
creation of this runbook itself — re-run `sha256sum` on the manifest and record
that it still equals `64570b45…289756`.

## Out of scope for this document's creation

This runbook's creation performed **no** APPLY, no production mutation, no
manifest regeneration, no candidate or policy changes, no locking-architecture
work, no mapping repair, and no historical-import work.
