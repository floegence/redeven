---
type: Architecture Contract
title: Container engine service management
description: Detect and safely manage the active local Docker or Podman implementation without exposing engine endpoints or elevation flows.
tags: [architecture, containers, docker, podman, host-control]
timestamp: 2026-09-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

One `ContainerServiceController` owns Docker/Podman service discovery, lifecycle, configuration, preflight identity and reconciliation. Opaque IDs hide endpoints. Host mutation requires full RWX and Admin without privilege elevation. Unknown ownership/revision/final state fails closed; interrupted work cannot be replayed.

# Contract

## Identity and execution

Discover Docker/Podman independently, one service/engine, no inactive-context scan/fallback. Each has a shared two-second command budget; reuse selected endpoint inventory for health. Resource readiness stays separately bounded. Docker Desktop requires selected desktop-linux/desktop-windows context or exact endpoint alias; installed plugins cannot claim other engines. Validate with docker desktop version --format json, never slow desktop status. Resolve Podman Machine ownership before health.

Known Desktop management/health errors retain ID, implementation, config sources and supported actions. Missing CLI/permission/timeout/unknown failures never mean stopped. Start requires stopped; Stop/Restart running. Save-and-restart requires known state before writes; plain save remains available.

Typed lifecycle actions share two minutes across steps, separate from ten-second query/two-second discovery; parent deadlines/cancel apply. macOS Start uses /usr/bin/open -g -b com.docker.docker then bounded endpoint polling; Restart stops first under that deadline. Other platforms/Stop use official CLI. LaunchServices receives only identity/home/PATH/temp/shell/locale/timezone/proxy/certificates, excluding Redeven metadata, Electron/Node controls, CLI overrides and secrets. Explicit empty env stays empty; CLI/probes retain theirs. Launch acceptance is not success; reload final state while locked. Never elevate, sudo/pkexec/polkit, alter groups/socket permissions.

Read-gated GET /_redeven_proxy/api/container-resources/services exposes mode/source IDs; one failure cannot hide another. Migration maps legacy state→engine and client_proxy→docker_cli.

## Interaction

One preflight confirmation shows service name, localized risks/impact counts and action; no retyped name/extra review. Client binds name; server checks identity/authority/request+plan hashes. Cancel creates no operation; duplicates stay locked. Hide hashes/raw prose; history resolves names/localized errors.

Settings entry warns. Header aligns outlined square Back/title independently of description; narrow target≥44px. Refresh retains cards, animates only indicator and uses inline errors. Known Desktop/unknown health retains disabled Start/guidance; revalidation enables it. Active divider section replaces normal controls with elapsed/cancel/secondary history. Failure exposes recovery/revalidation. History never auto-opens; unmeasured work has no percent. SSE/poll completion reloads service/runtime facts.

Observed health leads; active work retains locks/feedback. Terminal start/restart failure leaves card on running; stop failure leaves on stopped. Unknown/config failures retain recovery; completed/cancelled records stay in history. Current running never rewrites restart result. History keeps original result/error/duration apart from current state, no empty errors or historical time as live progress.

# Boundaries

`containerengine` owns exact argv, validation, atomic replacement/rollback and observation. `containerresource` owns preflight, impact, locking and sanitized durable state. Local API owns Read/RWX/Admin and no-store delivery. Docker Desktop/Podman Machine/remote tools retain private settings; administrators own installation/OS authority.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx` and its browser suite cover recovered lifecycle failures, preserved active/configuration feedback, immutable history, and responsive status revalidation in English and Simplified/Traditional Chinese.

- `redeven:internal/containerengine/container_services.go` - Defines the service model, safe DTO, preflights, and controller adapter boundary.

- `redeven:internal/containerengine/container_services_desktop_test.go` - Covers Desktop context ownership, bounded discovery, management/health failures and recovery, unsafe-action rejection, and start/stop/start with stable identity.

- `redeven:internal/containerresource/desktop_lifecycle_qualification_test.go` - Opt-in macOS stop/start/restart through production preflight, durable operations and reconciliation; requires explicit host lifecycle authorization and is skipped in ordinary CI. On 2026-10-27, the real Desktop dev environment reproduced a Docker Desktop 4.52.0 fork-server crash (`unmarshaling start request: unexpected EOF`) with LaunchServices as well as the earlier CLI path. Removing Redeven metadata allowed startup. With the explicit application environment, the same dev environment plus 58 KiB of synthetic runtime metadata passed stop (10.290 s), start (12.111 s) and restart (22.354 s), verified engine 29.0.1, and preserved the four running container IDs. The earlier shell-only start qualification did not cover this dev-environment failure.

- 2026-10-27 acceptance also covered 45 browser cases (including 390 px English, Simplified/Traditional Chinese recovery, 1440 px desktop, stable polling controls and stream-loss recovery), 158 focused UI/API/localization tests, Go race checks for containerengine/containerresource, TypeScript and ESLint. An isolated built Desktop displayed the real running Docker service with its native icons and controls; real stop/start qualification used the production operation service, separately from the browser fixtures.
