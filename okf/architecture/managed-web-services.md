---
type: Runtime Contract
title: Managed Web Services
description: Deploy, operate, recover, and expose immutable Web Service template snapshots through one Redeven-owned lifecycle boundary.
tags: [architecture, web-services, runtime, containers, security]
timestamp: 2026-08-31T00:00:00Z
quality_exception: Cross-domain lifecycle contract linking deployment, operation presentation, persistence, recovery, authorization, and exact runtime ownership.
---
# Summary

- Authority: Redeven owns each installed service's immutable snapshot, lifecycle, runtime identity, private data, and protected forward; the application owns its settings and credentials.
- Outcome: a [Service template](managed-web-service-templates.md) becomes one managed card with open, lifecycle, logs, retry, update when eligible, and uninstall actions.
- Invariants: one instance exists per family, Web ports bind only to loopback, lifecycle work is idempotent and serialized, destructive work verifies exact identity, and credentials never enter records or logs.
- Failure boundary: invalid identity, prerequisites, health, or artifacts fail closed without touching unrelated resources.

# Contract

## Deployment execution

Deployment streams environment check, artifact preparation, verification, install, start, health, and forward registration through the authenticated Local API. The template drawer owns configuration and submission only. After Runtime persists the service and operation, Renderer closes the drawer and transfers that operation and stream to its new service row. Drawer closure never cancels work; only the row Cancel action does. Deployment reserves no browser window and never force-opens the service. The card owns lifecycle and log actions while hiding its forward from manual controls. Container-backed cards receive exact Container and Image destinations from Runtime; Renderer never infers them from a template ID. Image navigation matches a complete image ID, reference, digest, tag, or pinned-reference alias from authoritative inventory, then opens its canonical identity. Partial matches are forbidden, and a missing target leaves the list stable with an explicit notice.

One Runtime operation record and event stream own each lifecycle action. Renderer keys active work by service and operation; direct or recovered work replaces stale status from submission onward. The attached service-row disclosure is the only operation-details entry and expands in place to ordered stages, exact image, Compose image position, downloaded and total bytes, smoothed three-second transfer rate, layer counts, and stage elapsed time. A known byte total drives determinate progress; layer-only output remains indeterminate and never invents a percentage. Ordinary transfer changes persist and publish at most every 500 milliseconds, while stage changes and terminal outcomes publish immediately. Persistence always precedes the existing SSE publication, so reconnect cannot observe a projection newer than Registry state. One operation has one presentation owner: no dialog duplicate, global tail progress, polling, cross-service cancellation, or second state source. Active copy uses a theme-token shimmer and the shared `thinking-orbs` Shaping indicator; both become static under reduced motion.

An errored service exposes one structured `last_failure` projection. Its focusable status shows only the action, redacted user-facing explanation, stage, and time; an adjacent action copies a bounded diagnostic containing only persisted identifiers and sanitized fields. Secrets, raw commands, engine output, stacks, and workspace content never enter that diagnostic. Starting new work lets active progress replace the old error, successful completion clears the current error, and another failure replaces it. Historical operation context that was never persisted is omitted rather than inferred from template or service state.

The instance saves the exact template revision, persisted definition, SHA-256, service-family identity, selected workspace, versioned instance overrides, configuration revision and SHA-256, and runtime manifest before execution. Snapshot identity protects the exact stored JSON document: reads first hash those persisted bytes, then strictly decode and validate the typed Runtime policy. They never reserialize a decoded structure as an alternate identity. The one effective-spec resolver combines the immutable template baseline with overrides for install, start, retry, update, reconfigure, recovery, and verification. Later template edits do not alter the installed snapshot; an update that makes an override invalid or conflicts with a managed anchor stops before mutation and requires explicit user resolution. Redeven prepares a family-specific directory under the Environment home as the explicit default, so installation never grants the whole home directory merely because it is the first writable filesystem root. A user-selected replacement must still resolve to an existing writable directory inside the Environment filesystem scope.

## Instance configuration and reconfigure

The effective specification, settings API, typed Runtime fields, managed anchors, Admin risk plan, private secrets, stopped-state rebuild, rollback, and interaction contract are owned by [Managed Service instance configuration](managed-service-instance-configuration.md). Every lifecycle path consumes that one result; no Renderer-preserved or deployment-specific configuration path exists.

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

Port-forward Registry schema v6 is the contiguous successor of v1 through v5. V3-to-v4 adds the constrained access mode and migrates existing DeepSeek forwards to `desktop_loopback`. V4-to-v5 versions and hashes configuration, adds service resource identities, and assigns stable IDs to historical typed resources while preserving records. V5-to-v6 adds the non-null schema-v1 operation-progress document and backfills every historical operation with an empty readable document. It does not rewrite configuration schema v2, template schema v1, service secrets schema v1, their digests, resource identities, operation history, timestamps, forwards, or recovery journals. Legacy volume markers are imported once and removed.

The Registry opens and completes every required migration before the Managed Service Manager or API accepts requests. Every edge verifies its reviewed source and target, and the migration, version metadata, document validation, and final structure commit in one transaction. Failure rolls back to the last supported database; Redeven never deletes, replaces, silently repairs, or asks the user to recreate it. Wrong kind, structural drift, invalid progress documents, and future versions fail closed with an actionable diagnostic. Reopening current v6 is idempotent. Any later persistent-format change must append its contiguous migration and preserve this lineage rather than raising the minimum version or relying on decoder fallback.

