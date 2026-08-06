---
name: ESM TLA exit-code-13 keepalive
description: How to prevent Node.js exit-code-13 when an ESM bundle has a long memoised await init_*() chain before the startup IIFE.
---

## The problem

When esbuild bundles a server with `--format=esm`, all module bodies are inlined and each `import` becomes a top-level `await init_*()` call. On the VPS (isLocalDb=true path), the `pg.Pool` constructor does **no I/O** — it just registers options. Every subsequent `await init_*()` is memoised and resolves as a pure microtask. With nothing in the macrotask queue, Node.js v20 exits with code 13 ("Unfinished Top-Level Await") before the startup IIFE ever fires.

Symptoms: exactly two log lines appear (`[DB]` + `ℹ️ Redis`) then the process exits — `[Startup] 1` never prints.

## What does NOT work (event-loop keepalive approaches — all wrong diagnosis)

- `setInterval(() => {}, N)` — timer is unref'd by pg-pool internals; loop still drains.
- `pool.connect()` + immediate release — released client goes to idle pool; idle timer is unref'd.
- Holding a checked-out client — pg unref()'s the socket after the auth handshake.
- `pool.query('SELECT pg_sleep(3)')` fire-and-forget — appears to fire, but TLA chain still hangs.

## Real root cause (different from the "event loop drains" theory)

`server/db.ts` used `await import('pg')` and `await import('drizzle-orm/node-postgres')` *inside an `if (isLocalDb)` block at module scope*. Even though they're indented, they are **top-level awaits** in the ESM sense. esbuild propagated this TLA into every file that imports db.ts, producing **36 cascading `await init_*()` calls at the module top level in the bundle** (confirmed by `grep -n "^await " dist/index.js`). Any one of those 36 awaits could hang (e.g. `await init_storage()`, `await init_auth()`, etc.) before the startup IIFE at the end ever ran.

## Actual fix

Convert all `await import()` calls in `server/db.ts` to **static `import`** statements. Both drivers (`pg` and `@neondatabase/serverless`) are bundled by esbuild either way, so there is no cost. The runtime `isLocalDb` branch still selects which driver to use. After this change the bundle drops from 36 top-level awaits to exactly 1 (the startup IIFE in `index.ts`).

**Rule to remember:** Any `await` at module scope — even inside an `if` block — is a TLA. Any module that imports a TLA module gets `await init_*()` emitted at its call site in the bundle, which is also a TLA. Prefer static imports in server-side modules; use dynamic `import()` only inside functions.

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
