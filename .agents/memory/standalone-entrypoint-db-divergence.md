---
name: Standalone entrypoint database divergence
description: Why a standalone CLI can fail a query that the API and psql both run fine, and the rule that prevents it.
---

A standalone script that imports the shared database module must load the same environment and build with the same bundler options as the server entrypoint.

**Why:** The shared initializer selects its driver at import time from environment flags and falls back to the serverless/WebSocket driver when they are absent. The server entrypoint loads its env file before importing the DB module; a standalone entrypoint that omits that import sees an empty environment, silently picks the *other* driver, and fails on its first real query against a database the API and `psql` both use successfully. The resulting error surfaces as the failed application query (for example, a tenant scope lookup returning no row), so it reads like missing data or a wrong ID rather than a driver/transport mismatch. A separate inline bundler invocation compounds this by externalizing driver packages and omitting the CJS-interop banner, producing a runtime that differs from the server's.

**How to apply:** Build every operator script through the same build configuration as the server, keep the env-loading import first in the entrypoint (above imports that transitively pull in the DB module), and have failures print the driver plus the credential-stripped host/database. When a query fails only in a standalone tool, compare the selected driver and connection target before doubting the IDs — verified-correct rows are strong evidence the process is on the wrong driver or the wrong database.
