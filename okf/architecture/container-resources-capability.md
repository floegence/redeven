---
type: Architecture Contract
title: Native container resources
description: Aggregate the active Docker and Podman runtimes behind one Redeven-owned execution and operation boundary.
tags: [architecture, containers, docker, podman]
timestamp: 2026-09-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns container management as a native product capability. The
`containerengine` package is the only Docker and Podman execution layer shared
by native Containers and Web Services; `containerresource` is the only native
mutation, persistence, and reconciliation owner. Resources created by Web
Services remain visible but read-only in Containers. Unknown runtime targets, stale
preflights, ambiguous outcomes, and failed authoritative observation fail
closed without replaying mutations.

# Contract

## Runtime execution
[Container runtime execution](container-runtime-execution.md) owns active Docker/Podman discovery, endpoint binding, typed CLI reads and shared resource normalization. Native mutations and product permissions use that single execution owner.

## Native service boundary
Volume reference completeness and the independent disk usage read are owned by [Volume usage observation](container-volume-usage.md).

`containerresource` strictly decodes every mutation request and rejects unknown fields.

Unknown results remain explicit.

## Product ownership and permissions
The Local API is under `/_redeven_proxy/api/container-resources` and `/_redeven_proxy/api/container-resource-operations`. Server-side enforcement is authoritative; disabled UI controls are only a presentation aid.

Renderer cannot construct argv, skip validation, or use native mutation on managed resources.

## Data and host safety
DTOs expose only typed, redacted fields. They never return environment values, arbitrary label values, credentials, socket paths, certificates, remote URLs, or Compose file paths.

Ordinary terminal sessions retain their Write and Execute permission contract.

## Product surface
The native Activity and Workbench interaction, loading, resource-navigation, Compose input, and responsive presentation contracts are owned by [Native container console](container-resources-console.md). That surface may project only the targets and capabilities established here; it cannot create a second routing, mutation, or ownership path.

Resource readiness observes engine reachability directly; host-service state additionally identifies management capabilities and never substitutes for a successful resource probe.

# Boundaries

- `containerengine` owns typed Docker and Podman execution and redaction. - `containerresource` owns native mutation admission, locking, persistence,   cancellation, events, and reconciliation. - Web Services owns the lifecycle of resources it created. - ReDevPlugin remains the platform for other plugins and has no Containers   capability, adapter, package, generated client, or native UI role. - The host administrator owns engine installation and operating-system access.

# Evidence

- `redeven:internal/containerengine/container_exec.go` - Validates running-container Exec and exact argv limits.

- `redeven:internal/terminal/container_exec.go` - Owns hidden program-session access, attachment timeouts, and cleanup.

- `redeven:internal/containerengine/resource_read.go` - Implements bounded batch statistics, raw Inspect, and safe Podman volume archive reads.
