---
type: Architecture Contract
title: Container service management
description: Detect and safely manage the active local Docker or Podman implementation without exposing engine endpoints or elevation flows.
tags: [architecture, containers, docker, podman, host-control]
timestamp: 2026-08-31T00:00:00Z
---
# Summary

One `ContainerServiceController` owns Docker and Podman discovery, lifecycle,
configuration, preflight identity, and reconciliation. Stable opaque service
IDs replace endpoints. Host mutations require full RWX and Admin, never elevate
privileges, and fail closed when ownership, revision, or final state is unknown.

# Contract

## Discovery and identity

The controller returns one independently detected service per engine. Docker
uses only the current context. Podman uses only the default connection or local
runtime. Detection never scans or falls back to another target.

Implementation is derived from official observable state:

- Docker Desktop is identified and controlled through `docker desktop`.
- Docker Engine is controllable only through an already-accessible systemd
  user unit, or a system unit when Redeven already runs as root.
- Podman Machine is associated with the active connection only when official
  `podman machine inspect` data matches that connection. A matching name alone
  is insufficient.
- Local Podman is daemonless and therefore exposes configuration but no service
  lifecycle controls.
- An unmatched remote Docker or Podman target exposes status and host-management
  guidance only.

The projection reports one implementation, state, and discriminated
configuration access: `editable`, `external`, or `unavailable`. Each has one
owner and UI path, replacing independent capability booleans. Guidance is a
localization code. Host paths, addresses, unit details, and connection data
never enter the DTO. Runtime discovery consumes the same projection.

## Lifecycle and authority

Lifecycle mutations are `container.services.start`,
`container.services.stop`, and `container.services.restart`. Docker Desktop
uses its official CLI. Docker Engine uses `systemctl --no-ask-password` for the
already-authorized unit. Podman Machine uses official start and stop commands;
restart is an explicit stop followed by start. Redeven never invokes `sudo`,
`pkexec`, a password prompt, polkit, group membership changes, or socket
permission changes.

Every mutation uses native preflight and Operations with full RWX and Admin.
Stop and restart also require the displayed service name. Preflight resolves
running containers and affected Web Services. The service stays locked until a
fresh read proves final state; interrupted operations are never replayed.

## Configuration

`GET /_redeven_proxy/api/container-resources/services` requires Read and exposes
the discriminated configuration access value. `editable` includes the format
and available proxy/advanced sections; `external` names the official owner;
`unavailable` provides explanation only.
`GET /_redeven_proxy/api/container-resources/services/{service_id}/configuration`
requires Read and Admin and returns `Cache-Control: no-store`. Docker Engine may
edit only its official `daemon.json`; local Podman may edit only the current
user's `containers.conf`. Docker Desktop, Podman Machine, remote services,
custom paths, symlinked paths, and externally managed or unwritable files are
never represented as editable and direct the user to the official owner when
one exists.

Configuration has two exclusive UI modes. Proxy mode edits HTTP, HTTPS, and
NO_PROXY values while preserving unrelated document fields. Advanced mode
edits the complete JSON or TOML document with the existing Monaco-backed text
editor. Each update includes the configuration `base_revision`, is limited to
256 KiB, and requires the exact service name. A changed revision fails before
write.

Candidates are validated before review and execution: Docker uses `dockerd
--validate --config-file`; Podman uses temporary `CONTAINERS_CONF` and read-only
`podman info`. Replacement is atomic and preserves mode. “Save and restart”
restores old bytes and attempts one recovery start on failure; failed recovery
returns `SERVICE_RECOVERY_REQUIRED` without hidden retries.

Configuration, credentials, and host paths never enter the database,
Operations, audit, logs, or public errors. Schema v3 stores only service ID,
revision, restart-required state, generation, and update time. Its contiguous
migration preserves Compose Projects and fails atomically on drift.

## Product surface and observation

The Containers header exposes one “Container services” item in its three-dot
menu. It opens a component-local service page without duplicating resource tabs
or endpoints. Compact cards use audited Docker and Podman marks from one pinned
theSVG revision, status color, supported actions, and a short entrance/elevation
transition. Reduced-motion removes movement; forced-colors replaces brand color
with the audited monochrome variant. Skeletons preserve the final card geometry.

Every card has one configuration action. Editable services open shared Tabs for
proxy and Monaco-backed advanced editing. Docker Desktop, Podman Machine, and
remote services open an explicit owner handoff instead of a false editor.
Unavailable configuration explains the boundary without a disabled empty
surface. Service operation progress stays on its owning card and opens the
existing Operations detail when selected.

All container-service and resource stop actions use the shared filled stop
glyph. List, detail, menu, and service-card surfaces consume the same operation
presentation mapping; no surface substitutes a checkbox-like outlined symbol.
Refresh and operation completion reload authoritative service, runtime,
inventory, and Web Service state.

# Boundaries

- `containerengine` owns service discovery, exact host argv, candidate
  validation, atomic replacement, rollback, and authoritative observation.
- `containerresource` owns permission-independent preflight data, Admin impact,
  operation locks, durable sanitized state, and reconciliation.
- The Code App Local API owns authenticated Read/RWX/Admin enforcement and
  no-store configuration delivery.
- Docker Desktop, Podman Machine, and remote host tools retain ownership of
  configuration that Redeven cannot safely replace.
- The host administrator owns installation and operating-system authority.

# Evidence

- `redeven:internal/containerengine/container_services.go` - Defines the service model, safe DTO, preflights, and controller adapter boundary.
- `redeven:internal/containerengine/container_services_cli.go` - Implements official discovery, exact lifecycle argv, validation, atomic writes, and rollback.
- `redeven:internal/containerengine/container_services_test.go` - Proves independent detection, systemd non-elevation, machine inspect association, revision conflict, and symlink rejection.
- `redeven:internal/containerresource/service.go` - Enriches service preflight with current container and Web Service impact.
- `redeven:internal/containerresource/dispatch.go` - Executes and reconciles service lifecycle and configuration operations.
- `redeven:internal/containerresource/schema.go` - Owns the v3 metadata-only schema and contiguous migration.
- `redeven:internal/codeapp/appserver/container_resources.go` - Exposes service reads and enforces Local API permissions, audit redaction, and no-store delivery.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx` - Owns the service page, card-local operation progress, configuration modes, and official handoff.
- `redeven:assets/container_service_icons.json` - Pins and hashes the audited Docker and Podman brand variants used by the service cards.
