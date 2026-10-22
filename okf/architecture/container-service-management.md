---
type: Architecture Contract
title: Container service management
description: Detect and safely manage the active local Docker or Podman implementation without exposing engine endpoints or elevation flows.
tags: [architecture, containers, docker, podman, host-control]
timestamp: 2026-09-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

One `ContainerServiceController` owns Docker and Podman service discovery, lifecycle,
configuration, preflight identity, and reconciliation. Stable opaque service
IDs replace endpoints. Host mutations require full RWX and Admin, never elevate
privileges, and fail closed when ownership, revision, or final state is unknown.

# Contract

## Discovery and identity
The controller returns one independently detected service per engine. Detection never scans or falls back to another target.

The resource console uses the bounded engine-readiness contract in [Native container resources](container-resources-capability.md), so a slow host-management command cannot delay a stopped-daemon result.

## Lifecycle and authority
Lifecycle mutations are `container.services.start`, `container.services.stop`, and `container.services.restart`. Redeven never invokes `sudo`, `pkexec`, a password prompt, polkit, group membership changes, or socket permission changes.

The service stays locked until a fresh read proves final state; interrupted operations are never replayed.

## Configuration
`GET /_redeven_proxy/api/container-resources/services` requires Read and exposes only the configuration access mode and source IDs. One failed source never hides another source.

Its contiguous migrations map legacy service state to `engine` and rename the retired `client_proxy` source to `docker_cli`.

## Product surface and observation
The Containers header exposes one direct Settings action for “Container services”; runtime warnings decorate that same action instead of adding a second entry. Refresh preserves the last authoritative cards, animates only the refresh indicator, and reports failure inline; it never replaces usable content with a skeleton or replays card-entry animation.

Refresh and operation completion reload authoritative service, runtime, inventory, and Web Service state.

# Boundaries

- `containerengine` owns service discovery, exact host argv, candidate   validation, atomic replacement, rollback, and authoritative observation. - `containerresource` owns permission-independent preflight data, Admin impact,   operation locks, durable sanitized state, and reconciliation. - The Code App Local API owns authenticated Read/RWX/Admin enforcement and   no-store configuration delivery. - Docker Desktop retains ownership of private application settings; Podman   Machine and remote host tools retain ownership of non-local configuration. - The host administrator owns installation and operating-system authority.

# Evidence

- `redeven:internal/containerengine/container_services.go` - Defines the service model, safe DTO, preflights, and controller adapter boundary.

- `redeven:internal/containerengine/container_services_cli.go` - Implements official discovery, exact lifecycle argv, validation, atomic writes, and rollback.

- `redeven:internal/containerengine/container_services_test.go` - Proves independent detection, systemd non-elevation, machine inspect association, revision conflict, and symlink rejection.
