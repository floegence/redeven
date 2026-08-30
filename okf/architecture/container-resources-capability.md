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
redacted details, logs, statistics, operations, and streams. Raw container
Inspect and every Podman volume file list, preview, or download require Read and
Admin. Exec requires Read and Execute when a published Floeterm contract advertises it.
Lifecycle requires Read and Execute. Creation, pull, removal, and cleanup
require Read, Write, and Execute. High-risk preflights additionally require
Admin and exact-name confirmation.
Server-side enforcement is authoritative; disabled UI controls are only a
presentation aid.

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

## Native surfaces

Containers has a fixed Activity entry and a multi-instance
`redeven.containers` Workbench component. Each instance persists only the
resource view and selected resource key. Stored v1 engine and endpoint state is
ignored. One compact header owns refresh and Operations; it does not expose an
engine or endpoint selector. Workbench hides the duplicate product title.
Underlined resource tabs, a single toolbar, status color, icons,
spacing, sortable type-specific columns, direct lifecycle actions, and an
overflow menu replace overview cards, nested panels, repeated prose, and long
identifiers. The active resource name appears only in the resource tab; the
toolbar begins with search and filters instead of repeating the tab label or
inventory count. The overflow menu follows shared outside-click, Escape, and
focus behavior. Column visibility uses the released shared Dropdown, including
the same outside-click and Escape dismissal, instead of a page-local floating
panel. Containers default to the Active filter while other resource views
default to All. Column visibility is user-controlled. Metrics are off by
default; when requested, the UI starts one endpoint-wide SSE per compatible
ready runtime, merges samples by exact target, and closes every stream when
charts or the owning view close.

One discriminated console controller owns runtime discovery, resource view,
aggregated inventory, and selected resource. It keeps a component-lifetime
cache per exact `(engine, endpoint, view)` and combines only entries from the
current ready runtime set. Every resource entry retains its source target;
same-name Docker and Podman resources stay separate and receive a runtime badge
only when their displayed names conflict. Details, streams, preflights,
mutations, Web Services navigation, and operation observation route through
that source target.

View changes reuse cached per-runtime inventory while refreshing in the
background. Runtime rediscovery clears stale target ownership before a new set
can commit. One request generation and cancellation signal fence older runtime,
inventory, detail, log, history, file, and statistics responses. Only `ready`
renders resource data or detail; a refreshing cache remains `ready` but cannot
authorize mutation without a current server preflight. A first visit keeps the
production tabs, toolbar, table headers, mobile cards, and responsive geometry
in place during loading. Resource and detail navigation use the published Floe
Webapp `Tabs` owner for icons, underlined selection, keyboard movement, and
narrow-width overflow.

Containers, Images, and Volumes aggregate every ready runtime. Compose Projects
exists only while Docker is ready; Pods exists only while Podman is ready. With
no ready runtime, the stable page reports each engine's concise detection state
and offers retry. With partial failure, usable resources remain visible and one
warning opens a shared Dialog containing status only; it cannot switch targets.
Create, pull, volume creation, and cleanup use the sole compatible target
directly. When both engines are compatible, the operation Dialog contains one
Floe Select, defaults to Docker, and never exposes endpoint names. Actions from
an existing resource always reuse its source target.

Selecting a resource opens a component-local detail page, never a floating
inspector. Returning preserves the list query, filter, sort, and scroll owner.
Container details provide Overview, live searchable logs, redacted Inspect,
mounts, capability-gated Exec, and bounded in-browser statistics. Detail
statistics select the container from one endpoint-wide sample because engine
versions do not consistently return targeted `stats` output. Each sample carries
its authoritative capture time. The detail view uses the same Floe monitoring
panels and charts as Env Monitor and derives receive/send rates from successive
engine counters instead of charting cumulative byte totals.
Image details provide Overview, sanitized layers, references, Run, Tag, and
Delete without vulnerability or package-analysis placeholders. Image history
queries use the stable image ID so dangling images remain inspectable. Volume details
provide Overview, references, and capability-gated files. Compose Projects and
Pods expose overview, members, lifecycle, and member navigation. Managed
resources replace mutation controls with one Web Services link.

Desktop uses a compact table, narrow Workbench hides secondary columns, and
mobile uses cards plus a full-screen detail surface. Logs support timestamped
search, follow/pause, wrapping, copy, current-buffer download, and browser full
screen. A shared Operations drawer keeps endpoint and target identity visible.

The UI provides structured create dialogs and a separate risk review before
submission. It supports keyboard operation, 44 px touch targets, forced colors,
reduced motion, and every shipped locale. A missing, stopped, unreachable, or
permission-denied engine produces a dedicated detection state with retry instead
of a broken resource table. Inventory from an inactive target is never shown in
a loading or failure state. An exact-target cached inventory is visual
continuity only and cannot authorize destructive work. Detail reads,
logs, statistics, image history, and file reads commit only while their owning
`ready` context is still current.

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
- `redeven:internal/containerresource/schema.go` - Defines the Redeven-owned product database lineage.
- `redeven:internal/codeapp/appserver/container_resources.go` - Enforces native Local API routes and RWX/Admin permissions.
- `redeven:internal/managedwebservice/container_resources.go` - Resolves protected Web Services ownership.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx` - Implements the native responsive product surface.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx` - Verifies aggregation, target-routed actions, partial failure, exact-target caching, cancellation, and ready-only rendering.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.browser.test.tsx` - Verifies desktop and narrow dedicated-detail layouts in Chromium.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx` - Registers the multi-instance Workbench component.
