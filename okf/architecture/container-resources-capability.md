---
type: Architecture Contract
title: Native container resources
description: Expose endpoint-bound Docker and Podman resources through one Redeven-owned execution and operation boundary.
tags: [architecture, containers, docker, podman]
timestamp: 2026-08-28T00:00:00Z
---
# Summary

Redeven owns container management as a native product capability. The
`containerengine` package is the only Docker and Podman execution layer shared
by native Containers and Web Services; `containerresource` is the only native
mutation, persistence, and reconciliation owner. Resources created by Web
Services remain visible but read-only in Containers. Unknown endpoints, stale
preflights, ambiguous outcomes, and failed authoritative observation fail
closed without replaying mutations.

# Contract

## Execution ownership

Every request binds `(engine, endpoint_id, resource kind, canonical identity)`.
Endpoint IDs are opaque projections over Docker contexts or Podman connections.
The engine resolves them again before each read, mutation, stream, and
reconciliation. Docker commands select the resolved context explicitly; Podman
commands select the resolved connection explicitly. Redeven never changes the
user's global engine selection.

The engine supports endpoint status, containers, images, volumes, Docker
Compose Projects, Podman Pods, bounded logs, statistics, and typed mutations.
Docker-only methods reject Podman targets and Podman-only methods reject Docker
targets. Compose configuration paths and engine connection details remain
private. Compose down never removes volumes implicitly.

## Native service boundary

`containerresource` strictly decodes every mutation request and rejects unknown
fields. It recomputes a structured preflight immediately before admission and
requires exact `request_hash` and `plan_hash` agreement. Resource-local locks
serialize operations by engine, endpoint, resource kind, and canonical
identity. A request ID is idempotent only for the same method and hashes;
conflicting reuse fails visibly.

The store kind is `container_resources_product_v1`. It persists operation
identity, bounded state, sanitized errors, events, and redacted reconciliation
evidence, but never raw mutation payloads, argv, engine output, secrets, URLs,
or host paths. On startup, active records are observed through current engine
inventory, then atomically marked interrupted. Startup never replays an
operation whose terminal outcome was not recorded.

Cancellation terminates the owned process group and transitions through the
same operation record. A terminal state is published only after a fresh,
endpoint-bound observation proves presence, absence, desired lifecycle state,
or a bounded inventory snapshot. Unknown results remain explicit.

## Product ownership and permissions

The Local API is under `/_redeven_proxy/api/container-resources` and
`/_redeven_proxy/api/container-resource-operations`. Read covers inventory,
details, logs, statistics, operations, and streams. Lifecycle requires Read and
Execute. Creation, pull, removal, and cleanup require Read, Write, and Execute.
High-risk preflights additionally require Admin and exact-name confirmation.
Server-side enforcement is authoritative; disabled UI controls are only a
presentation aid.

Web Services is the lifecycle owner of containers, Compose Projects, and
volumes it creates. Native inventory labels those resources as managed, offers
a direct jump to the owning service, and rejects mutation attempts on the
server. Web Services projects the same canonical resource identity back to
Containers. The two surfaces share identity and observed state, never parallel
lifecycle implementations.

## Data and host safety

DTOs expose only typed, redacted fields. They never return raw inspect output,
environment values, arbitrary label values, credentials, socket paths,
certificates, remote URLs, or Compose file paths. Public errors omit command
arguments, stderr, raw output, tokens, URLs, and host paths.

CLI execution uses explicit argv, bounded time, bounded output, and process
group termination. Redeven does not elevate privileges, change socket
permissions, add users to system groups, or silently switch engines. Host
administrators remain responsible for engine access.

## Native surfaces

Containers has a fixed Activity entry and a multi-instance
`redeven.containers` Workbench component. Each instance persists engine,
endpoint, and selected resource view independently. Desktop uses a compact
master-detail workspace; mobile uses a resource selector, card list, and
full-screen detail. The endpoint command bar keeps engine, endpoint health,
refresh, and Operations in one stable control area. Resource views expose
type-specific columns plus local search and lifecycle filters instead of a
generic name/status/details projection.

Selecting a resource opens a structured inspector for identity, ownership,
health, runtime settings, and published ports. Redacted wire data remains
available only through an explicitly collapsed technical-details section; it
is never the default product presentation. A shared Operations drawer keeps
endpoint and target identity visible.

The UI provides structured create dialogs and a separate risk review before
submission. It supports keyboard operation, 44 px touch targets, forced colors,
reduced motion, and every shipped locale. Stale or unavailable inventory is
shown explicitly and cannot authorize destructive work.

# Boundaries

- `containerengine` owns typed Docker and Podman execution and redaction.
- `containerresource` owns native mutation admission, locking, persistence,
  cancellation, events, and reconciliation.
- Web Services owns the lifecycle of resources it created.
- ReDevPlugin remains the platform for other plugins and has no Containers
  capability, adapter, package, generated client, or native UI role.
- The host administrator owns engine installation and operating-system access.

# Evidence

- `redeven:internal/containerengine/adapter.go` - Defines the shared typed engine boundary.
- `redeven:internal/containerengine/resources_v4_cli.go` - Resolves opaque endpoints and constructs explicit Docker and Podman commands.
- `redeven:internal/containerresource/service.go` - Owns strict preflight admission, operations, cancellation, and startup observation.
- `redeven:internal/containerresource/schema.go` - Defines the Redeven-owned product database lineage.
- `redeven:internal/codeapp/appserver/container_resources.go` - Enforces native Local API routes and RWX/Admin permissions.
- `redeven:internal/managedwebservice/container_resources.go` - Resolves protected Web Services ownership.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx` - Implements the native responsive product surface.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx` - Registers the multi-instance Workbench component.
