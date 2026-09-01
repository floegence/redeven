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
configuration access: `local` with ordered source IDs, or `unavailable` with a
short reason. Host paths, addresses, unit details, and connection data never
enter the service-list DTO. Runtime discovery consumes the same projection.

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
only the configuration access mode and source IDs. `unavailable` provides an
explanation and no external handoff.
`GET /_redeven_proxy/api/container-resources/services/{service_id}/configuration`
requires Read and Admin, returns `Cache-Control: no-store`, and independently
projects each local source with source ID, display-only path, status, format,
revision, sections, and apply modes. Missing files are creatable; permission,
invalid syntax, symlink, and unsupported ownership are explicit source-local
states. One failed source never hides another source.

Docker Desktop has an Engine source at `~/.docker/daemon.json` and a Docker CLI
source at the current user's Docker configuration directory. Native Docker has
its official system or rootless Engine source plus the same current-user Docker
CLI source. `DOCKER_CONFIG` changes that directory when it is an absolute path.
Local
Podman has the current user's `containers.conf`. Podman Machine and remote
services remain unavailable because their configuration is not a local host
file owned by this controller. Redeven never reads or writes Docker Desktop's
private settings store.

Engine proxy mode edits HTTP, HTTPS, and NO_PROXY fields while preserving
unrelated document fields. Advanced mode edits the complete JSON or TOML
document with the existing Monaco-backed editor. Docker Desktop Engine exposes
advanced mode only because daemon proxy fields do not control Desktop proxy
behavior. The Docker CLI source owns one complete `config.json` document and
one revision. Its General, Proxies, Credentials, and Advanced views mutate that
same safe JSON draft; they are not independent configuration stores. The
projection includes contexts, output formats, headers, aliases, features,
plugins, credential-helper selection, every proxy target, and unknown fields.
Command-line options and environment variables remain authoritative overrides;
the response names `DOCKER_CONTEXT` or `DOCKER_HOST` when one is active without
returning its value.

The Docker-managed `auths` object is the only protected document field. Its
payload never enters the API. The response may list registry names so the user
can understand which entries will be preserved. A candidate containing
`auths` is rejected; a valid candidate is merged with the exact original
`auths` value before atomic replacement. Registry sign-in and sign-out remain
owned by `docker login` and `docker logout`. Docker CLI proxy settings affect
new containers and builds, not image pulls, the daemon, or existing containers.

Each update includes `source_id` and that source's `base_revision`, is limited
to 256 KiB, and requires the exact service name. A changed revision fails
before write. Engine sources support save and, where lifecycle control exists,
save-and-restart. Docker CLI supports save only and never requests a restart.

Candidates are validated before review and execution: Docker uses `dockerd
--validate --config-file`; Podman uses temporary `CONTAINERS_CONF` and read-only
`podman info`. Replacement is atomic and preserves mode. “Save and restart”
restores old bytes and attempts one recovery start on failure; failed recovery
returns `SERVICE_RECOVERY_REQUIRED` without hidden retries.

Configuration documents, credential payloads, and real host paths never enter
the database, Operations, audit, logs, or public errors. Configuration reads
require Read and Admin and remain `no-store`. Schema v5 keys sanitized state by
`(service_id, source_id)` and stores only revision, restart-required state,
generation, and update time. Its contiguous migrations map legacy service state
to `engine` and rename the retired `client_proxy` source to `docker_cli`.

## Product surface and observation

The Containers header exposes one direct Settings action for “Container
services”; runtime warnings decorate that same action instead of adding a
second entry. It opens a component-local service page without duplicating
resource tabs or endpoints. Compact cards use audited Docker and Podman marks
from one pinned theSVG revision, status color, supported actions, and a short
page-entry/elevation transition. Reduced-motion removes movement; forced-colors
replaces brand color with the audited monochrome variant. Initial skeletons use
the same card tracks, brand mark, status, guidance, and action geometry as the
loaded cards. Refresh preserves the last authoritative cards, animates only the
refresh indicator, and reports failure inline; it never replaces usable content
with a skeleton or replays card-entry animation.

Every locally configurable card has one configuration action. Shared top-level
Tabs select Engine or Docker CLI; each source shows its display path and status.
Engine uses structured proxy fields where valid and Monaco-backed advanced
editing. Docker CLI presents General, Proxies, Credentials, and Advanced views
over one draft. General leads with the common context and detach-key tasks;
optional output formatting stays collapsed until requested and pairs every
stored field key with the Docker command it affects. Proxy values are masked
with explicit reveal controls, protected registry names are read-only, and
Advanced exposes the complete non-credential document. Podman Machine and
remote configuration remain disabled with a local reason; no button leaves
Redeven. Service operation progress stays on its owning card and opens the
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
- Docker Desktop retains ownership of private application settings; Podman
  Machine and remote host tools retain ownership of non-local configuration.
- The host administrator owns installation and operating-system authority.

# Evidence

- `redeven:internal/containerengine/container_services.go` - Defines the service model, safe DTO, preflights, and controller adapter boundary.
- `redeven:internal/containerengine/container_services_cli.go` - Implements official discovery, exact lifecycle argv, validation, atomic writes, and rollback.
- `redeven:internal/containerengine/container_services_test.go` - Proves independent detection, systemd non-elevation, machine inspect association, revision conflict, and symlink rejection.
- `redeven:internal/containerresource/service.go` - Enriches service preflight with current container and Web Service impact.
- `redeven:internal/containerresource/dispatch.go` - Executes and reconciles service lifecycle and configuration operations.
- `redeven:internal/containerresource/schema.go` - Owns the v5 per-source metadata-only schema and contiguous migrations.
- `redeven:internal/codeapp/appserver/container_resources.go` - Exposes service reads and enforces Local API permissions, audit redaction, and no-store delivery.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx` - Owns the service page, card-local operation progress, source tabs, one Docker CLI draft, and the Engine editor.
- `redeven:assets/container_service_icons.json` - Pins and hashes the audited Docker and Podman brand variants used by the service cards.
