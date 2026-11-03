---
type: Architecture Contract
title: Native container resources
tags: [architecture, containers, docker, podman]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Native Containers shares containerengine Docker/Podman execution with Web Services; containerresource alone owns mutations/state/reconciliation. Managed service resources are read-only here. Stale, unknown or uncertain facts fail closed without mutation replay.

# Contract

- [Runtime execution](container-runtime-execution.md) owns discovery, endpoint binding, typed CLI reads and normalization; [volume usage](container-volume-usage.md) owns reference completeness and independent usage reads.
- Strictly decode mutations and reject unknown fields. Keep uncertain outcomes explicit. Server gates `/_redeven_proxy/api/container-resources` and `container-resource-operations`; disabled controls are only presentation.
- Renderer cannot construct argv, skip admission or mutate managed resources. DTOs expose typed redacted facts, excluding environment/label values, credentials, sockets/certificates, remote URLs and Compose paths. Terminal sessions retain Write/Execute checks.
- [Console](container-resources-console.md) projects established targets/capabilities. Direct engine reachability proves resource readiness; host-service management state cannot replace that probe.

# Boundaries

`containerengine` owns execution/redaction; `containerresource` owns admission, locks, cancellation, events and reconciliation; Web Services owns its resources. ReDevPlugin has no Containers adapter/package/client/UI role. Host administrators own engine installation and OS access.

# Evidence

- `redeven:internal/containerengine/container_exec.go` - Source.
- `redeven:internal/containerengine/resource_read.go` - Source.
