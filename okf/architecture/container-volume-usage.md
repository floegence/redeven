---
type: Architecture Contract
title: Volume usage observation
tags: [architecture, containers, docker, podman, volumes]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

The engine supplies bounded volume observations to authenticated active Runtime resources. References include stopped containers and sizes mean occupied bytes, not capacity. Partial inspection proves no unused state. Failed size reads preserve inventory with unavailable metrics; mutations still require current preflight.

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

- `redeven:internal/containerengine/volume_usage_test.go` - Both engine formats, validation, exact target and cancellation.
