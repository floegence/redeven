---
type: AI Product Contract
title: Tessiven Flower tools and scoped Runtime operations
tags: [tessiven, runtime, desktop, gateway, security]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Flower maps authorized code, configuration and Runtime facts into canvas versions. Resource discovery and explicit actions reuse original registries and executors with exact bindings. Missing authority never substitutes a local route, and unknown mutations require original-operation inspection before any new attempt.

# Contract

## Runtime operations
Discovery starts no process/business session and path refs grant no authority. Identity/generation changes or revocation stop input.

### Official surface
- `tessiven.runtimes` / `GET /_redeven_proxy/api/tessiven/runtimes` returns independent source availability and exact target paths.
- `tessiven.runtime.inspect` / `POST .../runtimes/inspect` reads status, bounded public diagnostics, or the original Desktop operation.
- `tessiven.runtime.action` / `POST .../runtimes/actions` requests connection or one supported `start`, `stop`, `restart`, or `update` process operation.
- `tessiven.inspect/action` retain the canonical canvas version, bound instance, and resource identity checks for Managed Services and containers.

For tessiven.action, open prepares and returns entrance information for the
running bound service and may run its preparation hook. It does not launch a
browser or start a stopped service. A returned operation_id can be queried through
the corresponding inspect action=operation; absence of an ID is not retry authority.

No sibling module, replacement SDK, or product lifecycle queue is introduced.

### Source authority and discovery
Desktop registers its Tessiven host through owner-authenticated private Runtime control. Web Service, CodeSpace, nested frame, unrelated-origin and worker requests cannot declare a native source.

Ambiguous references fail closed.

### Connection and business access
Explicit connect reuses saved configuration and existing connection leases.

It cannot carry claimed permission flags, an arbitrary URL, another Runtime reference, or a process-lifecycle action.

Member removal and replacement retire the transport; no local or alternate route is substituted.

### Native lifecycle handoff
Process actions use saved direct Desktop placements and the existing [Desktop lifecycle owner](../desktop/desktop-runtime-process-lifecycle.md#process-lifecycle). The model cannot choose a download URL or release version; the existing release selector owns updates and post-operation verification.

Unknown connection outcomes require checking the selected connection in its native owner rather than retrying.

## Flower document tools
- Tessiven tools read the canonical schema, list/read/validate versions, save a complete new version, inspect explicit targets, and execute one exact bound instance when the existing permission and approval checks allow it.
- Read-only inspection of a missing, non-current, or unauthorized Runtime returns structured `unavailable` state without a binding. Unknown mutation outcomes disable another mutation until the original manager has been inspected.

## Exact resources and partial inventory

`inspect`, `logs` and `operation` accept a direct resource binding without any
canvas fields or a canvas library. A manually added `port_forward` is an address
reference without a management binding; inventory and matching names cannot
establish its backing service. Canvas-backed queries retain their immutable version/instance
resolution. Managed bindings call the original manager's exact-ID `Inspect`,
not its all-service inventory. Their credential-free `service` projection
contains description, deployment, template, configured workspace, port and
current release, never settings, session URLs or credentials.

`list` returns `complete` and scoped `issues` alongside confirmed resources.
A failed manager, endpoint or container read does not erase independent results;
not-installed engines require no inventory. Unread scopes are not empty scopes.
Cancellation remains an error. Direct target failures remain explicit and never
select another resource or discover a canvas. The tool description carries this
contract at the final provider boundary.

# Boundaries

### UI and compatibility
The Connected environments panel and Runtime node entry use this same service. The Runtime Dialog is part of the loaded Tessiven page; opening it must not suspend the page or show its navigation loading placeholder.

Gateway v6 application access, Tessiven DSL, and persistent database lineages retain their current shapes.

Flower and the UI call the same Tessiven service; neither writes its database directly. Explicit connection uses the original native owner; missing authority never substitutes a local target. External and unmanaged resources support inspection and explanation only.

# Evidence

- `internal/tessiven/resources_test.go` — Exact-ID selection, scoped partial failures, cancellation and identity refusal.
- `internal/ai/tessiven_tools_test.go` — Direct resources without a canvas library, with read permission enforcement.

- `internal/managedwebservice/open_session_test.go` — Running entrance preparation and stopped-service refusal without lifecycle dispatch.
- `internal/ai/tool_contract_clarity_test.go` — Final provider-visible descriptions across four routes.
- `internal/tessiven/runtimes.go`
- `internal/tessiven/broker_test.go` — Unattributed/device-generation denial, permission recheck and unknown effects.
- `internal/codeapp/appserver/tessiven_source_test.go` — Public-header rejection and post-confirmation source revocation.

- `internal/tessiven/context_test.go`
- Tests.
- `internal/ai/system_skills/redeven-tessiven/SKILL.md`
- Source.
- `internal/ai/tessiven_tools.go`
