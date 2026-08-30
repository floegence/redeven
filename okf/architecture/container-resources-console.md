---
type: Architecture Contract
title: Native container console
description: Present aggregated container resources with stable loading, exact-target navigation, and structured Compose input.
tags: [architecture, containers, ui, workbench]
timestamp: 2026-08-30T00:00:00Z
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
resource data; loading keeps the production tabs, toolbar, table or cards, and
responsive geometry in place. Cached data provides continuity only and cannot
authorize a mutation without a current server preflight.

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

One action-presentation map supplies icons and tone to list buttons, detail
buttons, and menus: Play for start or resume, CircleStop for stop, Refresh for
restart, Pause for pause, XCircle for force stop, and Trash for delete. Every
menu action has its semantic icon; force stop and delete remain destructive.

Selecting a resource opens a component-local detail page. Returning restores
the owning list, query, filter, sort, and scroll position. Container inventory
and detail carry an optional stable image ID. Docker list results are enriched
with one bounded batch inspect because Docker's formatted list omits that ID.
Clicking a container image opens the exact same-runtime image by normalized ID;
reference or digest matching is allowed only when the ID is absent, and missing
or ambiguous targets leave the current page intact. Mounts separate named
volumes from bind, tmpfs, and redacted paths. Only a named volume opens the
same-runtime volume detail.

Container detail provides Overview, live logs, redacted Inspect, mounts,
capability-gated Exec, and bounded statistics. Image detail provides Overview,
sanitized layers, references, Run, Tag, and Delete without security-analysis
placeholders. Volume detail provides Overview, references, and
capability-gated files. Compose Projects and Pods provide overview, members,
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

## Responsive and accessible behavior

Desktop uses a compact sortable table, narrow Workbench hides secondary
columns, and mobile uses cards with a full-screen detail page. Interactive
targets are at least 44 px where touch applies and expose pointer, keyboard,
forced-colors, reduced-motion, and every shipped locale behavior. Missing,
stopped, unreachable, or permission-denied engines render a dedicated detection
state rather than stale inventory.

# Boundaries

- Floe Webapp owns reusable FileOpenPicker, Tabs, Dialog, Dropdown, Select, and
  semantic icon primitives.
- Redeven owns filesystem RPC adaptation, product state, target routing, copy,
  placement, and cross-resource navigation.
- `containerresource` remains the only mutation and reconciliation owner.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx` - Owns the aggregated console, structured Compose form, action presentation, and exact-target navigation.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx` - Verifies file selection, ordered Compose requests, image and volume navigation, actions, and failure behavior.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.browser.test.tsx` - Verifies Activity, Workbench, and narrow responsive interaction in Chromium.
- `redeven:internal/flower_ui/src/filePicker/createFilesystemPickerDataSource.ts` - Adapts the read-only product filesystem RPC to the shared picker.
- `redeven:internal/containerengine/cli_client.go` - Preserves image runtime identity across list and detail reads.
