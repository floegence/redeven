---
type: Architecture Contract
title: Container service management
description: Detect and safely manage the active local Docker or Podman implementation without exposing engine endpoints or elevation flows.
tags: [architecture, containers, docker, podman, host-control]
timestamp: 2026-09-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

One `ContainerServiceController` owns Docker/Podman service discovery, lifecycle, configuration, preflight identity and reconciliation. Opaque IDs hide endpoints. Host mutation requires full RWX and Admin without privilege elevation. Unknown ownership/revision/final state fails closed; interrupted work cannot be replayed.

# Contract

- Independently detect one service per engine without scanning/fallback. Each discovery has a two-second total budget shared by its commands; the concurrent engines cannot consume each other's budget. Reuse the selected endpoint inventory when binding health probes. [Resource readiness](container-resources-capability.md) remains independently bounded.
- Docker Desktop ownership comes from the selected local `desktop-linux`/`desktop-windows` context or an exact endpoint-address alias of it. An installed Desktop plugin does not claim another local engine or remote context. Validate management using `docker desktop version --format json`, then read engine health from the bound endpoint. Never run the slow `desktop status` command during discovery.
- Once the active context establishes Desktop ownership, management/health errors retain its service ID, implementation, configuration sources, and supported lifecycle actions. Report missing CLI, permission, timeout, and unknown failures explicitly; they never establish a stopped state. The API and UI allow Start only when stopped and Stop/Restart only when running. Configuration save-and-restart requires known running/stopped state before any write; plain save remains available. Resolve Podman Machine ownership before probing its remote health.
- Start/stop/restart use typed service actions. Never invoke sudo/pkexec/polkit, prompt for elevation, alter groups or socket permissions. Keep operation locked until fresh authoritative final state.
- Read-gated `GET /_redeven_proxy/api/container-resources/services` exposes access mode/source IDs; one source failure cannot hide another. Contiguous migrations map legacy state to `engine` and `client_proxy` to `docker_cli`.
- One Container services Settings action carries warnings. Refresh retains cards, animates only its indicator and reports inline errors. A known Desktop with uncertain health retains its Start control, disabled with state guidance; successful revalidation enables the same control. Operation completion reloads authoritative service, runtime, inventory and Web Service facts.

# Boundaries

`containerengine` owns exact argv, validation, atomic replacement/rollback and observation. `containerresource` owns preflight, impact, locking and sanitized durable state. Local API owns Read/RWX/Admin and no-store delivery. Docker Desktop/Podman Machine/remote tools retain private settings; administrators own installation/OS authority.

# Evidence

- `redeven:internal/containerengine/container_services.go` - Defines the service model, safe DTO, preflights, and controller adapter boundary.

- `redeven:internal/containerengine/container_services_cli.go` - Implements official discovery, exact lifecycle argv, validation, atomic writes, and rollback.

- `redeven:internal/containerengine/container_services_test.go` - Proves independent detection, systemd non-elevation, machine inspect association, revision conflict, and symlink rejection.

- `redeven:internal/containerengine/container_services_desktop_test.go` - Covers Desktop context ownership, bounded discovery, management/health failures and recovery, unsafe-action rejection, and start/stop/start with stable identity.
