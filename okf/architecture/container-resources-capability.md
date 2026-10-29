---
type: Architecture Contract
title: Native container resources
tags: [architecture, containers, docker, podman]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Native container management uses one `containerengine` Docker/Podman execution layer shared with Web Services. `containerresource` alone owns native mutations, persistence and reconciliation. Managed Web Service resources are visible but read-only here. Unknown targets, stale preflights, uncertain outcomes and failed authoritative reads fail closed without mutation replay.

# Contract

- [Runtime execution](container-runtime-execution.md) owns discovery, endpoint binding, typed CLI reads and normalization; [volume usage](container-volume-usage.md) owns reference completeness and independent usage reads.
- Strictly decode mutations and reject unknown fields. Keep uncertain outcomes explicit. Server gates `/_redeven_proxy/api/container-resources` and `container-resource-operations`; disabled controls are only presentation.
- Renderer cannot construct argv, skip admission or mutate managed resources. DTOs expose typed redacted facts, excluding environment/label values, credentials, sockets/certificates, remote URLs and Compose paths. Terminal sessions retain Write/Execute checks.
- [Console](container-resources-console.md) projects established targets/capabilities. Direct engine reachability proves resource readiness; host-service management state cannot replace that probe.

# Boundaries

`containerengine` owns execution/redaction; `containerresource` owns admission, locks, cancellation, events and reconciliation; Web Services owns its resources. ReDevPlugin has no Containers adapter/package/client/UI role. Host administrators own engine installation and OS access.

# Evidence

- `redeven:internal/containerengine/container_exec.go` - Validates running-container Exec and exact argv limits.

- `redeven:internal/containerengine/resource_read.go` - Implements bounded batch statistics, raw Inspect, and safe Podman volume archive reads.
