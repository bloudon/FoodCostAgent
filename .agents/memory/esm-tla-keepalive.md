---
name: ESM TLA exit-code-13 keepalive
description: How to prevent Node.js exit-code-13 when an ESM bundle has a long memoised await init_*() chain before the startup IIFE.
---

## The problem

When esbuild bundles a server with `--format=esm`, all module bodies are inlined and each `import` becomes a top-level `await init_*()` call. On the VPS (isLocalDb=true path), the `pg.Pool` constructor does **no I/O** — it just registers options. Every subsequent `await init_*()` is memoised and resolves as a pure microtask. With nothing in the macrotask queue, Node.js v20 exits with code 13 ("Unfinished Top-Level Await") before the startup IIFE ever fires.

Symptoms: exactly two log lines appear (`[DB]` + `ℹ️ Redis`) then the process exits — `[Startup] 1` never prints.

## What does NOT work

- `setInterval(() => {}, N)` — Node.js v20 TLA exit-code-13 fires before the macro-timer queue runs; the engine considers the loop "drained" for TLA purposes even with a pending timer.
- `pool.connect()` + immediate `client.release()` — pg-pool unref()'s idle-connection timers, so the loop is effectively idle again after release().
- Holding a checked-out client — pg internally unref()'s the client's socket after the auth handshake, so the active handle disappears.

## What works

Fire-and-forget `pool.query('SELECT pg_sleep(3)')` — keeps a TCP socket in **active-read state** inside libuv for 3 s:

```ts
// server/db.ts — isLocalDb branch, right after pool is created
pool.query('SELECT pg_sleep(3)').catch(() => {/* cancelled on shutdown */});
console.log('[DB] ESM keepalive query started');
```

A pending socket read is tracked as a libuv I/O handle below the timer/Promise layer — it is never unref()'d. 3 s is more than enough for all memoised `await init_*()` microtasks to complete and the startup IIFE to open its own DB connections and HTTP socket.

## Also required

Make the startup IIFE itself a top-level await so Node tracks it as part of module evaluation:

```ts
// server/index.ts — bottom of file
await (async () => {
  // ...full startup: migrations, SSO, routes, listen
})();
```

Without `await`, the IIFE fires and returns an unwaited Promise; it is not part of the TLA chain and its async work (DB socket, HTTP listen) doesn't keep the event loop alive.

**Why:** On the ESM isLocalDb (VPS) path, the issue is always: microtask-only TLA chain + no I/O → event loop drains → code 13. Fix: make the first TLA in the chain open real I/O.
