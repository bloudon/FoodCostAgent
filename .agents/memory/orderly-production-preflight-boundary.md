---
name: Orderly production preflight boundary
description: Durable safety boundary between Orderly production readiness checks and the later authorized preview or APPLY.
---

A production preflight for the frozen Orderly adoption must be strictly
read-only readiness evidence, not a substitute production preview. It may verify
the reviewed build, local serving API identity, database identity, immutable
manifest/source evidence, approved property binding, required schema invariants,
catalog integrity, and a stable catalog fingerprint. It must not invoke the
adoption classifier, state CREATE outcomes, or write catalog, audit, price,
invoice, or conflict data.

**Why:** A readiness command that emits live classifications can be mistaken for
the authoritative production preview and bypass the separate PM review of real
production drift. A checkout alone also cannot prove the running API serves the
reviewed build; both evidence and the active local API identity must fail closed.

**How to apply:** Keep production preview, PM approval, bounded APPLY, and
post-APPLY verification as distinct later stages. For any future production
preflight, hard-pin the approved source property, require exact frozen evidence,
and bind the locally serving API build identity, database target, and scope to
the reviewed rollout record before opening a read-only transaction.