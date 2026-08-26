---
name: Bulk pack-size approval boundary
description: Rules for safely creating Orderly pack-size variants from bulk review actions.
---

Bulk selection is a convenience layer, not an authorization boundary. Approval must independently allow a separate variant only when the reviewed row has verified `new_pack_size` evidence and an incompatible pack; incomplete or unknown pack evidence remains a source-data blocker.

**Why:** A client can submit an individual decision payload directly, bypassing even a deliberately strict bulk selector. Treating unknown geometry as an incompatible pack can create a duplicate catalog item from unverified source data.

**How to apply:** Keep bulk groups fail-closed: every row sharing the source code must be eligible, resolve to one reviewed comparable item, and agree on vendor and source pack facts. Preserve individual review for excluded rows, and cover both the server rejection path and the explicit UI confirmation path.