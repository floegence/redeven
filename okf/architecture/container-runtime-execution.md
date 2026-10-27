---
type: Architecture Contract
title: Container runtime execution
description: Resolve active Docker and Podman endpoints and execute typed resource observations without changing host selection.
tags: [architecture, containers, docker, podman]
timestamp: 2026-09-24T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The containerengine package owns Docker and Podman discovery and execution for
Containers and Web Services. Each request binds one engine, endpoint and canonical
resource identity. Engines are observed independently without probing inactive
contexts or changing global selection. Failed discovery or resource observation
remains an explicit error, never an empty successful inventory or fallback engine.
[Native container resources](container-resources-capability.md) owns mutation
admission, persistent operations and product permissions.

# Contract

## Execution ownership
Every request binds `(engine, endpoint_id, resource kind, canonical identity)`.

Observation failures are returned as errors and must never be converted into an empty project or a successful removal.

# Boundaries

Endpoint identifiers remain internal, and current endpoint resolution precedes each operation. Unsupported engine methods fail explicitly. Public DTOs retain the native resource contract's redaction and permission rules.

# Evidence

- `redeven:internal/containerengine/adapter.go` - Defines the shared typed engine boundary.

- `redeven:internal/containerengine/runtime_detection_test.go` - Proves immediate stopped-daemon feedback, independent discovery deadlines, and request cancellation with a virtual clock.
