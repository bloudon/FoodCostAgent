---
name: ESM TLA exit-code-13 keepalive
description: How to prevent Node.js exit-code-13 when an ESM bundle has a long memoised await init_*() chain before the startup IIFE.
---

## The problem

When esbuild bundles a server with `--format=esm`, all module bodies are inlined and each `import` becomes a top-level `await init_*()` call. On the VPS (isLocalDb=true path), the `pg.Pool` constructor does **no I/O** — it just registers options. Every subsequent `await init_*()` is memoised and resolves as a pure microtask. With nothing in the macrotask queue, Node.js v20 exits with code 13 ("Unfinished Top-Level Await") before the startup IIFE ever fires.

Symptoms: exactly two log lines appear (`[DB]` + `ℹ️ Redis`) then the process exits — `[Startup] 1` never prints.

## What does NOT work

- `setInterval(() => {}, 1_000_000)` — Node.js v20 TLA exit-code-13 fires before the timer's macrotask can run; the engine considers the loop "effectively idle" for TLA purposes even though a timer is registered.

## What works

Open a **real TCP connection** inside `init_db()` before the `__esm` block returns:

```ts
const _testClient = await pool.connect();
_testClient.release();
console.log('[DB] Connection verified ✓');
```

An active libuv I/O handle (TCP socket) is tracked below the Promise/timer layer. Node will never exit via any path while one is open. The socket stays alive for `idleTimeoutMillis` (30 s), well past the time needed for all memoised microtask inits to drain and the IIFE to fire.

Wrap in try/catch and log a warning (non-fatal) — if the DB is unreachable at startup the queries will surface the real error later.

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
