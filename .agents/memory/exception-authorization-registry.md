---
name: Non-forgeable exception authorizations
description: How to gate a narrow data-repair exception so generic service callers cannot invoke it
---
A structural policy object is forgeable: exported interfaces + a self-consistency assert prove nothing, since any caller can fabricate matching fields. **Why:** reviewer blocked an Option A merge rule twice — first for being unconditional in the generic service, then because the "code-owned" policy was a plain object anyone could construct; an env-var test gate was also rejected because callers can flip process.env at runtime.
**How to apply:**
- Keep a module-private registry (Set) of frozen approved policy INSTANCES; the assert checks membership by reference identity before any field checks.
- Declare production policies as frozen constants inside the registry module so instance and allowlist cannot diverge.
- Gate the test-only registration hook on an `IS_TEST_ENV` constant captured at module LOAD, not a live env read; prove it with a subprocess regression test (spawn without test env, flip env after import, expect refusal).
- Fail loud on a mis-bound authorization (wrong manifest/hash/scope/count) rather than silently downgrading to unauthorized behavior.
- Unapproved shapes (e.g. no canonical retention source) fail closed even WITH a valid authorization until separately approved.
