---
type: Architecture Contract
title: Native container console
description: Present aggregated container resources with stable loading, exact-target navigation, and structured Compose input.
tags: [architecture, containers, ui, workbench]
timestamp: 2026-09-08T00:00:00Z
quality_exception: Cross-surface native container contract spanning aggregated resources, target-scoped navigation, operations, and Compose workflows.
---
# Summary

Containers is one native Activity and multi-instance Workbench surface over the
targets authorized by [Native container resources](container-resources-capability.md).
One console controller owns loading, cache identity, selection, and navigation.
The UI never exposes endpoint selection, never commits a response from an old
target, and never creates a lifecycle path outside `containerresource`.

# Contract

## Stable console state

Each `redeven.containers` instance persists only its resource view and selected
resource key. One discriminated controller owns runtime discovery, aggregated
inventory, selected detail, and the cache for each exact
`(engine, endpoint, view)` target. A resource always retains its source target;
same-name Docker and Podman resources remain separate. Details, streams,
preflights, mutations, Web Services navigation, and operation observation reuse
that exact target.

View changes show a valid cache while refreshing instead of remounting the whole
surface. Runtime rediscovery clears stale ownership before a new target set may
commit. One generation and cancellation signal fences runtime, inventory,
detail, log, history, file, and statistics responses. Only `ready` may render
resource data; `loading` and `navigating` keep every available resource tab
interactive while the toolbar, table or cards, and responsive geometry remain
in place. Only permission, unavailable, and error states disable resource
navigation. Related-resource and external navigation commit the target view
synchronously: an exact cache match opens its detail at once; otherwise the
`navigating` state renders a detail-shaped skeleton until the single target
inventory request resolves. Cached data provides continuity only and cannot
authorize a mutation without a current server preflight.

Selection is current user intent, not inventory-request output. A background
refresh may replace inventory, but it must retain any selection made after that
request began. It clears selection only when the completed inventory proves the
exact resource no longer exists, then reports one concise inventory-change
notice. Back restores its saved console snapshot, detail tab, and scroll position
synchronously before starting that non-blocking refresh; the refresh cannot
replay the empty list selection captured by Back over a newly opened detail.

Containers, Images, and Volumes aggregate every ready runtime. Compose Projects
appears only for Docker and Pods only for Podman. With no ready runtime, the
stable page names each concise detection result and offers retry. Partial failure
keeps usable resources and exposes one status Dialog. New resources use the sole
compatible runtime directly or ask for Docker versus Podman inside the operation
Dialog; actions on existing resources always reuse their source target.

## Resource presentation and navigation

One compact header owns refresh and Operations. It never exposes engine or
endpoint selection, and Workbench hides a duplicate product title. Published
Floe Tabs own resource and detail keyboard navigation. A single toolbar owns
search, status filters, a Filter-icon column control, and one primary action.
Containers default to Active; other views default to All. Shared Dropdown and
Dialog primitives own outside-click, Escape, focus, and Workbench-safe floating
behavior.

Resource identity is the first inventory column and the first reading anchor.
Names use a moderate weight and retain the full value in their accessible text
and title. Numeric sizes align to the right. Created dates and volume drivers
are optional, initially hidden columns; enabling them preserves their existing
sorting and detail access. Optional creation dates use a relative label with
the exact timestamp in the title. Responsive column rules identify the column
by its meaning, never its current position after another column is hidden.
Inventory and loading rows share the same column order and geometry.

Every resource view uses the same interactive table-row contract. A fine-pointer
hover shows a visible surface change, a leading accent, and a small disclosure
response; keyboard focus presents the same hierarchy. Loading rows and static
detail rows do not advertise navigation, and forced-colors mode uses an explicit
outline instead of depending on mixed background colors.

The header's shared three-dot menu also opens the independent
[Container service management](container-service-management.md) page. The
normal resource surface never displays service implementation or endpoint
selectors. Service operation progress stays on the owning service card and
opens the existing Operations detail only when selected.

Image and volume cleanup is not a primary toolbar action. It appears only in
the shared three-dot menu with a Trash icon and danger tone; loading retains a
disabled trigger with the same geometry. The UI sends only the selected runtime
to preflight and displays the server-reviewed resource count and reclaimable
space. Cleanup review also lists every exact target from the signed plan: image
name or tags, short identity, and size, or volume name and driver. The destructive
confirmation stays disabled when that list is absent, duplicated, or does not
match the reviewed count. Internal method names and request hashes are not shown
as substitutes for resources. An empty set or incomplete reference state shows
its concise typed reason and refreshes inventory instead of surfacing a generic
mutation error.

