---
type: Architecture Contract
title: Container resource capability, console and usage facts
tags: [architecture, containers, docker, podman]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Native resource services own endpoint-bound execution, admission and reconciliation; the console presents typed authorized facts and drafts. Missing engines and partial volume inspections stay explicit. UI reachability, size or reference guesses never grant mutation authority or replace resource preflight.

# Contract

## Authority
- [Runtime execution](containers-operation-observation.md#engine-execution) owns discovery, endpoint binding, typed CLI reads and normalization; [volume usage](#volume-observations) owns reference completeness and independent usage reads.
- Strictly decode mutations and reject unknown fields. Keep uncertain outcomes explicit. Server gates `/_redeven_proxy/api/container-resources` and `container-resource-operations`; disabled controls are only presentation.
- Renderer cannot construct argv, skip admission or mutate managed resources. DTOs expose typed redacted facts, excluding environment/label values, credentials, sockets/certificates, remote URLs and Compose paths. Terminal sessions retain Write/Execute checks.
- [Console](#console) projects established targets/capabilities. Direct engine reachability proves resource readiness; host-service management state cannot replace that probe.

## Console
- Persist only resource view/key per `redeven.containers` instance. Preserve target identity even for same-name resources. Existing actions reuse their source; creation uses the sole compatible engine or asks Docker/Podman within its dialog.
- One compact header owns refresh/Operations; Workbench suppresses duplicate title. [Operation observation](containers-operation-observation.md#operation-ownership) owns progress/errors.
- Compose input is 1–8 ordered absolute YAML paths, optional absolute env-file and at most 16 profiles, represented as arrays. No retired directory-only or lazy-picker alternate path.
- One `ContainerRunDraft`/serializer feeds existing preflight/hash/operation admission. Never persist environment values/host paths in UI state. Retain draft through preflight/confirmation; clear only on success or explicit close.
- Use sortable desktop tables, fewer columns in narrow Workbench and mobile cards/full-screen details. Missing/stopped/unreachable/denied engines show detection state rather than stale inventory.
- Keep restrained typography, semantic surfaces and brief bounded feedback; published primitives own menu/dialog position, focus and presence.
- The log toolbar stays at content height; its viewer receives the remaining detail-body height, with the existing bounded gap and responsive wrapping. Sparse or empty logs must not stretch the toolbar.

## Volume observations
References include stopped containers; sizes report occupied bytes, never capacity. Failed size reads retain inventory with unavailable metrics.

### Reference completeness
Volume inventory and detail return `referenced_containers`, `used_by`, and `references_complete`. The native console renders incomplete observations as Unknown and excludes them from both In use and Unused filters. A partial Used by view may show known references together with an incomplete-inspection notice.

### Disk usage
`GET /container-resources/volume-disk-usage` is an independent, Read-only, no-store observation. Unexpected layouts fail visibly instead of being interpreted as an empty measurement.

Disk usage never authorizes cleanup or overrides the reference preflight.

# Boundaries

`containerengine` owns execution/redaction; `containerresource` owns admission, locks, cancellation, events and reconciliation; Web Services owns its resources. ReDevPlugin has no Containers adapter/package/client/UI role. Host administrators own engine installation and OS access.

Floe owns reusable pickers/controls/icons. Redeven owns filesystem adaptation, product state/copy/placement/navigation; `containerresource` alone owns mutation/reconciliation.

Volume usage is an observation, not a capacity, quota, free-space, billing, or cleanup contract. Redeven does not infer safety from an unavailable size or an incomplete reference scan, and it does not bypass the authoritative mutation preflight when deleting a volume.

# Evidence

- `redeven:internal/containerengine/container_exec.go` - Source.
- `redeven:internal/containerengine/resource_read.go` - Source.

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.browser.test.tsx` - Responsive log geometry and interaction acceptance.

- `redeven:internal/containerengine/volume_usage.go` - Source.
- `redeven:internal/containerengine/volume_usage_test.go` - Tests.
