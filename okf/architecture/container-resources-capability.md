---
type: Architecture Contract
title: Native container resources
description: Aggregate the active Docker and Podman runtimes behind one Redeven-owned execution and operation boundary.
tags: [architecture, containers, docker, podman]
timestamp: 2026-08-28T00:00:00Z
---
# Summary

Redeven owns container management as a native product capability. The
`containerengine` package is the only Docker and Podman execution layer shared
by native Containers and Web Services; `containerresource` is the only native
mutation, persistence, and reconciliation owner. Resources created by Web
Services remain visible but read-only in Containers. Unknown runtime targets, stale
preflights, ambiguous outcomes, and failed authoritative observation fail
closed without replaying mutations.

# Contract

## Execution ownership

Every request binds `(engine, endpoint_id, resource kind, canonical identity)`.
Endpoint IDs are opaque internal projections over Docker contexts or Podman
connections. The product discovers at most one active target per engine:
Docker's current context and Podman's default connection, falling back to the
local Podman runtime when no default connection exists. Docker and Podman are
detected independently and concurrently. Inactive contexts and connections are
not probed, listed, or used as fallback targets.

Discovery reports `ready`, `not_installed`, `stopped`, `permission`,
`unreachable`, or `error` for each engine. One engine failure never suppresses
the other engine's state or resources. The engine resolves every ready endpoint
again before each read, mutation, stream, and reconciliation. Docker commands
select the resolved context explicitly; Podman commands select the resolved
connection explicitly. Redeven never changes the user's global engine
selection.

The engine supports endpoint status, containers, images, volumes, Docker
Compose Projects, Podman Pods, bounded logs, endpoint-wide statistics, safe
resource reads, and typed mutations. Endpoint responses advertise collection
statistics, Podman volume files, and Exec independently so the UI never
presents an unsupported tool.
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
or host paths. Schema v2 adds a separate saved Compose Project definition
table. It stores exact canonical configuration file paths, an optional env-file
path, profile names, and the internal target solely to reconstruct later
user-requested lifecycle operations; these values never enter operation events,
errors, reconciliation, or audit detail. The v1-to-v2 migration preserves every
operation and fails atomically on drift. On startup, active records are observed
through current engine inventory, then atomically marked interrupted. Startup
never replays an operation whose terminal outcome was not recorded.

Cancellation terminates the owned process group and transitions through the
same operation record. A terminal state is published only after a fresh,
endpoint-bound observation proves presence, absence, desired lifecycle state,
or a bounded inventory snapshot. Unknown results remain explicit.

## Product ownership and permissions

The Local API is under `/_redeven_proxy/api/container-resources` and
`/_redeven_proxy/api/container-resource-operations`. Read covers inventory,
redacted details, logs, statistics, operations, and streams. Raw container
Inspect and every Podman volume file list, preview, or download require Read and
Admin. Exec requires Read and Execute when a published Floeterm contract advertises it.
Lifecycle requires Read and Execute. Creation, pull, removal, and cleanup
require Read, Write, and Execute. High-risk preflights additionally require
Admin and exact-name confirmation.
Server-side enforcement is authoritative; disabled UI controls are only a
presentation aid.

Creating, changing, reading, or forgetting a saved Compose definition requires
Admin; mutation also requires full RWX. Redeven canonicalizes one to eight
regular Compose files, bounds their size, optionally accepts one bounded env
file and up to sixteen safe profile names, and runs `docker compose config
--quiet` against the exact active Docker target before committing. Forgetting a
definition does not stop or remove its containers.

`GET /container-resources/runtimes` returns both engine detection states in one
response. A ready item includes its internal endpoint ID and capabilities; a
failed item never contains command output or endpoint presentation data. An
individual engine failure still returns HTTP 200, while missing Redeven Read
permission returns 403. Public endpoint-list and endpoint-detail routes do not
exist; endpoint binding remains an internal routing and security contract.

Web Services is the lifecycle owner of containers, images, Compose Projects,
and volumes it creates. Native inventory labels owned mutable resources as
managed, offers a direct jump to the owning service, and rejects mutation
attempts on the server. Web Services projects each exact container, image, or
Compose Project identity back to Containers. Navigation writes the established
Activity selection and delivers that same selection to an already mounted
Containers page, so a menu action opens the requested detail immediately
without a second state owner or a stale remount. The two surfaces share identity
and observed state, never parallel lifecycle implementations.

## Data and host safety

DTOs expose only typed, redacted fields. They never return environment values,
arbitrary label values, credentials, socket paths, certificates, remote URLs,
or Compose file paths. Raw container Inspect is one explicit Admin-only,
on-demand exception: it uses `Cache-Control: no-store`, is not prefetched or
persisted, and its payload cannot enter errors, audit detail, Operations, or
application logs. Public errors omit command arguments, stderr, raw output,
tokens, URLs, and host paths.

Container filesystem browsing is not a product capability. Podman volume files
parse `volume export` as a bounded stream without buffering the full archive;
Docker volume files are unavailable because Redeven does not inspect
`/var/lib/docker` and does not create helper containers. Every
path is absolute and canonical, `..` is rejected, archive paths and links must
remain inside the export, and entry count, content bytes, command output, and
execution time are bounded. File payloads are never written to product state.

CLI execution uses explicit argv, bounded time, bounded output, and process
group termination. Redeven does not elevate privileges, change socket
permissions, add users to system groups, or silently switch engines. Host
administrators remain responsible for engine access.

## Product surface

The native Activity and Workbench interaction, loading, resource-navigation,
Compose input, and responsive presentation contracts are owned by
[Native container console](container-resources-console.md). That surface may
project only the targets and capabilities established here; it cannot create a
second routing, mutation, or ownership path.

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
- `redeven:internal/containerengine/resources_v4.go` - Discovers one active target per engine and resolves opaque endpoint routing.
- `redeven:internal/containerengine/resources_v4_cli.go` - Constructs explicit Docker and Podman commands for bound targets.
- `redeven:internal/containerengine/resource_read.go` - Implements bounded batch statistics, raw Inspect, and safe Podman volume archive reads.
- `redeven:internal/containerresource/service.go` - Owns strict preflight admission, operations, cancellation, and startup observation.
- `redeven:internal/containerresource/compose_projects.go` - Validates and binds saved Compose Project definitions to exact Docker targets.
- `redeven:internal/containerresource/schema.go` - Defines the Redeven-owned product database lineage.
- `redeven:internal/codeapp/appserver/container_resources.go` - Enforces native Local API routes and RWX/Admin permissions.
- `redeven:internal/managedwebservice/container_resources.go` - Resolves protected Web Services ownership.
