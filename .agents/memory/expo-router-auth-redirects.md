---
name: Expo Router auth redirects
description: SDK 57 behavior for authentication redirects during persisted-session hydration
---

On Expo SDK 57, do not perform root authentication navigation with a render-time redirect component. Compute the required destination, navigate with a post-render replacement effect, and withhold gated children while hydration or redirecting is in progress.

**Why:** On Android, a persisted-session reload caused the login screen to remount repeatedly until React reported maximum update depth. Moving navigation out of render stopped the loop, and the user confirmed login and reload both worked.

**How to apply:** Use this pattern whenever root routing depends on asynchronously restored credentials. Keep login, native API calls, and embedded authenticated pages on one origin in development so a valid development token is not sent to production.