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

- **Mobile Architecture Decision — Approved 2026-08-07:** The historical hybrid Expo app at `https://github.com/bloudon/FnB_mobile.git` (implementation commit `c90f29cd99ae06ac3a3c004ca7724e9cdfb31b50`) is the approved consolidation base and has been merged into `artifacts/fnb-cost-pro-mobile`. Task #981's native proof of concept is NOT a second long-term architecture; only its assigned-store count start, session browsing, manual line editing, and reviewed sweep-scan matching capabilities are retained where they fit the approved contracts.
- **Mobile Ownership Boundaries — Approved 2026-08-07:** Native owns authentication, navigation, inventory session/count workflows, camera and scanning, catch weight, and voice capture. Embedded WebView pages own recipes, vendors, reports, billing, complex settings, and waste resolution/submission during the transition.
- **Embedded WebView Auth — Approved 2026-08-07 (blocked pending evidence):** The target of moving embedded pages to a short-lived web-session token could NOT be evidence-verified — no `/api/mobile/auth/web-token` or equivalent exchange exists in this repo; the only verifiable contract is the opaque 30-day session token from `/api/mobile/login` accepted via Bearer/cookie by `requireAuth`. Per the approved decision, the existing historical `mobileToken` bridge and embedded-route whitelist are preserved unchanged. Any auth change requires a separately approved decision with production evidence.
- **Floor Mode — Approved 2026-08-07:** Floor Mode remains OUTSIDE the consolidation scope. Do not merge it, create role-based behavior for it, replace it, or infer its future relationship. Its earlier shared-shell recommendation stays a pending product decision.
- **Deferred cleanup — DONE 2026-08-07:** Historical/#981 duplicate files (`components/AuthGuard.tsx`, `hooks/useAuth.tsx`, `hooks/useApi.ts`, `lib/api.ts`, `app/scan.tsx`, `app/(tabs)/settings.tsx`) have been removed. All live code imports from `@/context/AuthContext` and the canonical hooks; the #981 hidden tab entry has been cleaned from `(tabs)/_layout.tsx`. See `docs/mobile-architecture-reconciliation.md`.
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
- **zod / @hookform/resolvers must stay on compatible major versions.** `resolvers v5.x` requires `zod v4.x`; `resolvers v3.x/v4.x` requires `zod v3.x`. Upgrading one without the other breaks all form schema types silently (no runtime error — only TypeScript type errors). After any `pnpm update` touching either package, run `pnpm --filter @workspace/fnb-cost-pro run check-deps` to verify. The compatibility table lives in `artifacts/fnb-cost-pro/scripts/check-zod-resolvers-compat.mjs`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `docs/agent-operating-model.md` for the multi-agent engineering workflow
- See `docs/task-reports/README.md` for completion-report requirements
