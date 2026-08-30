---
name: VPS database authentication diagnosis
description: Durable diagnostic distinction for local PostgreSQL credentials versus the environment loaded by PM2.
---

A successful TCP connection using `PGPASSWORD` against `127.0.0.1:5432` proves the PostgreSQL role, password, server, and port are valid. If the application still reports PostgreSQL error `28P01`, the application process is using a different, stale, or differently parsed `DATABASE_URL`.

**Why:** The API health endpoint can remain healthy while startup migrations and database-backed requests fail because process health does not prove database authentication.

**How to apply:** Compare the shell-loaded connection target with PM2's loaded environment without revealing credentials, then restart PM2 only after exporting/loading the intended production environment and validating `psql "$DATABASE_URL"`.

On this VPS, the application operator may receive `Permission denied` reading
`/proc/<pm2-pid>/environ` even when PM2 is visible and healthy. The approved
application `.env` can be the available source for a one-off operator command;
load it inside a subshell and never print its values.

**Why:** Process ownership or `/proc` hardening can block environment inspection,
and an `exit` in a command pasted directly into an interactive tmux shell ends
the tmux session rather than merely failing the operation.

**How to apply:** Prefer a subshell for guarded production commands, keep
secrets out of output, and treat a missing `/proc` environment as an access
constraint—not proof that the database URL is absent.