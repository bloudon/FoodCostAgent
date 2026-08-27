---
name: Durable approval retries
description: Safety rules for long-running, irreversible approvals that can be retried after an apparently stalled request.
---

# Long-running approval retries need leases, recovery, and atomic results

Every asynchronous approval attempt must own a fenced generation/lease. Recheck
that lease under the same lock used for the irreversible mutation, and condition
progress, failure, and completion writes on that generation. A retry may reclaim
an expired lease, but a stale runner must be unable to mutate or relabel the new
attempt.

**Why:** A batch lock prevents duplicate catalog writes but does not by itself
prevent an old timed-out runner from overwriting a newer job's status. Writing
the completed result after the mutation also leaves a crash window where data is
approved but the durable job still appears stalled.

**How to apply:** Authorize before any batch metadata read or job write; recover
expired running leases independently of browser polling; serialize cross-batch
business invariants inside the authoritative transaction; write the approved
result and completed job state atomically with the domain mutation.