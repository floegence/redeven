---
type: Runtime Contract
title: Managed Web Services
description: Deploy, operate, recover, and expose immutable Web Service template snapshots through one Redeven-owned lifecycle boundary.
tags: [architecture, web-services, runtime, containers, security]
timestamp: 2026-08-30T00:00:00Z
---
# Summary

- Authority: Redeven owns each installed service's immutable snapshot, lifecycle, runtime identity, private data, and protected forward; the application owns its settings and credentials.
- Outcome: a [Service template](managed-web-service-templates.md) becomes one managed card with open, lifecycle, logs, retry, update when eligible, and uninstall actions.
- Invariants: one instance exists per family, Web ports bind only to loopback, lifecycle work is idempotent and serialized, destructive work verifies exact identity, and credentials never enter records or logs.
- Failure boundary: invalid identity, prerequisites, health, or artifacts fail closed without touching unrelated resources.

# Contract

## Deployment execution

A deployment reports environment check, download/pull, verification, installation, start, health, forward registration, and open through an authenticated Local API stream. The managed card owns Start, Stop, Restart, Retry, Update, Logs, and Uninstall; its backing forward is hidden from manual controls. The card presents template identity, service state, workspace, two aligned primary actions, and visually subordinate maintenance actions inside the same responsive collection frame as search. Container-backed cards also expose exact Container and Image destinations supplied by the Runtime service view; Renderer code never derives either identity from a template identifier. The Containers surface resolves an Image destination against the authoritative inventory's exact image ID, reference, digest, tags, and digest-pinned reference aliases, then loads detail by the inventory's canonical identity. It never uses partial matching; a missing destination remains on the Image list and reports that the resource or inventory changed.

One Runtime operation record and event stream own each lifecycle action, including update. Renderer tracks every active operation independently by service and operation identity. Direct and recovered lifecycle work replaces stale observed status from submission onward. The compact progress is clipped inside the owning service's border, aligned below its information column, and connected by a quiet track; it shows only action, stage, exact artifact, position, and cancellation instead of repeating the service identity or creating a second card. Clicking the row indicator opens the operation identity and ordered stages. Install, update, and uninstall progress stays inside its owning disclosure. An operation has exactly one presentation owner, so no global list-tail progress, cross-service cancellation, or duplicate progress projection exists. The Runtime supplies the current operation artifact reference; the UI never infers an image from a template identifier. The shared compact working indicator uses the `thinking-orbs` Shaping preset, respects reduced motion and visibility, and adds no second progress state machine.

The instance saves the exact template revision, canonical definition, SHA-256, service-family identity, selected workspace, non-secret configuration, and runtime manifest before execution. Later template edits do not alter it. Redeven prepares a family-specific directory under the Environment home as the explicit default, so installation never grants the whole home directory merely because it is the first writable filesystem root. A user-selected replacement must still resolve to an existing writable directory inside the Environment filesystem scope. Secret inputs live only in a private `0600` Runtime file and are removed on uninstall.

Host scripts run through `/bin/sh -eu` as the current OS user with workspace, private data, loopback host, reserved port, and optional verified executable variables. Start remains foreground. Stop-script failure cannot bypass exact process-group cleanup; a PID outside the current Runtime generation is never adopted or killed.

Single-container deployment pulls first and requires a verifiable immutable OCI digest. All managed container paths use one image-pull boundary. Pulls have a dedicated 30-minute maximum and terminate immediately on operation cancellation; the ordinary 10-second container-command limit does not apply. Timeout, registry reachability, manifest absence, access or rate limits, and exhausted storage remain distinct stable product errors. Raw engine output never crosses that error boundary, and diagnostics remain redacted. The default restricted profile creates the exact image with `cap-drop ALL`, `no-new-privileges`, a read-only root, PID limit, bridge networking, project-owned volumes, hardened tmpfs, and exactly one `127.0.0.1` host publication. The only exception is the Runtime-owned `interactive_desktop` profile described below; custom templates cannot request it.

Compose pins every image and hashes its private generated configuration. Only the entry service receives the loopback Web port. Each lifecycle action verifies configuration, project, one-container-per-service membership, labels, images, hardening, and sidecar isolation.

