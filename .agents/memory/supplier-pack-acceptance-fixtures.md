---
name: Supplier pack acceptance fixtures
description: Why a supplier-pack API-ready fixture may still hide the browser approval form
---

For authenticated browser acceptance of supplier-pack replacement decisions, a test fixture must satisfy both item-detail visibility in the user's selected store and dated current supplier evidence for at least two products. Verified pack geometry alone can pass the approval API's product checks while the browser form remains hidden.

**Why:** An isolated acceptance run encountered two successive fixture-only blockers: the item detail could not render in the selected store, and after that was resolved, the read-only history showed no selectable current products. Neither indicated a product-code defect.

**How to apply:** Before assigning a browser test to submit a supplier replacement, inspect the store-scoped item detail and the history GET response for two current-vendor events. Keep the fixture company isolated and remove its sessions, decisions, and source rows after testing.