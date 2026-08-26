---
type: Runtime Contract
title: Managed Web Services
description: Deploy, operate, recover, and expose immutable Web Service template snapshots through one Redeven-owned lifecycle boundary.
tags: [architecture, web-services, runtime, containers, security]
timestamp: 2026-08-26T00:00:00Z
---
# Summary

- Authority: Redeven owns an installed service's immutable template snapshot, lifecycle state, exact runtime identity, private runtime data, and protected forward. The application owns its settings and credentials.
- Outcome: a deployment requested from the [Service template center](managed-web-service-templates.md) becomes one managed card alongside manually registered Web Services and can be opened, stopped, started, restarted, inspected, retried, or uninstalled.
- Invariants: one installed instance exists per service family; every Web port binds only to loopback; lifecycle requests are idempotent and serialized; every destructive action verifies the exact stored identity; credentials never enter records, audits, or returned logs.
- Failure boundary: invalid snapshots, identity drift, unavailable prerequisites, occupied ports, interrupted operations, unhealthy processes, or unverified artifacts fail closed. Redeven never scans for or terminates unrelated processes, containers, projects, or volumes.

# Deployment execution

A deployment reports environment check, download/pull, verification, installation, start, health, forward registration, and open through an authenticated Local API stream. The managed card owns Start, Stop, Restart, Retry, Logs, and Uninstall; its backing forward is hidden from manual controls.

The instance saves the exact template revision, canonical definition, SHA-256, service-family identity, workspace, non-secret configuration, and runtime manifest before execution. Later template edits do not alter it. Secret inputs live only in a private `0600` Runtime file and are removed on uninstall.

Host scripts run through `/bin/sh -eu` as the current OS user with workspace, private data, loopback host, reserved port, and optional verified executable variables. Start remains foreground. Stop-script failure cannot bypass exact process-group cleanup; a PID outside the current Runtime generation is never adopted or killed.

Single-container deployment pulls first and requires a verifiable immutable OCI digest. It creates the exact image with `cap-drop ALL`, `no-new-privileges`, a read-only root, PID limit, bridge networking, project-owned volumes, hardened tmpfs, and exactly one `127.0.0.1` host publication.

Compose pins every image and hashes its private generated configuration. Only the entry service receives the loopback Web port. Each lifecycle action verifies configuration, project, one-container-per-service membership, labels, images, hardening, and sidecar isolation.

# Built-in DeepSeek Harness

DeepSeek Harness remains Developer Preview software fixed at `0.1.1-rc.2`. The host and container cards share one service family, so one Environment can own at most one built-in DeepSeek Harness instance. Redeven does not automatically follow upstream releases.

Host deployment supports Linux and macOS on amd64 and arm64. The Redeven release pins the official Node.js `24.19.0` archive URL, byte size, and SHA-256 for each platform, and embeds an npm lock that fixes every DeepSeek Harness dependency URL and integrity value. Installation ignores host Node.js and npm configuration, exposes no ambient npm credentials to package scripts, permits only the five lifecycle-script packages recorded by the reviewed lock, and atomically writes a private runtime manifest and launcher after all checks pass. The launcher binds `127.0.0.1` and suppresses upstream browser opening.

Container deployment identifies `runzhliu/deepseek-harness:0.1.1-rc.2` as community packaging, not a DeepSeek official distribution. The signed Redeven release pins the separately reviewed amd64 and arm64 OCI manifest digests in the Runtime, so deployment never resolves a mutable tag. The container runs non-root under the hardened policy, mounts a private data volume and selected workspace, publishes only Harness port `3080` to loopback, and never publishes `6080`/noVNC.

Changing either built-in deployment requires reviewed source/version, licenses, architecture, immutable identities, persistence, WebSocket, loopback, and protected-routing smoke tests. Host availability is derived only from the complete platform manifest compiled into the Redeven release, so an unrelated version-service response cannot disable the card. Container deployment remains gated by the exact per-platform digest compiled into the same release. Third-party notices distinguish on-demand software from code embedded in Redeven.

# Persistence and recovery

Port-forward registry schema v3 is the contiguous successor of v1 and v2. It preserves existing forwards and v2 DeepSeek Harness instances, adds template persistence, and expands managed services with source, revision, definition hash, immutable snapshot, service family, configuration, and runtime manifest. Every edge verifies the exact historical shape before applying and commits migration, data, metadata, version, and final verification atomically. Drift, future versions, or failure leave the prior database unchanged.

Service, stable protected forward, and initial install operation are created in one transaction. Repeated request identities return the original operation only for the same fingerprint; conflicting reuse fails. At most one operation is pending, running, or cancelling per service.

Startup marks incomplete work `interrupted`, cleans only verifiable partial resources, and waits for Retry. A terminal instance with desired state `running` receives a recovery Start. Shutdown stops exact known runtimes while retaining desired state. Stop preserves the forward and card.

Uninstall retains data by default. Deleting data requires a second destructive confirmation and administrator or owner authority. Removal revalidates every process, container, Compose project, volume, and configuration identity before deleting it, then atomically removes the service and forward while retaining terminal operation history.

Health succeeds only after the application responds on its assigned loopback port. Redeven exposes the stable identity through the Local and remote protected routes defined by [Web Service browser sessions](web-service-browser-sessions.md).

# Local API and authorization

Catalog/list/create live under `/_redeven_proxy/api/managed-web-services`; lifecycle/logs use its `{id}` routes; cancellation/events use `.../managed-web-service-operations/{id}`. Reads require Web Service read permission. Mutations require read, write, and execute; data deletion also requires administrator or owner. Bodies and audits are bounded and exclude definitions, scripts, values, and secrets.

# Scope boundaries

This contract does not include Windows host deployment, cross-Environment scheduling, nested Docker, automatic upgrades, migration between deployment kinds, public or LAN listeners, arbitrary multi-port publication, or Redeven management of application API keys.

# Evidence

- `redeven:internal/managedwebservice/manager.go` - Coordinates immutable instances, family admission, lifecycle, recovery, health, and forwarding.
- `redeven:internal/managedwebservice/catalog.go` - Pins supported Node.js platform archives and builds the release-owned native runtime manifest.
- `redeven:internal/managedwebservice/native.go` - Verifies, assembles, starts, and removes the private DeepSeek Harness host runtime.
- `redeven:internal/managedwebservice/assets/deepseek-harness-native/package-lock.json` - Fixes the npm dependency graph, package integrity values, and reviewed lifecycle-script set.
- `redeven:internal/managedwebservice/custom_host.go` - Owns host script execution, exact process cleanup, verified packages, private data, and redacted logs.
- `redeven:internal/managedwebservice/custom_container.go` - Pins and verifies single-container images, labels, volumes, hardening, and loopback identity.
- `redeven:internal/managedwebservice/custom_compose.go` - Generates and verifies hardened exact-project Compose deployments.
- `redeven:internal/portforward/registry/schema.go` - Defines contiguous v1-to-v3 migrations and exact historical/target verification.
- `redeven:internal/portforward/registry/managed.go` - Persists snapshots, operations, families, and protected-forward ownership.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Enforces Local API permissions, strict bodies, audit events, and authenticated progress.
- `redeven:internal/managedwebservice/manager_test.go` - Covers idempotency, concurrency, cancellation, recovery, identity rejection, and redaction.
- `redeven:internal/portforward/registry/registry_test.go` - Covers preservation, drift/future rejection, rollback, and atomic persistence.
