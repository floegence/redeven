---
type: Architecture Contract
title: Native container console
tags: [architecture, containers, ui, workbench]
quality_exception: Cross-surface native container contract spanning aggregated resources, target-scoped navigation, operations, and Compose workflows.
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Containers provides native Activity and Workbench views over [authorized targets](container-resources-capability.md). The console owns selection/navigation; [resource snapshots](../ui/env-resource-cache.md) owns shared presentation/refresh. Old-target responses cannot commit, UI exposes no endpoint selector, and every lifecycle mutation remains within `containerresource`.

# Contract

- Persist only resource view/key per `redeven.containers` instance. Preserve target identity even for same-name resources. Existing actions reuse their source; creation uses the sole compatible engine or asks Docker/Podman within its dialog.
- One compact header owns refresh/Operations; Workbench suppresses duplicate title. [Operation observation](containers-operation-observation.md) owns progress/errors.
- Compose input is 1–8 ordered absolute YAML paths, optional absolute env-file and at most 16 profiles, represented as arrays. No retired directory-only or lazy-picker alternate path.
- One `ContainerRunDraft`/serializer feeds existing preflight/hash/operation admission. Never persist environment values/host paths in UI state. Retain draft through preflight/confirmation; clear only on success or explicit close.
- Use sortable desktop tables, fewer columns in narrow Workbench and mobile cards/full-screen details. Missing/stopped/unreachable/denied engines show detection state rather than stale inventory.
- Keep restrained typography, semantic surfaces and brief bounded feedback; published primitives own menu/dialog position, focus and presence.

# Boundaries

Floe owns reusable pickers/controls/icons. Redeven owns filesystem adaptation, product state/copy/placement/navigation; `containerresource` alone owns mutation/reconciliation.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx` - Owns the aggregated console, structured Compose and container-run forms, Exec placement, action presentation, and exact-target navigation.

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx` - Verifies exact run serialization, localhost port defaults, Exec lifecycle, file selection, ordered Compose requests, navigation, actions, and failure behavior.
