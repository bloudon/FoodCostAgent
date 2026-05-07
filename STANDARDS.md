# FnB Cost Pro — Development Standards

Ratified and authoritative. These govern all feature work, AI assistance, and architectural decisions on this project. Last updated: May 2026.

---

## Product Principles

- **Simplicity over configurability** — prefer sensible defaults over option sprawl.
- **Mobile-first operational workflows** — floor tasks are designed for phone first; desktop is secondary for management views.
- **Reduce cognitive load for restaurant operators** — minimize decisions required during busy service. A chef at 6am has different needs than an owner reviewing Sunday variance; both deserve a low-friction experience.
- **AI should assist, not replace operator control** — AI suggests, humans approve. The scan-and-review pattern is the template.
- **Avoid duplicate concepts** — one count session model, one recipe model. Not separate mobile/web versions of the same data or workflow.
- **Minimize required data entry** — scan-first, smart defaults, infer from context wherever safe.
- **Forecasting must always show confidence levels** — never present AI predictions as certainties. Governs future par level suggestions, order quantity forecasting, and theoretical yield predictions.
- **All automation should be reviewable** — users can always see what an automated action did and why.
- **Inventory workflows must tolerate imperfect data** — partial counts are valid. The system should warn about data gaps without refusing to operate.
- **Never block operational continuity** — the app must degrade gracefully during service. A failed API call should never prevent a count from being recorded. Destructive actions on in-use data require explicit confirmation.
- **Offline-tolerant workflows preferred where possible** — applies specifically to Expo app floor workflows (counting in walk-in coolers with spotty WiFi). The web SPA is inherently online.
- **Tenant data is sacred** — multi-tenant isolation is never compromised for convenience, feature velocity, or debugging ease. No cross-company data access, ever, including in admin tooling.

---

## Technical Standards

- **Shared types** — `shared/schema.ts` is the single source of truth for all data models. Frontend and backend share types from here.
- **No duplicated business logic** — if the same calculation or validation exists in two places, consolidate it.
- **All AI-generated data must include confidence metadata** — OCR results, inventory recognition, recipe extraction, and forecasting outputs must carry confidence scores where applicable.
- **Critical operational actions require audit logging** — receipts, transfers, waste logs, count applies, and similar actions must record who did what and when.
- **API response standard**:
  - Success: `{ data: ... }` with appropriate 2xx status
  - Failure: `{ error: string }` with appropriate 4xx/5xx status
  - HTTP status codes must be used correctly and consistently.
- **Gradual decomposition over monolith expansion** — `server/routes.ts` is currently >17,000 lines. It must not grow unnecessarily. New routes should be grouped by domain where practical:
  - `inventory`
  - `recipes`
  - `vendors`
  - `purchasing`
  - `prep`
  - `forecasting`
  - `AI ingestion`
  - `auth/admin`
- **Shared business logic into service functions** — logic should not live directly inside route handlers. Extract incrementally.
- **Refactoring is incremental and risk-aware** — do not rewrite large working areas solely for cleanliness before beta.

---

## UX Language Standards

- Use industry-standard F&B terms where they aid operator credibility.
- **TFC / Theoretical Food Cost** is acceptable but should be spelled out on first use per session.
- Avoid exposing internal feature names as user-facing labels unless explained.
- **"Sweep scan"** and **"catch-weight scan"** are internal/product terms — not validated with users. Use plain language in UI copy:

| Internal term | User-facing copy |
|---|---|
| Sweep scan | Scan shelves |
| Apply scan results | Review counted items |
| Catch-weight scan | Capture variable-weight items |
| Apply session | Confirm inventory |
| Create PO | Build order |

- When a product-specific term is necessary, pair it with a short helper description.
- **AI suggestions must be visually distinct from confirmed data** — use a badge, color treatment, or icon to differentiate AI-proposed values from operator-entered ones.
- **One primary action per screen** — especially on mobile. Secondary actions use progressive disclosure.
- **Default workflows should require minimal training** — a new crew member should be able to complete a count without a manual.

---

## AI Operational Rules

- **Never silently overwrite operator-entered data** — AI may suggest corrections, but the operator must explicitly accept them.
- **Always preserve original extracted values** — store raw AI output alongside any processed/accepted version.
- **AI suggestions require traceability** — the user must be able to see where a suggestion came from (which scan, which model, which confidence score).
- **Confidence scoring is required for**:
  - OCR results
  - Inventory item recognition
  - Forecasting outputs
  - Recipe extraction
- **Low-confidence outputs go to a review queue** — never auto-apply below a defined confidence threshold. Flag for human review before use.

---

## Beta Refactoring Principle

Do not pause beta-readiness to clean up architecture unless the current structure blocks reliability, security, or critical feature work.

During beta:

- **Stabilize first** — fix bugs and harden existing workflows before refactoring.
- **Isolate new work by domain** — new features go into their own files/modules, not into existing monoliths.
- **Extract services opportunistically** — when touching an area anyway, extract logic into a service function. Don't do it speculatively.
- **Document known debt** — note tech debt inline or in replit.md rather than fixing it mid-feature.
- **Avoid heroic rewrites** — no full rewrites of working systems before beta ships.