One action-presentation map supplies icons and tone to list buttons, detail
buttons, and menus: Play for start or resume, Stop for stop, Refresh for restart,
Pause for pause, XCircle for force stop, and Trash for delete. Every menu action
has its semantic icon; force stop and delete remain destructive. The managed
resource filter always shows its Lock icon, localized label, and resource count.

Selecting a resource opens a component-local detail page. Returning restores
the owning list, query, filter, sort, and scroll position. Container inventory
and detail carry an optional stable image ID. Docker list results are enriched
with one bounded batch inspect because Docker's formatted list omits that ID.
Clicking a container image opens the exact same-runtime image by normalized ID;
reference or digest matching is allowed only when the ID is absent, and missing
or ambiguous targets leave the current page intact. Mounts separate named
volumes from bind, tmpfs, and redacted paths. Only a named volume opens the
same-runtime volume detail.

Every related-resource link uses that same navigation owner. Compose and Pod
members plus Image and Volume references synchronously select their target view
and exact source engine and endpoint. They never perform a hidden discovery
request before visible feedback or start a second inventory request after
selection. Docker Compose asks for non-truncated container IDs so member
identity matches the canonical container inventory. A missing, stale,
ambiguous, or failed target restores the source detail and its active tab with
one concise notification; it can never degrade into a container list request.
Successful related navigation pushes the source selection, detail tab, list
controls, and scroll position onto the component-local history. Back restores
that snapshot, including across chains such as Compose to Container to Image. A
newer navigation generation still cancels the old request and prevents its
response from committing across targets. A newer selection revision also owns
the selected resource while an in-scope inventory refresh finishes.

Compose detail loading, failure, and empty-member states are distinct. The
console shows an empty state only after a successful detail response with no
members; failed or canceled reads keep the detail surface actionable and allow
retry. A late response from a prior selection cannot replace the current
resource detail.

Container detail provides Overview, live logs, redacted Inspect, mounts,
capability-gated Exec, and bounded statistics. A running, unmanaged container
shows one Terminal action when the user has Read and Execute. It opens the Exec
tab with `/bin/sh`; `/bin/bash`, `/bin/ash`, and exact custom argv remain
explicit choices, and a missing executable reports its real terminal error
without a silent fallback. One page-owned Exec controller serializes initial
entry, command changes, retry, close, and terminal lifecycle callbacks. Retry
creates a fresh session with the last argv that reached an interactive state;
when a replacement command exits before becoming interactive, retry returns to
that known command, while a request-creation failure retries the requested
argv. Session
callbacks are accepted only for the current session identity, so a late close
cannot clear its replacement. The selected command always matches the argv
being retried. The terminal stays mounted while detail tabs change, fills the
detail body's remaining height, and closes when container detail closes.
Managed, stopped, paused, and unsupported targets never expose Exec. Image detail provides Overview,
Layers, references, Run, Tag, and Delete without security-analysis placeholders.
The Layers view presents user-facing build steps backed by the engine history
command as its only primary view. Each step shows one user-facing change
description, step size, creation time, and a classified effect (`filesystem`,
`metadata_only`, or `unknown`). The change description keeps the full normalized
command after removing shell and BuildKit wrappers, so users can understand
actions such as package installation or application compilation. Clearly
sensitive assignment and flag values are shown as `[redacted]`. Raw `CreatedBy`
commands, unfiltered arguments, and engine-generated intermediate image
identifiers never reach the client.

The ordered digests from the same image Inspect response's `RootFS.Layers` are
available in one collapsed technical disclosure below those build steps. The
disclosure identifies base, intermediate, and top positions, preserves the full
copyable digest, and derives its count from the inspected list. It does not
present digests as a second peer view or imply that a digest alone explains a
user-visible build change. Redeven never infers a digest-to-history relationship
by array position or projects history size and time onto an Inspect digest.
Volume detail provides Overview, references, and capability-gated files.
Volume lists, mobile rows, and Overview show explicit In use, Unused, or Unknown
reference status and disk usage. Reference counts include stopped containers;
incomplete inspection never enters the Unused filter or renders an empty
reference list as authoritative. The list status action opens Used by directly.
Disk usage loads once per runtime after inventory commits, using the same load
generation and cancellation signal. It never blocks resource navigation or
replaces selection. Size sorting keeps unavailable values last in both directions;
zero bytes, calculating, and unavailable are distinct. Refresh repeats the read,
and same-name volumes remain isolated by their source runtime. Sizes are
engine-reported observations, not capacity limits or a deletion authorization.
Compose Projects and Pods provide overview, members,
lifecycle, and member navigation. Managed resources replace native mutation
controls with one Web Services action.

