---
name: Bulk pack-size approval boundary
description: Rules for safely creating Orderly pack-size variants from bulk review actions.
---

Bulk selection is a convenience layer, not an authorization boundary. The server must independently allow a shared decision only when the complete reliable source-code group stays within one server-derived description-plus-pack identity. Approval must allow a separate variant only when every reviewed row has verified `new_pack_size` evidence and an incompatible pack; incomplete or unknown pack evidence remains a source-data blocker.

**Why:** A client can submit a complete-looking group payload directly, bypassing even a deliberately strict bulk selector. Source-code membership alone does not prove product identity, and treating unknown geometry as incompatible can create a duplicate item from unverified data.

**How to apply:** Under the batch lock, recompute group membership and identity, reject missing/divergent identity keys, then require every source-code row to be eligible and resolve to one reviewed comparable item. Preserve individual review for exclusions and test server rollback plus explicit UI confirmation.