## Built-in DeepSeek Harness

DeepSeek Harness remains Developer Preview software fixed at `0.1.1-rc.2`. The host and container cards share one service family, so one Environment can own at most one built-in DeepSeek Harness instance. Redeven does not automatically follow upstream releases.

Host deployment supports Linux and macOS on amd64 and arm64. The Redeven release pins the official Node.js `24.19.0` archive URL, byte size, and SHA-256 for each platform, and embeds an npm lock that fixes every DeepSeek Harness dependency URL and integrity value. Installation ignores host Node.js and npm configuration, exposes no ambient npm credentials to package scripts, permits only the five lifecycle-script packages recorded by the reviewed lock, and atomically writes a private runtime manifest and launcher after all checks pass. The launcher binds `127.0.0.1` and suppresses upstream browser opening.

Container deployment identifies `ghcr.io/runzhliu/deepseek-harness:0.1.1-rc.2` as community packaging, not a DeepSeek official distribution. The signed Redeven release pins the separately reviewed amd64 and arm64 OCI manifest digests in the Runtime, so deployment never resolves a mutable tag. Existing service retries use this current audited GHCR source with the platform digest; no Docker Hub or mutable-tag fallback exists. The container runs non-root under the hardened policy, mounts a private data volume and selected workspace, publishes only Harness port `3080` to loopback, and never publishes `6080`/noVNC.

Both DeepSeek templates declare `desktop_loopback` as their default access mode. This does not widen container privileges or change Harness configuration: it gives the isolated Desktop target view a real `127.0.0.1` Origin while the Desktop gateway still traverses the protected Runtime forward. Models and other upstream local-browser checks therefore see a local browser without modifying Harness. Web Env App and system-browser opening are unavailable for this mode; users may explicitly switch the persisted forward to `unified_proxy` when broad client access matters more than local-browser compatibility.

Changing either built-in deployment requires reviewed source/version, licenses, architecture, immutable identities, persistence, WebSocket, loopback, and protected-routing smoke tests. Host availability is derived only from the complete platform manifest compiled into the Redeven release, so an unrelated version-service response cannot disable the card. Container deployment remains gated by the exact per-platform digest compiled into the same release. Third-party notices distinguish on-demand software from code embedded in Redeven.

## Built-in interactive desktops and updates

The two independent Webtop templates, their reserved `interactive_desktop` profile, risk acknowledgement, immutable platform artifacts, and journaled update/rollback flow are owned by [LinuxServer Webtop](linuxserver-webtop.md). They still use this contract's single generic container lifecycle, protected forward, operation stream, persistence, and exact-identity checks; no second driver or Renderer state machine exists.

## Persistence and recovery

Port-forward registry schema v4 is the contiguous successor of v1 through v3. The v3-to-v4 edge adds the constrained `port_forwards.access_mode` column, defaults ordinary records to `unified_proxy`, and selects `desktop_loopback` for an existing managed forward only when its preserved service-family identity is `deepseek-harness`. It does not duplicate the mode in managed-service state. Every edge verifies the exact historical shape before applying and commits migration, data, metadata, version, and final verification atomically. Drift, future versions, or failure leave the prior database unchanged.

Service, stable protected forward, and initial install operation are created in one transaction. New protected forward identities are DNS-safe because the same value crosses the Runtime proxy, secure sandbox host, and Desktop browser route. Install-and-open and later card Open both resolve that record through the Web Service browser-session boundary; previously installed underscore-delimited records receive a temporary DNS-safe browser alias without changing lifecycle ownership or persistent data. Repeated request identities return the original operation only for the same fingerprint; conflicting reuse fails. At most one operation is pending, running, or cancelling per service.

Startup marks incomplete work `interrupted`, cleans only verifiable partial resources, and waits for Retry, except that an interrupted reviewed update follows its persisted finalize-or-rollback journal. A terminal instance with desired state `running` receives a recovery Start. Shutdown stops exact known runtimes while retaining desired state. Stop preserves the forward and card.

Uninstall retains data by default. Deleting data requires a second destructive confirmation and administrator or owner authority. Removal revalidates every process, container, Compose project, volume, and configuration identity before deleting it, then atomically removes the service and forward while retaining terminal operation history.

