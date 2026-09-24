---
type: Architecture Contract
title: Container runtime execution
description: Resolve active Docker and Podman endpoints and execute typed resource observations without changing host selection.
tags: [architecture, containers, docker, podman]
timestamp: 2026-09-24T00:00:00Z
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
Endpoint IDs are opaque internal projections over Docker contexts or Podman
connections. The product discovers at most one active target per engine:
Docker's current context and Podman's default connection, falling back to the
local Podman runtime when no default connection exists. Docker and Podman are
detected independently and concurrently. Inactive contexts and connections are
not probed, listed, or used as fallback targets.

Discovery reports `ready`, `not_installed`, `stopped`, `permission`,
`unreachable`, or `error` for each engine. One engine failure never suppresses
the other engine's state or resources. Each concurrent engine probe has one
two-second deadline covering endpoint resolution, status, and metadata. A
responsive stopped daemon returns immediately; an expired probe reports
`unreachable`, while request cancellation cancels the whole read. Resource
readiness never waits for Desktop, systemd, or Podman Machine management
discovery. Those implementation and lifecycle checks belong to the explicit
service management surface and do not determine resource access. This
discovery deadline does not change command,
mutation, image-pull, or stream timeouts.

The engine resolves every ready endpoint
again before each read, mutation, stream, and reconciliation. Docker commands
select the resolved context explicitly; Podman commands select the resolved
connection explicitly. Redeven never changes the user's global engine
selection.

The engine supports endpoint status, containers, images, volumes, Docker
Compose Projects, Podman Pods, bounded logs, endpoint-wide statistics, safe
resource reads, image Inspect filesystem layers, image build history, and typed
mutations. Image filesystem layers are returned only from the inspected image's
ordered `RootFS.Layers`; build history provides separately classified build-step
metadata and never becomes a source of layer identities.
The build-step metadata contains only a normalized operation and a user-readable
command summary. Shell wrappers (`/bin/sh -c`, `/bin/bash -c`, and BuildKit's
`RUN` prefix) are removed so commands such as `apt-get`, `bazel`, `npm`, and
`go` remain visible as the actual build action. Clearly sensitive assignment
and flag values are replaced with `[redacted]`; raw `CreatedBy` content is
never returned. The inspected `RootFS.Layers` list remains an ordered technical
identity list only; it does not provide per-layer commands, sizes, or timestamps,
so those fields are never inferred from history. Endpoint responses
advertise collection statistics, Podman volume files, and Exec independently so the UI never
presents an unsupported tool.
Docker-only methods reject Podman targets and Podman-only methods reject Docker
targets. Compose configuration paths and engine connection details remain
private. Compose down never removes volumes implicitly.

Container inspection combines engine `Mounts` with `HostConfig.Tmpfs` into one
mount inventory. Tmpfs has no host source; its access mode comes from the engine
options. Equal entries at the same target appear once, while conflicting type,
source, or access metadata fails inspection without exposing private paths.
This normalization serves both Containers and managed Web Services.

Compose project observation is derived from one bound Docker container query
filtered by the Compose project label. Project status, counts, and members use
that same observation and do not require the original Compose files; missing
files remain a configuration-operation error. Automatic projects with no
observed containers are absent, while saved definitions remain as stopped
projects with zero members. Observation failures are returned as errors and
must never be converted into an empty project or a successful removal.

# Boundaries

Endpoint identifiers remain internal, and current endpoint resolution precedes
each operation. Unsupported engine methods fail explicitly. CLI calls use the
existing bounded argv, time, output and process-group boundary; they cannot
elevate privileges or alter host access. Public DTOs retain the native resource
contract's redaction and permission rules.

# Evidence

- `redeven:internal/containerengine/adapter.go` - Defines the shared typed engine boundary.
- `redeven:internal/containerengine/resources_v4.go` - Discovers one active target per engine and resolves opaque endpoint routing.
- `redeven:internal/containerengine/runtime_detection_test.go` - Proves immediate stopped-daemon feedback, independent discovery deadlines, and request cancellation with a virtual clock.
- `redeven:internal/containerengine/resources_v4_cli.go` - Constructs explicit Docker and Podman commands for bound targets.
