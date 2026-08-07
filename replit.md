# FnB Cost Pro

Restaurant inventory, cost, counting, and management tools with web and mobile experiences.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- **Mobile Architecture Decision — Pending Approval:** The historical hybrid Expo app at `https://github.com/bloudon/FnB_mobile.git` (implementation commit `c90f29cd99ae06ac3a3c004ca7724e9cdfb31b50`; architecture handoff `d3d3ff83ebfe74c8da176e86b0ef4463a6455f82`) is recommended as the consolidation base. Keep device-first workflows native and use embedded pages for broad management workflows during transition. The historical `mobileToken` handoff, embedded-route whitelist, and waste voice bridge v1 are baselines; any change needs a separately approved decision. Floor Mode is recommended as a shared role-based shell, but that product decision is pending user approval. See `docs/mobile-architecture-reconciliation.md`.
- **#981 Implementation Note:** Task #981 shipped a native Expo proof of concept with SecureStore-backed bearer tokens, a native dashboard/session list, assigned-store count creation, manual count-line edits, and reviewed sweep-scan application. It does not include the historical WebView bridge, catch-weight flow, voice-waste bridge, i18n, or embedded route contract. Its deviation from those historical conventions is not approved as the long-term architecture.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