Service, stable protected forward, and initial install operation are created in one transaction. Terminal operation state and the service's current error fields also commit in one Registry transaction; a failure cannot leave one side newer than the other. New protected forward identities are DNS-safe because the same value crosses the Runtime proxy, secure sandbox host, and Desktop browser route. The card Open action resolves that record through the Web Service browser-session boundary after the service is ready; previously installed underscore-delimited records receive a temporary DNS-safe browser alias without changing lifecycle ownership or persistent data. Repeated request identities return the original operation only for the same fingerprint; conflicting reuse fails. At most one operation is pending, running, or cancelling per service.

Startup marks incomplete work `interrupted`, cleans only verifiable partial resources, and waits for Retry, except that an interrupted reviewed update follows its persisted finalize-or-rollback journal. A terminal instance with desired state `running` receives a recovery Start. Shutdown stops exact known runtimes while retaining desired state. Stop preserves the forward and card.

Uninstall retains data by default. Deleting data requires a second destructive confirmation and administrator or owner authority. Each deployment driver owns one stop-and-remove sequence; the lifecycle manager does not issue a second stop. Container and Compose removal verifies the persisted Runtime ID, deterministic managed name or project, service label, image identity, and managed volume identity without requiring an otherwise executable configuration snapshot. A container confirmed absent is already removed; engine unavailability or any ownership mismatch still fails closed. Host uninstall scripts remain executable authority and therefore require a valid verified snapshot. Successful removal atomically deletes the service and forward while retaining terminal operation history.

Health succeeds only after the application responds on its assigned loopback port. Redeven exposes the stable identity through the Local and remote protected routes defined by [Web Service browser sessions](web-service-browser-sessions.md).

## Local API and authorization

Catalog/list/create live under `/_redeven_proxy/api/managed-web-services`; lifecycle/logs use its `{id}` routes; cancellation/events use `.../managed-web-service-operations/{id}`. Catalogs expose declarative brand, notices, and default access mode; install requests accept the selected mode. `ManagedOperation.progress_detail` owns versioned stage and transfer detail, while `ServiceView.last_failure` owns the current structured diagnostic; Renderer does not reconstruct either from legacy error or artifact fields. `GET|PATCH .../{id}/settings` is the only saved-service settings boundary, and `POST .../{id}/reconfigure/preflight` plus the existing operation endpoint own Runtime apply. Reads require Web Service read permission. Mutations require read, write, and execute; high-risk reconfigure and data deletion also require administrator or owner. Bodies and audits are bounded and exclude definitions, scripts, values, notice text, and secrets.

# Boundaries

This contract does not include Windows host deployment, cross-Environment scheduling, nested Docker, automatic upgrades, migration between deployment kinds, public exposure of the managed primary Web endpoint, Webtop variants beyond the two reviewed templates, automatic GPU or DinD enablement, host Docker management, or Redeven management of application API keys. Explicit custom-template ports and high-risk runtime access are user-owned exceptions admitted only through the typed Admin-confirmed Resource Plan.

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
- `redeven:internal/managedwebservice/configuration.go` - Resolves and validates the single template-baseline plus instance-override effective specification.
- `redeven:internal/managedwebservice/settings.go` - Owns metadata settings, typed Runtime drafts, Resource Plans, risks, anchors, and secret redaction.
- `redeven:internal/managedwebservice/reconfigure.go` - Journals stopped-state rebuild, exact verification, atomic commit, rollback, and interrupted recovery.
- `redeven:internal/portforward/registry/schema.go` - Defines contiguous v1-to-v6 migrations, exact historical/target verification, and schema-v1 operation-detail backfill.
- `redeven:internal/portforward/registry/managed.go` - Persists snapshots and structured progress, atomically finalizes operation and service error state, and owns families and protected forwards.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Enforces Local API permissions, strict bodies, audit events, and authenticated progress.
- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceOperationController.ts` - Tracks independent service operations and their single presentation owner.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.test.tsx` - Verifies immediate row submission, operation details, independent streams, exact artifacts, and cancellation.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx` - Verifies exact container and image navigation across pending and live requests, image aliases, canonical detail identity, missing targets, and stale-response arbitration.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.browser.test.tsx` - Verifies dense row progress and viewport-contained operation details in Chromium.
- `redeven:internal/managedwebservice/manager_test.go` - Covers idempotency, concurrency, cancellation, recovery, identity rejection, and redaction.
- `redeven:internal/managedwebservice/uninstall_test.go` - Covers single-owner uninstall progress, container ownership-only recovery, missing resources, and host-script fail-closed behavior.
- `redeven:internal/managedwebservice/update_test.go` - Covers running/stopped updates, pull-before-stop ordering, rollback, cancellation, and interrupted finalize/restore paths.
- `redeven:internal/managedwebservice/webtop_test.go` - Covers pinned platform artifacts, runtime restrictions, declarative risk acknowledgement, and built-in template independence.
- `redeven:internal/portforward/registry/registry_test.go` - Covers preservation, drift/future rejection, rollback, and atomic persistence.
