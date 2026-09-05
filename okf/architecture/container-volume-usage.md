---
type: Architecture Contract
title: Volume usage observation
description: Observe volume references and disk usage without blocking inventory or treating unavailable data as zero.
tags: [architecture, containers, docker, podman, volumes]
timestamp: 2026-09-06T00:00:00Z
---
# Summary

Redeven's container engine owns volume observations; the native resource service
binds them to the authorized active runtime. Container references include stopped
containers, and disk usage reports occupied space rather than capacity. Partial
inspection cannot establish that a volume is unused. A failed or unsupported
size read leaves the inventory usable and the size unavailable. Neither
observation replaces the current authoritative mutation preflight.

# Contract

## Reference completeness

Volume inventory and detail return `referenced_containers`, `used_by`, and
`references_complete`. References come from named-volume mounts across all
containers, including stopped ones; they do not indicate current I/O activity.
Inspection failures remain explicit even when the observed reference count is
zero. The native console renders incomplete observations as Unknown and excludes
them from both In use and Unused filters. A partial Used by view may show known
references together with an incomplete-inspection notice.

## Disk usage

`GET /container-resources/volume-disk-usage` is an independent, Read-only,
no-store observation. It binds the exact engine and endpoint under
[Native container resources](container-resources-capability.md), then issues one
`system df --verbose` command. Docker supplies a JSON volume projection. Podman
rejects combining verbose and format options, so its final volume table is
validated by section, header, row shape, and unique volume identity. Unexpected
layouts fail visibly instead of being interpreted as an empty measurement.

The response exposes only volume names, optional `size_bytes`, and
`sampled_at_unix_ms`. Sizes retain the precision of the engine's human-readable
statistics. Missing, unsupported, negative, or invalid sizes are unavailable;
an explicitly reported zero remains zero. Output uses the normal bounded CLI
limit, with a one-minute deadline and request cancellation. This read does not
start a helper container, inspect private engine directories, or export files.

The [native console](container-resources-console.md) owns asynchronous loading,
size sorting, and list-to-detail navigation. A size-read failure affects only
that runtime's size cells; refreshing retries the observation. A new inventory
generation cancels older measurements. Disk usage never authorizes cleanup or
overrides the reference preflight.

# Evidence

- `redeven:internal/containerengine/volume_usage.go` - Reads bounded engine statistics and preserves unavailable sizes.
- `redeven:internal/containerresource/query.go` - Binds volume reads and exposes reference completeness.
- `redeven:internal/containerengine/volume_usage_test.go` - Checks both engine formats, invalid data, exact target selection, and cancellation.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx` - Verifies non-blocking sizes, unknown references, sorting, and runtime isolation.
