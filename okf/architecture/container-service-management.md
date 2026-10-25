---
type: Architecture Contract
title: Container service management
description: Detect and safely manage the active local Docker or Podman implementation without exposing engine endpoints or elevation flows.
tags: [architecture, containers, docker, podman, host-control]
timestamp: 2026-09-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

One `ContainerServiceController` owns Docker/Podman service discovery, lifecycle, configuration, preflight identity and reconciliation. Opaque IDs hide endpoints. Host mutation requires full RWX and Admin without privilege elevation. Unknown ownership/revision/final state fails closed; interrupted work cannot be replayed.

# Contract

- Independently detect one service per engine without scanning/fallback. [Resource readiness](container-resources-capability.md) stays bounded independently of slow host management.
- Start/stop/restart use typed service actions. Never invoke sudo/pkexec/polkit, prompt for elevation, alter groups or socket permissions. Keep operation locked until fresh authoritative final state.
- Read-gated `GET /_redeven_proxy/api/container-resources/services` exposes access mode/source IDs; one source failure cannot hide another. Contiguous migrations map legacy state to `engine` and `client_proxy` to `docker_cli`.
- One Container services Settings action carries warnings. Refresh retains cards, animates only its indicator and reports inline errors. Operation completion reloads authoritative service, runtime, inventory and Web Service facts.

# Boundaries

`containerengine` owns exact argv, validation, atomic replacement/rollback and observation. `containerresource` owns preflight, impact, locking and sanitized durable state. Local API owns Read/RWX/Admin and no-store delivery. Docker Desktop/Podman Machine/remote tools retain private settings; administrators own installation/OS authority.

# Evidence

- `redeven:internal/containerengine/container_services.go` - Defines the service model, safe DTO, preflights, and controller adapter boundary.

- `redeven:internal/containerengine/container_services_cli.go` - Implements official discovery, exact lifecycle argv, validation, atomic writes, and rollback.

- `redeven:internal/containerengine/container_services_test.go` - Proves independent detection, systemd non-elevation, machine inspect association, revision conflict, and symlink rejection.
