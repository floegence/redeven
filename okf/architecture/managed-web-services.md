---
type: Runtime Contract
title: Managed Web Services
description: Install, operate, recover, and expose reviewed Web Service templates through Redeven-owned lifecycle coordination.
tags: [architecture, web-services, runtime, containers, security, ui]
timestamp: 2026-08-25T00:00:00Z
---
# Summary

- Authority: Redeven owns installation, lifecycle state, exact runtime identity, and protected-forward registration for a managed Web Service; the installed application owns its settings and credentials.
- Outcome: an authorized user can install, start, health-check, open, stop, restart, inspect, retry, or uninstall one fixed DeepSeek Harness instance in the current Environment through either a reviewed native package or a hardened Docker container.
- Invariants: every upstream artifact is selected by a signed Redeven catalog, the application port listens only on loopback, the forward identity remains stable, lifecycle requests are idempotent and serialized, and Redeven never receives a DeepSeek Harness API key.
- Failure boundary: invalid catalog data, identity drift, occupied ports, unavailable deployment prerequisites, interrupted operations, or unhealthy processes fail closed. Redeven cleans only resources carrying the exact stored identity and never searches for or terminates unrelated processes or containers.

# Product contract

The Web Services page presents reviewed templates separately from manual address-first forwarding. The first template is DeepSeek Harness `0.1.1-rc.2`, identified as Developer Preview software. The current Environment is the deployment target; choosing another host remains the responsibility of the existing Environment switcher. One Environment can own at most one DeepSeek Harness instance.

The install surface shows the fixed version, estimated disk requirement, managed data location, accessible workspace roots, upstream source, and deployment availability. Direct installation and Docker are explicit alternatives. A deployment is enabled only after Redeven fetches and verifies the fixed-version signed catalog and finds a usable audited artifact; an unavailable, unpublished, malformed, or incomplete catalog disables installation with a stable reason. Docker is also disabled when its daemon is unavailable or the Environment is already inside a container. Docker copy identifies the selected image as community packaging rather than an official DeepSeek distribution.

Install is one user action with observable stages: environment check, download or pull, verification, installation, start, health check, and completion. Progress arrives through an authenticated fetch stream so the same Local API access material applies to the event request. Successful installation reserves the browser action from the initiating gesture and opens the existing protected Web Service route. The resulting managed card is the lifecycle owner and exposes Open, Start, Stop, Restart, Logs, Retry install when applicable, and Uninstall. It is not duplicated in the ordinary saved-forward list.

Uninstall retains application data by default. Deleting data requires an explicit destructive confirmation and administrator or owner authority. Removing a service also removes its protected forward, while its terminal operation history remains available for audit and idempotency. Application credentials, including API keys, are configured only in DeepSeek Harness itself; Redeven request models reject unknown credential fields, and operation logs and audit details must not contain secrets.

# Deployment contract

## Signed catalog and native packages

Redeven reads the fixed public catalog endpoint `https://version.agent.redeven.com/v1/managed-web-services/deepseek-harness/0.1.1-rc.2.json` and accepts only an Ed25519-signed envelope with the compiled trust identity, the exact `deepseek-harness` template id, and version `0.1.1-rc.2`. Cross-origin redirects, untrusted package origins, malformed signatures, unexpected fields, invalid sizes, and invalid digests are rejected. Catalog publication is a release prerequisite rather than a runtime fallback: every platform entry must be tied to the reviewed source revision, version, license inventory, architecture, package size, SHA-256, and executable path.

Native deployment supports Linux and macOS on amd64 and arm64. Its reviewed archive includes the fixed Node.js runtime, DeepSeek Harness, and required native dependencies, so installation does not depend on a host Node.js. Redeven downloads into a private staging directory, verifies the declared byte count and SHA-256, accepts only regular files and directories whose paths remain inside the archive root, and atomically renames the verified tree into the Runtime private state directory. Partial staging is removed on failure or Runtime startup.

The native launcher runs from the selected workspace with its data and logs under the managed private state root, passes `--host 127.0.0.1`, and records an instance-specific process identity. Stop and cleanup operate only on a process held by the current Runtime generation with the exact identity. A live persisted PID without matching in-memory ownership is treated as an identity conflict, not adopted or killed.

## Hardened Docker deployment

Docker deployment accepts only `runzhliu/deepseek-harness:0.1.1-rc.2` combined with the signed catalog's immutable `sha256` OCI digest for the current amd64 or arm64 architecture. Mutable tags such as `latest` are never resolved. The container uses a service-specific label and exact container id, runs non-root with a read-only root filesystem, drops all capabilities, enables `no-new-privileges`, applies a PID limit, uses bounded shared memory and hardened temporary filesystems, and mounts only its managed data volume plus the selected workspace.

