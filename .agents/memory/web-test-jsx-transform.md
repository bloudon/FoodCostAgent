---
name: Web component tests and the JSX transform
description: Why every React component test failed with "React is not defined", and what the vitest config must declare.
---

# Web component tests and the JSX transform

## "React is not defined" in component tests means the classic JSX runtime is in use

If every React component test in the web app fails with `ReferenceError: React is
not defined` at the component's `return (` line, the test transform is emitting
classic `React.createElement` calls instead of the automatic runtime. Components
that don't import the React namespace then blow up at render.

**Why:** the vitest config declared the automatic runtime only under the `oxc`
option, but the resolved Vite version transforms with esbuild, which ignores
`oxc` entirely and falls back to the classic runtime. The result looked like a
broken test environment and was written off as "pre-existing unrelated
failures" for a long time — it was a one-line config gap affecting the entire
component suite.

**How to apply:** declare the automatic JSX runtime for the transform that is
actually running, and keep both declarations if the toolchain could resolve
either transform. Verify with a minimal probe test that renders a trivial
component rather than debugging a large suite.

## Don't accept a large block of failing component tests as environmental

A suite-wide identical error is far more likely to be one config defect than
many broken tests. Reproduce it with the smallest possible component before
concluding it is pre-existing noise unrelated to your change.
