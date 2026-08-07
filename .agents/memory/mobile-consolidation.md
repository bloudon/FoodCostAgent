---
name: Mobile consolidation constraints
description: Durable constraints from consolidating the hybrid Expo client (FnB Cost Pro mobile)
---

- Embedded WebView auth stays on the `mobileToken` bridge: no short-lived web-token endpoint exists in this repo. **Why:** approved decision requires evidence before any auth change; audit found only the opaque 30-day `/api/mobile/login` token. **How to apply:** any move to short-lived tokens needs a new approved decision plus a real server endpoint.
- `react-native-webview` must stay pinned at 13.15.0 until types are fixed upstream. **Why:** 13.17.x collapses WebView props to `never` under @types/react 19.1.17, breaking typecheck with cascading implicit-any errors.
- The mobile tsconfig references `lib/api-client-react` as a composite project; run `tsc -b lib/api-client-react` after editing that lib or mobile typecheck fails with TS6305.
- api-server vitest has 4 pre-existing environmental failures (menuInsightsService, orderGuideProcessor, PdfOrderGuide, SalesByItemParser — pdf-parse exports / missing xlsx fixture); don't attribute them to new work.
- Historical/#981 duplicate files (hooks/useAuth.tsx, components/AuthGuard.tsx, hooks/useApi.ts, lib/api.ts) are intentionally retained dead code; cleanup is a separately approved follow-up after device regression evidence.
