# GA4 Analytics Smoke-Test — fnbcostpro.com

**GA4 Property:** G-5YH6X21RM4  
**Guard:** Events fire only on `fnbcostpro.com` / `www.fnbcostpro.com`.  
All other origins (localhost, `*.replit.dev`, `app.fnbcostpro.com`) log to
`console.debug` only and never call `window.gtag`.

---

## Pre-flight

1. Open Chrome, navigate to **https://www.fnbcostpro.com**.
2. In a separate tab, open **GA4 → Admin → DebugView**
   (Property G-5YH6X21RM4 → DebugView).
3. In Chrome DevTools, open the **Console** tab and run:
   ```js
   sessionStorage.setItem('_ga_debug_mode', '1');
   ```
   Then reload the page so GA4 DebugView starts picking up your session.

---

## Event checklist

Exercise each action and confirm the event appears in DebugView within ~5 s.
All events must carry `page`, `language`, and `timestamp` custom parameters.

| # | Action | Expected event | Required extra params |
|---|--------|---------------|-----------------------|
| 1 | Load `/` (homepage) | — | *(pageview via use-ga4 only)* |
| 2 | Click **"Schedule a Culinary Review"** hero button | `hero_cta_click` | `language` |
| 3 | Click **"See How It Works"** secondary button | `secondary_cta_click` | `language` |
| 4 | Scroll past the workflow strip section | `workflow_section_viewed` | `language` |
| 5 | Navigate to `/pricing` | `pricing_page_viewed` | `language` |
| 6 | Navigate to `/for-chefs` | `for_chefs_page_viewed` | `language` |
| 7 | Navigate to `/for-fb-leaders` | `for_fb_leaders_page_viewed` | `language` |
| 8 | Navigate to `/platform` | `platform_section_viewed` | `language` |
| 9 | Navigate to `/industry/chef-led` | `industry_page_viewed` | `language`, `segment=chef-led` |
| 10 | Navigate to `/industry/restaurant-groups` | `industry_page_viewed` | `language`, `segment=restaurant-group` |
| 11 | Navigate to `/industry/clubs-resorts` | `industry_page_viewed` | `language`, `segment=clubs-resorts` |
| 12 | Navigate to `/contact`, click first form field | `contact_form_started` | `language` |
| 13 | Fill and submit the contact form | `contact_form_submitted` | `language` |
| 14 | Click the **ES** language toggle | `language_switched` | `language`, `from=en`, `to=es` |
| 15 | Click the **EN** language toggle | `language_switched` | `language`, `from=es`, `to=en` |

---

## What to do if an event does not appear

1. **Check the browser console for the `[analytics]` debug line.**
   If it prints there but DebugView shows nothing, the domain guard passed but
   `window.gtag` was not found — check that `index.html` loaded the
   `googletagmanager.com/gtag/js?id=G-5YH6X21RM4` script without a CSP or
   ad-blocker blocking it.

2. **No console line at all** — the call site was not reached. Add a
   temporary `console.log` near the `track(...)` call to confirm the handler
   fires. Common causes: button onClick not wired, IntersectionObserver
   threshold not met (scroll more), form never submitted.

3. **DebugView shows the event but params are missing** — the `props` argument
   to `track()` in the component is incomplete. Each page/component must
   explicitly pass `{ language: lang, ... }` because `track()` only
   auto-appends `page` and `timestamp`.

4. **Double-fire on the same page** — `usePageEvent` deduplicates within a
   single pathname (uses `firedRef`). If you see duplicates, the component is
   mounted more than once. Investigate the router or layout tree.

---

## Code locations

| File | What it controls |
|------|-----------------|
| `client/src/lib/analytics.ts` | `isMarketingDomain()` guard, `track()`, `usePageEvent()`, `useInViewEvent()` |
| `client/src/hooks/use-ga4.ts` | Pageview `gtag('config', ...)` calls on every route change |
| `client/index.html` | gtag.js script tag + `window.dataLayer` bootstrap |
| `client/src/components/website/marketing-layout.tsx` | `language_switched` event (language toggle) |
| `client/src/pages/website/home.tsx` | `hero_cta_click`, `secondary_cta_click`, `workflow_section_viewed` |
| `client/src/pages/website/contact.tsx` | `contact_form_started`, `contact_form_submitted` |
| `client/src/pages/website/pricing.tsx` | `pricing_page_viewed` |
| `client/src/pages/website/for-chefs.tsx` | `for_chefs_page_viewed` |
| `client/src/pages/website/for-fb-leaders.tsx` | `for_fb_leaders_page_viewed` |
| `client/src/pages/website/platform.tsx` | `platform_section_viewed` |
| `client/src/pages/website/industry-*.tsx` | `industry_page_viewed` with `segment` |

---

## Code-level review results (as of 2026-07-30)

All 15 events above are wired in the correct components. One code defect was
found and fixed:

| Event | Issue | Fix applied |
|-------|-------|-------------|
| `language_switched` | Missing `language` property — only `from` / `to` were passed | Added `language: lang` to both toggle `onClick` calls in `marketing-layout.tsx` |

No other events had missing properties. All events pass `language: lang`
explicitly, and `track()` appends `page` and `timestamp` automatically.
