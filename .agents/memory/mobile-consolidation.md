---
name: Mobile count & WebView constraints
description: Durable architectural decisions for the FnB Cost Pro mobile client
---

- Embedded WebView auth stays on the native-token bridge; any move to short-lived exchanged tokens needs a new approved decision plus a real server endpoint. **Why:** no exchange endpoint exists and the approved decision requires production evidence first.
- WebViews must never forward the mobile bearer token off-origin: token injection is restricted to same-origin requests. **Why:** the long-lived token would otherwise leak to any third-party origin an embedded page touches.
- Count-edit concurrency policy: relative edits (steppers, scan additions) go through the server's atomic increment dialect and the display reconciles from the server-returned quantity; absolute writes are reserved for explicit typed "shelf holds N" input (last write wins, still server-reconciled). **Why:** client-computed absolute sums lose concurrent updates across devices.