Metrics are off by default. Enabling them starts one endpoint-wide SSE per
compatible ready runtime, merges samples by exact source, and closes every
stream when charts or the owning view closes. Container statistics use the
shared Floe monitoring presentation and derive network rates from successive
engine counters. Operation progress and sanitized errors use the canonical
[Native container operation observation](containers-operation-observation.md)
surface.

## Compose input

A saved Compose Project contains one to eight ordered absolute YAML paths, one
optional absolute env-file path, and up to sixteen profile names. Later Compose
files override earlier files. The form owns these as arrays, never as newline-
or comma-encoded backend strings.

The published Floe FileOpenPicker and Redeven filesystem picker data source own
file navigation. Users may paste a path or choose several YAML files; the
ordered result supports move and remove actions. The env file uses the same
source in single-select mode and may select `.env`. The first selected Compose
file suggests its parent directory as the project name until the user edits the
name. Profiles use removable tags and accept Enter or comma. Validation stays
beside the affected field. Manual path entry remains available if the read-only
filesystem RPC is unavailable.

The picker reads metadata only. It does not read file contents or widen
permissions. Server-side canonicalization, size limits, and
`docker compose config --quiet` remain authoritative. The former directory-only
data source and lazy picker compatibility wrapper do not remain as alternate
paths.

## Container run input

Container creation has one `ContainerRunDraft` and one serializer. The common
section owns image, optional name, entrypoint, ordered argv, published ports,
Bind/Volume/Tmpfs mounts, hidden environment values, CPU, memory, network, and
restart policy. A port is not published until added; its initial listen address
is `127.0.0.1`, protocol is TCP, and an empty host port asks the engine to
allocate one. Host paths may be typed or selected with the published Floe file
and directory pickers. Existing same-runtime volumes are offered without
preventing a new valid volume name.

Advanced input owns user, PID and IPC mode, PID limit, shared memory, read-only
root, privileged mode, labels, capability changes, security options, and device
mapping. Errors stay beside their owning row. Empty resource limits are
unlimited. Environment values and host paths are never persisted as UI state.
The draft survives preflight and confirmation, is cleared only after a
successful operation or explicit close, and reaches the existing
preflight/hash/operation path rather than a second creation protocol.

## Responsive and accessible behavior

Desktop uses a compact sortable table, narrow Workbench hides secondary
columns, and mobile uses cards with a full-screen detail page. Service cards
also adapt to the owning surface width, including a narrow Workbench inside
a wide application window. Interactive
targets are at least 44 px where touch applies and expose pointer, keyboard,
forced-colors, reduced-motion, and every shipped locale behavior. Missing,
stopped, unreachable, or permission-denied engines render a dedicated detection
state rather than stale inventory.

## Visual feedback

Inventories, details, service configuration, creation forms, and operation
observation share a restrained type hierarchy and semantic theme surfaces.
Resource, detail, and service configuration tabs use the released Floe slider
indicator. Product hover and press feedback is brief; detail identity and
disclosure entrances use small, bounded movements. Static service cards do not
lift or scale on hover. Entry animation never remounts the Exec terminal,
delays navigation, or transforms a new floating-layer ancestor.

Reduced motion removes product entrance, press, and disclosure motion, and
disables CSS animations and transitions in both the console and its portaled
forms. Loading retains its geometry and progress remains visible without
depending on animation. Dialog and menu positioning, focus, and lifecycle
continue to belong to the released shared primitives.

# Boundaries

- Floe Webapp owns reusable FileOpenPicker, Tabs, Dialog, Dropdown, Select, and
  semantic icon primitives.
- Redeven owns filesystem RPC adaptation, product state, target routing, copy,
  placement, and cross-resource navigation.
- `containerresource` remains the only mutation and reconciliation owner.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx` - Owns the aggregated console, structured Compose and container-run forms, Exec placement, action presentation, and exact-target navigation.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx` - Verifies exact run serialization, localhost port defaults, Exec lifecycle, file selection, ordered Compose requests, navigation, actions, and failure behavior.
- `redeven:internal/envapp/ui_src/src/ui/widgets/ContainerExecTerminal.tsx` - Adapts a product-owned Exec session to the existing terminal renderer and transport.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.browser.test.tsx` - Verifies Activity, Workbench, and narrow responsive interaction in Chromium.
- `redeven:internal/flower_ui/src/filePicker/createFilesystemPickerDataSource.ts` - Adapts the read-only product filesystem RPC to the shared picker.
- `redeven:internal/containerengine/cli_client.go` - Preserves image runtime identity across list and detail reads.
- `redeven:internal/containerengine/resources_v4_cli.go` - Returns canonical non-truncated Compose member container identities.