Health succeeds only after the application responds on its assigned loopback port. Redeven exposes the stable identity through the Local and remote protected routes defined by [Web Service browser sessions](web-service-browser-sessions.md).

## Local API and authorization

Catalog/list/create live under `/_redeven_proxy/api/managed-web-services`; lifecycle/logs use its `{id}` routes; cancellation/events use `.../managed-web-service-operations/{id}`. Catalogs expose declarative brand, notices, and default access mode; install requests accept the selected mode; service views project the backing forward's current mode alongside a Runtime-derived update target and optional current-operation artifact reference. Saved-service settings update that same forward record. Reads require Web Service read permission. Mutations require read, write, and execute; data deletion also requires administrator or owner. Bodies and audits are bounded and exclude definitions, scripts, values, notice text, and secrets.

# Boundaries

This contract does not include Windows host deployment, cross-Environment scheduling, nested Docker, automatic upgrades, migration between deployment kinds, public or LAN listeners, arbitrary multi-port publication, Webtop variants beyond the two reviewed templates, GPU, DinD, host Docker management, or Redeven management of application API keys.

# Evidence

- `redeven:internal/managedwebservice/manager.go` - Coordinates immutable instances, family admission, lifecycle, recovery, health, and forwarding.
- `redeven:internal/managedwebservice/catalog.go` - Pins supported Node.js platform archives and builds the release-owned native runtime manifest.
- `redeven:internal/managedwebservice/native.go` - Verifies, assembles, starts, and removes the private DeepSeek Harness host runtime.
- `redeven:internal/managedwebservice/assets/deepseek-harness-native/package-lock.json` - Fixes the npm dependency graph, package integrity values, and reviewed lifecycle-script set.
- `redeven:internal/managedwebservice/custom_host.go` - Owns host script execution, exact process cleanup, verified packages, private data, and redacted logs.
- `redeven:internal/managedwebservice/custom_container.go` - Pins and verifies single-container images, labels, volumes, hardening, and loopback identity.
- `redeven:internal/managedwebservice/image_pull.go` - Owns the shared managed-image pull boundary and stable product error classification.
- `redeven:internal/containerengine/cli_client.go` - Separates image-pull cancellation and timeout from ordinary container commands.
- `redeven:internal/managedwebservice/builtin_templates.go` - Pins the two Webtop releases and declares their independent families, notices, environment, mounts, and interactive desktop profile.
- `redeven:internal/managedwebservice/update.go` - Owns pull-before-stop updates, persisted phases, exact target commit, rollback, and interrupted recovery.
- `redeven:internal/managedwebservice/custom_compose.go` - Generates and verifies hardened exact-project Compose deployments.
- `redeven:internal/portforward/registry/schema.go` - Defines contiguous v1-to-v4 migrations, access-mode convergence, and exact historical/target verification.
- `redeven:internal/portforward/registry/managed.go` - Persists snapshots, operations, families, and protected-forward ownership.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Enforces Local API permissions, strict bodies, audit events, and authenticated progress.
- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceOperationController.ts` - Tracks independent service operations and their single presentation owner.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.test.tsx` - Verifies immediate row submission, operation details, independent streams, exact artifacts, and cancellation.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx` - Verifies exact container and image navigation across pending and live requests, image aliases, canonical detail identity, missing targets, and stale-response arbitration.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.browser.test.tsx` - Verifies dense row progress and viewport-contained operation details in Chromium.
- `redeven:internal/managedwebservice/manager_test.go` - Covers idempotency, concurrency, cancellation, recovery, identity rejection, and redaction.
- `redeven:internal/managedwebservice/update_test.go` - Covers running/stopped updates, pull-before-stop ordering, rollback, cancellation, and interrupted finalize/restore paths.
- `redeven:internal/managedwebservice/webtop_test.go` - Covers pinned platform artifacts, runtime restrictions, declarative risk acknowledgement, and built-in template independence.
- `redeven:internal/portforward/registry/registry_test.go` - Covers preservation, drift/future rejection, rollback, and atomic persistence.
