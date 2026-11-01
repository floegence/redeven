---
type: Architecture Contract
title: Container runtime execution
tags: [architecture, containers, docker, podman]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

containerengine owns Docker/Podman discovery and execution. Each request binds engine, endpoint and canonical resource. Observe engines independently without probing inactive contexts or changing global selection. Failures stay explicit, never empty success or fallback; resource mutations retain their own admission owner.

# Contract

## Execution ownership
Every request binds `(engine, endpoint_id, resource kind, canonical identity)`.

Observation failures are returned as errors and must never be converted into an empty project or a successful removal.

# Boundaries

Endpoint identifiers remain internal, and current endpoint resolution precedes each operation. Unsupported engine methods fail explicitly. Public DTOs retain the native resource contract's redaction and permission rules.

# Evidence

- `redeven:internal/containerengine/adapter.go` - Defines the shared typed engine boundary.

- `redeven:internal/containerengine/runtime_detection_test.go` - Stopped-daemon feedback and independent cancellable discovery under virtual time.
