---
type: Architecture Contract
title: Container service management
description: Detect and safely manage the active local Docker or Podman implementation without exposing engine endpoints or elevation flows.
tags: [architecture, containers, docker, podman, host-control]
timestamp: 2026-08-31T00:00:00Z
---
# Summary

Redeven presents Docker and Podman installation, availability, lifecycle, and
configuration through one `ContainerServiceController` boundary in
`containerengine`. A stable opaque service ID, rather than an endpoint, owns
every read, preflight, lock, operation, and reconciliation. Unsupported or
remote services stay observable but read-only. Host mutations require full RWX
and Admin, never elevate privileges, and fail closed when ownership, authority,
configuration revision, or final service state cannot be proved.

# Contract

## Discovery and identity

The controller detects Docker and Podman independently and returns one product
service for each engine. Docker examines only the current context. Podman
examines only the default connection, or the local runtime when no connection
is configured. Detection never scans inactive contexts and never selects a
fallback remote target.

Implementation is derived from official observable state:

- Docker Desktop is identified and controlled through `docker desktop`.
- Docker Engine is controllable only through a systemd unit already accessible
  to the current user. User units use `systemctl --user`; system units are
  available only when Redeven already runs as root.
- Podman Machine is associated with the active connection only when official
  `podman machine inspect` data matches that connection. A matching name alone
  is insufficient.
- Local Podman is daemonless and therefore exposes configuration but no service
  lifecycle controls.
- An unmatched remote Docker or Podman target exposes status and host-management
  guidance only.

The service projection reports a typed implementation and one of `running`,
`stopped`, `not_installed`, `permission`, `unreachable`, or `error`. Guidance is
a localization code, not raw command output. Configuration paths, context
addresses, socket paths, remote URLs, systemd unit details, and machine
connection data never enter the DTO. Runtime discovery consumes this same
projection, so service status and resource availability cannot diverge through
parallel detection logic.

## Lifecycle and authority

Lifecycle mutations are `container.services.start`,
`container.services.stop`, and `container.services.restart`. Docker Desktop
uses its official CLI. Docker Engine uses `systemctl --no-ask-password` for the
already-authorized unit. Podman Machine uses official start and stop commands;
restart is an explicit stop followed by start. Redeven never invokes `sudo`,
`pkexec`, a password prompt, polkit, group membership changes, or socket
permission changes.

Every lifecycle mutation uses the existing native preflight and operation API.
It requires Read, Write, Execute, and Admin. Stop and restart additionally
require the exact displayed service name. Their preflight resolves the current
running-container count and the exact affected Web Service owners. Admin may
continue after reviewing that impact; the UI is not an enforcement boundary.
The operation stays locked by `(engine, container_service, service_id)` until a
fresh controller read proves the required final state. Interrupted operations
are observed and marked interrupted at startup and are never replayed.

## Configuration

`GET /_redeven_proxy/api/container-resources/services` requires Read.
`GET /_redeven_proxy/api/container-resources/services/{service_id}/configuration`
requires Read and Admin and returns `Cache-Control: no-store`. Docker Engine may
edit only its official `daemon.json`; local Podman may edit only the current
user's `containers.conf`. Docker Desktop, Podman Machine, remote services,
custom paths, symlinked paths, and externally managed or unwritable files are
read-only and direct the user to the official owner.

Configuration has two exclusive UI modes. Proxy mode edits HTTP, HTTPS, and
NO_PROXY values while preserving unrelated document fields. Advanced mode
edits the complete JSON or TOML document with the existing Monaco-backed text
editor. Each update includes the configuration `base_revision`, is limited to
256 KiB, and requires the exact service name. A changed revision fails before
write.

The server builds a candidate in memory and validates it before review and
again before execution. Docker candidates use `dockerd --validate
--config-file`; Podman candidates use an isolated temporary
`CONTAINERS_CONF` with a read-only `podman info`. Replacement is an atomic
same-directory rename that preserves file mode. “Save only” records whether a
Docker Engine restart is pending. “Save and restart” restores the exact old
bytes and attempts one recovery restart when the new configuration cannot be
applied. Failure to restore or restart returns `SERVICE_RECOVERY_REQUIRED`
without hidden retry loops.

Configuration documents, proxy values, embedded credentials, and host paths
never enter the product database, operation row, event stream, reconciliation,
audit detail, application log, or public error. Schema v3 stores only service
ID, configuration revision, restart-required state, service generation, and
update time. Its contiguous v2-to-v3 migration preserves saved Compose Projects
and fails atomically on schema drift.

## Product surface and observation

The Containers header exposes one “Container services” item in its shared
three-dot menu. It opens a component-local service page; normal resource tabs
and engine endpoints are not duplicated there. Service cards show status,
short guidance, supported actions, and restart-required state. A service
operation appears on its owning card, and selecting that progress row opens the
existing Operations detail and durable event timeline. Service mutations do
not automatically replace the page with the global drawer.

The configuration dialog uses shared Tabs and form controls. Docker Desktop
and Podman Machine provide an official-settings action instead of a false local
editor. Refresh, operation completion, and return to resources reload service,
runtime, inventory, and Web Service projections through their authoritative
owners. Desktop, Workbench, and narrow layouts preserve keyboard access,
44-pixel touch targets, reduced motion, forced colors, and every shipped
locale.

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
