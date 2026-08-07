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

- `artifacts/api-server` — Express API and server-side business rules
- `artifacts/fnb-cost-pro` — React web application
- `artifacts/fnb-cost-pro-mobile` — Expo mobile companion
- `packages/db` — PostgreSQL schema and Drizzle database package
- `docs/mobile-architecture-reconciliation.md` — historical mobile architecture comparison and consolidation guardrails
- `docs/agent-operating-model.md` — current Builder/Reviewer/QA process

## Architecture decisions

- **Mobile Architecture Decision — Pending Approval:** The historical hybrid Expo app at `https://github.com/bloudon/FnB_mobile.git` (implementation commit `c90f29cd99ae06ac3a3c004ca7724e9cdfb31b50`; architecture handoff `d3d3ff83ebfe74c8da176e86b0ef4463a6455f82`) is recommended as the consolidation base. Keep device-first workflows native and use embedded pages for broad management workflows during transition. The historical `mobileToken` handoff, embedded-route whitelist, and waste voice bridge v1 are baselines; any change needs a separately approved decision. Floor Mode is recommended as a shared role-based shell, but that product decision is pending user approval. See `docs/mobile-architecture-reconciliation.md`.
- **#981 Implementation Note:** Task #981 shipped a native Expo proof of concept with SecureStore-backed bearer tokens, a native dashboard/session list, assigned-store count creation, manual count-line edits, and reviewed sweep-scan application. It does not include the historical WebView bridge, catch-weight flow, voice-waste bridge, i18n, or embedded route contract. Its deviation from those historical conventions is not approved as the long-term architecture.

## Engineering operating model

- Use only the Builder, Reviewer, and QA operational roles described in `docs/agent-operating-model.md`.
- Classify work as Routine or Significant; if risk is unclear, use Significant.
- Significant work requires a PM decision, Builder, separate Reviewer, separate QA, a task report, and external second-opinion review.
- Reviewer and QA outcomes are recorded separately. If independent sessions cannot be verified, report `PROCEDURAL REVIEW — INDEPENDENCE UNVERIFIED`.
- Retained project skills are `.agents/skills/fnb-review`, `.agents/skills/fnb-qa`, and `.agents/skills/fnb-mobile`.
- Workspace Custom Instructions remain a manual Product Owner step; proposed text is in `docs/replit-custom-instructions.md`.

## Product

Food and beverage teams can manage ingredients, vendors, recipes, sales, inventory counts, waste, purchasing, costing, and related operational reporting across web and mobile experiences.

## User preferences

- Preserve working behavior and approved shared contracts unless replacement is explicitly approved.

## Gotchas

- Never bypass company/store/outlet/storage-location scoping.
- Treat costing, valuation, inventory mutations, and shared contracts as Significant work.
- Do not expose long-lived native tokens in WebView URLs; preserve the established mobile bridge and embedded-route whitelist.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `docs/agent-operating-model.md` for the multi-agent engineering workflow
- See `docs/task-reports/README.md` for completion-report requirements
