# POS Connection Lifecycle

This document describes the full lifecycle of a `pos_connections` row — how it is created,
what each status means, what data survives when a connection is released or disconnected,
and how reconnection works.

It exists so future contributors can reason about edge cases without having to re-derive the
behavior from the storage layer and route handlers.

---

## Status reference

| Status | How you get here | Sync eligible? | Blocks provider change? | Blocks new OAuth? |
|---|---|---|---|---|
| `active` | New OAuth connect, or reconnect | ✅ Yes | ✅ Yes | ✅ Yes |
| `disconnected` | Square revokes the token (401/SquareTokenRevokedError) | ❌ No | ✅ Yes | ✅ Yes |
| `released` | User explicitly disconnects via Settings | ❌ No | ❌ **No** | ❌ **No** |
| `error` | Reserved for future use | ❌ No | ✅ Yes | ✅ Yes |

The key distinction between `released` and `disconnected` is **intent**:

- **`disconnected`** means Square revoked the tokens. The user did nothing wrong; their
  connection is just broken and needs to be repaired via the reconnect flow. The company's
  provider record is still intact. A second OAuth authorize will not create a new row — it
  must update the existing one.
- **`released`** means the user chose to disconnect. The company may want to switch providers
  or simply re-authorize from scratch. A released connection does not block either action.

---

## State machine

```
                ┌──────────────────────────────────┐
                │             active               │
                └────────┬──────────────┬──────────┘
                         │              │
          Square revokes │              │ User disconnects
          token (401)    │              │ (Settings UI)
                         ▼              ▼
                  ┌────────────┐  ┌──────────┐
                  │disconnected│  │ released │
                  └─────┬──────┘  └────┬─────┘
                        │              │
         User reconnects│              │ User connects fresh
         (same conn row)│              │ (new conn row created)
                        ▼              ▼
                ┌──────────────────────────────────┐
                │             active               │
                └──────────────────────────────────┘
```

**Notes:**
- A `released` connection can also be restored to `active` via the reconnect flow if the
  original `connectionId` is still in the signed OAuth state token (e.g. from a browser
  tab opened before the connection was released). This is intentional and harmless — the
  partial unique index allows it because the `released` row is not covered by the
  `WHERE status = 'active'` predicate.
- There is no transition to a deleted/purged state. Rows are soft-deleted by status change;
  the full row and all linked data are retained indefinitely.

---

## What `deletePosConnection` does

`storage.deletePosConnection(id, companyId)` issues a single UPDATE:

```sql
UPDATE pos_connections
SET status = 'released', updated_at = NOW()
WHERE id = ? AND company_id = ?
```

**What it does NOT do:**
- Does not zero or clear `access_token` / `refresh_token`. Tokens remain encrypted at rest
  using AES-256 via `POS_TOKEN_ENCRYPTION_KEY`. They are inactive in practice because the
  scheduler and sync jobs only operate on `status = 'active'` connections.
- Does not notify Square (no token revocation API call). If the tokens are still valid, they
  remain usable until Square expires them (~30 days). This is intentional — the user may
  reconnect and would need valid tokens to do so via the reconnect path.
- Does not cascade to mappings, sync jobs, or any other table.

---

## What is retained after a release

All data linked to a released connection row is preserved:

### Location mappings (`pos_location_mappings`)

Retained. These rows are keyed by `connection_id`. They are queryable and, because the
reconnect path updates the existing `pos_connections` row in place (not a new row), they
survive a disconnect-then-reconnect cycle with zero intervention.

### Item mappings (`pos_item_mappings`)

Retained. Same logic as location mappings. Merchants who reconnect Square after a provider
switch and then back again do not need to re-map their catalog.

### Sync history (`pos_sync_jobs`)

Retained. All historical sync job records remain, as do the `last_synced_at` and
`sync_cursor` columns on the `pos_connections` row itself. This lets support staff audit
the sync history for a connection even after it has been released.

---

## One-active-connection-per-company constraint

A partial unique index enforces at most one `active` connection per company:

```sql
CREATE UNIQUE INDEX pos_connections_one_active_per_company
  ON pos_connections (company_id) WHERE status = 'active';
```

Because the predicate is `WHERE status = 'active'`, released and disconnected rows are
outside the index entirely. A company can therefore:

- Have multiple `released` rows in the table (historical record of past connections).
- Have one `disconnected` row and create a brand-new `active` row — but only after the
  disconnected row is cleared via the reconnect flow or manually.

---

## Provider-change guard

`PATCH /api/companies/:id/pos-config` (and the generic company PATCH) checks for a
*retained* connection before allowing a `posProvider` change:

```ts
const retained = await storage.getRetainedPosConnectionForCompany(companyId);
if (retained) {
  return res.status(409).json({ code: "retained_pos_connection", ... });
}
```

`getRetainedPosConnectionForCompany` returns the most recent connection where
`status <> 'released'`. This means:

- `active` or `disconnected` → 409 returned, provider change blocked until the user
  explicitly disconnects (setting status to `released`).
- `released` → no row returned, provider change allowed.

---

## OAuth new-connection gate

`GET /api/pos/oauth/square/callback` (new-connection path) runs the same check:

```ts
const existingConn = await storage.getRetainedPosConnectionForCompany(companyId);
if (existingConn) {
  return res.redirect(`/settings?tab=connections&pos_error=connection_already_exists`);
}
```

A `released` row does not trigger this guard. If a user releases their Square connection
and immediately starts a new OAuth flow, a fresh `active` row is created. The released row
remains in the table as a historical record.

---

## Reconnect flow

The reconnect path (triggered when `connectionId` is present in the signed OAuth state)
performs an UPDATE on the existing connection row:

```ts
await storage.updatePosConnection(connectionId, companyId, {
  accessToken: newTokens.accessToken,
  refreshToken: newTokens.refreshToken ?? existing.refreshToken,
  tokenExpiresAt: newTokens.tokenExpiresAt,
  status: "active",
  updatedAt: new Date(),
});
```

Because this is an in-place update on the **same row**, all `pos_location_mappings` and
`pos_item_mappings` rows keyed to that `connectionId` remain intact. The merchant does not
need to redo the location-mapping or item-mapping steps.

---

## Relevant code

| Concept | Location |
|---|---|
| Status transition to `released` | `server/storage.ts` → `deletePosConnection` |
| Status transition to `disconnected` | `server/services/posSyncJobs.ts` → `runIncrementalSync` / `refreshAllPosTokens` |
| Status transition back to `active` | `server/routes/posRoutes.ts` → OAuth callback reconnect path |
| Retained-connection check | `server/storage.ts` → `getRetainedPosConnectionForCompany` |
| Provider-change guard | `server/routes.ts` → `PATCH /api/companies/:id/pos-config` |
| Partial unique index | `server/index.ts` → startup migration block |
| Token encryption/decryption | `server/utils/tokenCrypto.ts` |
