---
type: Architecture Contract
title: Native container console
description: Present aggregated container resources with stable loading, exact-target navigation, and structured Compose input.
tags: [architecture, containers, ui, workbench]
timestamp: 2026-09-08T00:00:00Z
quality_exception: Cross-surface native container contract spanning aggregated resources, target-scoped navigation, operations, and Compose workflows.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Containers is one native Activity and multi-instance Workbench surface over the
targets authorized by [Native container resources](container-resources-capability.md).
The console controller owns selection and navigation; the [resource snapshot contract](../ui/env-resource-cache.md) owns shared persisted presentation and refresh lifetime.
The UI never exposes endpoint selection, never commits a response from an old
target, and never creates a lifecycle path outside `containerresource`.

# Contract

## Stable console state
Each `redeven.containers` instance persists only its resource view and selected resource key. A resource always retains its source target; same-name Docker and Podman resources remain separate.

New resources use the sole compatible runtime directly or ask for Docker versus Podman inside the operation Dialog; actions on existing resources always reuse their source target.

## Resource presentation and navigation
One compact header owns refresh and Operations. It never exposes engine or endpoint selection, and Workbench hides a duplicate product title.

Operation progress and sanitized errors use the canonical [Native container operation observation](containers-operation-observation.md) surface.

## Compose input
A saved Compose Project contains one to eight ordered absolute YAML paths, one optional absolute env-file path, and up to sixteen profile names. The form owns these as arrays, never as newline- or comma-encoded backend strings.

The former directory-only data source and lazy picker compatibility wrapper do not remain as alternate paths.

## Container run input
Container creation has one `ContainerRunDraft` and one serializer.

Environment values and host paths are never persisted as UI state. The draft survives preflight and confirmation, is cleared only after a successful operation or explicit close, and reaches the existing preflight/hash/operation path rather than a second creation protocol.

## Responsive and accessible behavior
Desktop uses a compact sortable table, narrow Workbench hides secondary columns, and mobile uses cards with a full-screen detail page. Missing, stopped, unreachable, or permission-denied engines render a dedicated detection state rather than stale inventory.

## Visual feedback
Inventories, details, service configuration, creation forms, and operation observation share a restrained type hierarchy and semantic theme surfaces. Product hover and press feedback is brief; detail identity and disclosure entrances use small, bounded movements.

Dialog and menu positioning, focus, and lifecycle continue to belong to the released shared primitives.

# Boundaries

- Floe Webapp owns reusable FileOpenPicker, Tabs, Dialog, Dropdown, Select, and   semantic icon primitives. - Redeven owns filesystem RPC adaptation, product state, target routing, copy,   placement, and cross-resource navigation. - `containerresource` remains the only mutation and reconciliation owner.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx` - Owns the aggregated console, structured Compose and container-run forms, Exec placement, action presentation, and exact-target navigation.

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx` - Verifies exact run serialization, localhost port defaults, Exec lifecycle, file selection, ordered Compose requests, navigation, actions, and failure behavior.

- `redeven:internal/envapp/ui_src/src/ui/widgets/ContainerExecTerminal.tsx` - Adapts a product-owned Exec session to the existing terminal renderer and transport.
