---
type: AI Product Contract
title: Tessiven Runtime discovery and operations
description: Discover scoped Runtime paths and delegate explicit connection, business access, and native process operations to their existing owners.
tags: [tessiven, runtime, desktop, gateway, security]
timestamp: 2026-10-12T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Runtime-owned Tessiven product service is the authority for UI and Flower
Runtime discovery and dispatch. It composes the existing Desktop connection
registry, authenticated Gateway catalogs, Runtime business resource executors,
and Desktop lifecycle coordinator. Discovery observes registered paths without
starting a process or acquiring a business session. A reference identifies one
path; it grants no permission. Lost source authority, changed path generations,
replaced identities, and revoked permissions stop dispatch. A lost mutation
response reports an uncertain canonical tool outcome. The model first inspects
the original operation or current state before deciding what work remains; the
original invocation never replays automatically.

# Contract

## Official surface
- `tessiven.runtimes` / `GET /_redeven_proxy/api/tessiven/runtimes` returns   independent source availability and exact target paths. - `tessiven.runtime.inspect` / `POST .../runtimes/inspect` reads status,   bounded public diagnostics, or the original Desktop operation. - `tessiven.runtime.action` / `POST .../runtimes/actions` requests connection   or one supported `start`, `stop`, `restart`, or `update` process operation. - `tessiven.inspect/action` retain the canonical canvas version, bound instance,   and resource identity checks for Managed Services and containers.

No sibling module, replacement SDK, or product lifecycle queue is introduced.

## Source authority and discovery
Desktop registers its Tessiven host through owner-authenticated private Runtime control. Web Service, CodeSpace, nested frame, unrelated-origin and worker requests cannot declare a native source;

Ambiguous references fail closed.

## Connection and business access
Explicit connect reuses saved configuration and existing connection leases.

It cannot carry claimed permission flags, an arbitrary URL, another Runtime reference, or a process-lifecycle action.

Member removal and replacement retire the transport; no local or alternate route is substituted.

## Native lifecycle handoff
Process actions use saved direct Desktop placements and the existing [Desktop lifecycle owner](../desktop/desktop-runtime-process-lifecycle.md). The model cannot choose a download URL or release version; the existing release selector owns updates and post-operation verification.

Unknown connection outcomes require checking the selected connection in its native owner rather than retrying.

# Boundaries

## UI and compatibility
The Connected environments panel and Runtime node entry use this same service. The Runtime Dialog is part of the loaded Tessiven page; opening it must not suspend the page or show its navigation loading placeholder.

Gateway v6 application access, Tessiven DSL, and persistent database lineages retain their current shapes.

# Evidence

- `internal/tessiven/runtimes.go` — Scoped directory, local host catalog and fixed local business executor.

- `internal/tessiven/broker_test.go` — Unattributed/device-generation denial, permission recheck and unknown effects.

- `internal/codeapp/appserver/tessiven_source_test.go` — Public-header rejection and post-confirmation source revocation.
