---
name: Authoritative import approval boundary
description: Why staged-import approval resolves its destination from a server-persisted source-property binding, and the route-connector test gap that hid a total auth failure.
---

# Shared approval services must be authoritative and fail closed

An optional "approved store ids" style parameter on a shared service is an
authorization bypass, not a convenience. Treat a null/omitted authorization
context as REJECT, never as "caller opted out".

**Why:** The staged-import approval service previously accepted a nullable acting
user and an optional store allowlist whose null value explicitly meant "skip the
check". Any caller that forgot the argument silently got unauthenticated,
unauthorized approval into an arbitrary store.

**How to apply:** A shared ingestion/mutation service should re-read the acting
user, its company authorization, and its store access from the database itself
rather than trusting anything the caller passes. Run every check before the
transaction so a rejected call performs zero writes.

# Destination authority comes from a persisted binding, not the request

The Orderly workbook carries no trustworthy restaurant identifier, so the
destination store for a migration import cannot be derived from file contents or
from whatever store the client selected.

The generic model is `source_system + source_property_id -> company +
destination store`, persisted server-side and globally unique on
(source_system, source_property_id). A staged batch stores which binding it was
staged against plus a snapshot of the source property it claims; approval
re-validates all three and refuses when the stored destination disagrees with
the binding.

**Why:** Without this, a request (or a tampered stored destination) can redirect
an approved batch into another club's store, and two companies could both claim
the same source property.

**How to apply:** Keep the binding table generic — do not add source-specific
columns to core domain tables. Batches staged before a company adopts bindings
have null binding columns and must keep working without gaining a new bypass.

# Direct-service tests cannot see a broken route connector

A full suite of service-boundary tests can be green while the HTTP endpoint is
100% broken, because those tests call the service directly and skip the route.

**Why:** The approve route read the acting user from a request property the auth
middleware never sets, so every real HTTP approval failed closed with 401 — and
20 passing direct-service tests plus a clean typecheck showed nothing.

**How to apply:** When a service is hardened to require identity, add at least
one test that mounts the real route module with an auth stub that mirrors
production middleware exactly — setting only the properties auth actually sets,
and deliberately NOT the one the handler is suspected of reading. Assert the
persisted actor id, not just the status code.
