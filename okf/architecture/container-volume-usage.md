---
type: Architecture Contract
title: Volume usage observation
tags: [architecture, containers, docker, podman, volumes]
lifecycle: contract
reviewed_at: "2026-10-22"
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
Volume inventory and detail return `referenced_containers`, `used_by`, and `references_complete`. The native console renders incomplete observations as Unknown and excludes them from both In use and Unused filters. A partial Used by view may show known references together with an incomplete-inspection notice.

## Disk usage
`GET /container-resources/volume-disk-usage` is an independent, Read-only, no-store observation. Unexpected layouts fail visibly instead of being interpreted as an empty measurement.

Disk usage never authorizes cleanup or overrides the reference preflight.

# Boundaries

Volume usage is an observation, not a capacity, quota, free-space, billing, or cleanup contract. Redeven does not infer safety from an unavailable size or an incomplete reference scan, and it does not bypass the authoritative mutation preflight when deleting a volume.

# Evidence

- `redeven:internal/containerengine/volume_usage.go` - Reads bounded engine statistics and preserves unavailable sizes.

- `redeven:internal/containerengine/volume_usage_test.go` - Checks both engine formats, invalid data, exact target selection, and cancellation.