The container publishes exactly the Harness Web port `3080` to its reserved host port on `127.0.0.1`. It does not publish the image's `6080` noVNC port. Before start, stop, removal, logs, or data deletion, Redeven re-inspects the exact stored container, labels, image digest, port mapping, and hardening policy. Data deletion additionally verifies the stored volume name and creation identity.

# Lifecycle and persistence

The port-forward registry schema version 2 adds managed service and operation records through the contiguous v1-to-v2 migration while preserving every existing forward. Service, stable protected forward, and initial install operation are created in one transaction. A managed forward cannot be removed through the ordinary delete-forward API; only successful managed uninstall removes the service and its forward in one transaction.

Every mutation carries an opaque `request_id`. Redeven persists a request fingerprint and returns the original operation only when a repeated id has the same action and payload; conflicting reuse fails with `IDEMPOTENCY_CONFLICT`. At most one pending, running, or cancelling operation exists for a service. A snapshot is emitted before live progress, and terminal state remains queryable after the service is uninstalled.

Runtime startup marks incomplete operations `interrupted`, cleans only their verified partial resource, and leaves the service stopped in an error state for an explicit user retry; it never silently resumes an interrupted operation. A service whose desired state is `running` and whose latest operation was already terminal receives a new start recovery operation. Runtime shutdown cancels active work and stops known running instances while retaining their desired state for recovery. Cancellation and failures clean only verified partial resources, persist stable error codes, and leave retry as a user-visible action.

Health succeeds only after the application responds on its assigned loopback port. Redeven then exposes the stable forward through the existing Local and remote Environment protected routes described by [Web Service browser sessions](web-service-browser-sessions.md). Stopping retains the forward identity and managed card; the protected route may report the existing unavailable-service state until the service starts again.

# API and authorization

The Local API surface is:

- `GET /_redeven_proxy/api/managed-web-services/catalog`
- `GET /_redeven_proxy/api/managed-web-services`
- `POST /_redeven_proxy/api/managed-web-services`
- `POST /_redeven_proxy/api/managed-web-services/{id}/operations`
- `GET /_redeven_proxy/api/managed-web-services/{id}/logs`
- `POST /_redeven_proxy/api/managed-web-service-operations/{id}/cancel`
- `GET /_redeven_proxy/api/managed-web-service-operations/{id}/events`

Catalog, list, logs, and event streams require Web Service read permission. Install, lifecycle operations, and cancellation require read, write, and execute permission. Uninstall with data deletion additionally requires administrator or owner authority. Mutation attempts append a bounded audit event with template, deployment, workspace, service, operation, action, and delete-data intent as applicable; credential values are never accepted or recorded.

# Release and scope boundaries

DeepSeek Harness remains fixed until a reviewed Redeven change advances its version. A community image enters the signed catalog only after the selected source commit, DSH version, both architectures, OCI digest, licenses, hardening behavior, loopback publication, persistence, WebSocket behavior, and protected routing pass release smoke tests. Native archives retain upstream license and dependency notices; the community image retains its own operating-system and package notices. The repository third-party inventory distinguishes on-demand software from code embedded in Redeven.

This contract does not include Windows native installation, multiple instances, cross-Environment scheduling, nested Docker, automatic upgrades, native-to-Docker data migration, public or LAN application listeners, or management of DeepSeek Harness API keys.

# Evidence

- `redeven:internal/managedwebservice/catalog.go` - Verifies the signed fixed-version catalog and trusted package origin.
- `redeven:internal/managedwebservice/native.go` - Installs verified native archives atomically and owns exact native process lifecycle, loopback launch, data, logs, and cleanup.
- `redeven:internal/managedwebservice/docker.go` - Pins the community image digest and verifies hardened container, volume, and network identity.
- `redeven:internal/managedwebservice/manager.go` - Coordinates idempotent serialized operations, recovery, health checks, cancellation, state, and event snapshots.
- `redeven:internal/portforward/registry/schema.go` - Defines the contiguous port-forward registry v1-to-v2 migration.
- `redeven:internal/portforward/registry/managed.go` - Persists managed lifecycle records and atomically owns protected-forward creation and removal.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Enforces Local API permissions, strict request bodies, audit events, and SSE progress.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Presents deployment selection, progress, lifecycle, logs, opening, and destructive uninstall confirmation.
- `redeven:internal/managedwebservice/manager_test.go` - Covers operation idempotency, concurrency, cancellation, event snapshots, identity rejection, and log redaction.
- `redeven:internal/portforward/registry/registry_test.go` - Covers migration preservation, rollback, drift and future rejection, protected forwards, and atomic lifecycle persistence.
- `redeven:internal/codeapp/appserver/managed_web_services_test.go` - Covers route permissions, administrator-only data deletion, strict credential rejection, and SSE terminal snapshots.
- `redeven:internal/capabilities/containers/resources_v3_test.go` - Verifies the hardened Docker create request and CLI mapping.
- `redeven:scripts/generate_third_party_notices.mjs` - Generates the on-demand DeepSeek Harness and community image notices.
