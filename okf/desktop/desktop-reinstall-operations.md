---
type: Desktop Contract
title: Desktop managed Environment reinstall
description: Direct-channel destructive reinstall, shared progress operation, and target ownership boundaries.
tags: [desktop, reinstall, runtime, gateway, ssh, containers]
timestamp: 2026-08-22T00:00:00Z
---
# Summary

Desktop owns one `reinstall_target` operation with `wipe_data` and `preserve_data` modes for Local, SSH host, Local container, and SSH container Managed Environments. It acquires the same physical-target lifecycle owner used by Start, Stop, Restart, Update, Open recovery, and automatic startup. It uses the saved direct host or container channel and never depends on the old Gateway, Runtime, bridge, or state. Gateway and Runtime packages form one parallel batch, while the current lightweight process helper is prepared in parallel with that batch. Wipe replaces the exact Redeven `runtime_root`; preserve atomically replaces both managed component directories. A failure after isolation preserves quarantine and enters manual recovery without restarting the old installation.

# Contract

## One operation and one timeline

The click creates a Launcher Operation before preflight, so the existing `EnvironmentProgressPanel` immediately shows the complete ordered plan. Preflight, confirmation, package acquisition, installation, startup, verification, and cleanup retain one `operation_key`. The panel keeps completed, running, and pending steps visible, carries elapsed time and structured diagnostics, and can be reopened from the Environment card after it is closed. Confirmation is a state of the same operation, not a second renderer dialog or a second preflight. Runtime lifecycle and Open recovery carry an explicit progress surface, so a stale Open snapshot cannot replace the active Update timeline.

The fixed plan is:

```text
preflight -> confirmation -> target_locked -> preparing_maintenance_helper
-> packages_preparing_and_transferring -> sessions_closed
-> redeven_processes_stop_attempted -> packages_applying
-> gateway_and_runtime_starting -> installation_verifying
-> cleanup -> completed
```

The package phase shows independent Gateway and Runtime sub-progress. Desktop upload and remote install both validate manifest, release, commit, platform, architecture, archive size, and SHA-256. Platform detection occurs once. The process helper and component batch start concurrently after that probe and publish independent ready events; helper failure remains best-effort, while a package failure cancels its sibling and cleans staging. A suite manifest is required before activation, so partial installation is impossible.

## Direct-channel ownership

After confirmation, the direct Local/SSH/container channel is the only required authority. Reinstall takes the shared physical-target lifecycle owner, cancels a cancelable readiness mutation, waits for its cleanup, and prevents any new Start, Stop, Restart, Update, Open, or automatic startup from racing the destructive boundary. Old Gateway/Runtime state, unknown processes, installation strategy, journal age, and existing quarantine never block the operation. A current lightweight maintenance helper is staged once outside `runtime_root`; inventory and best-effort stop reuse that session. Process-helper failure does not prevent exact-root cleanup. Other processes are not inspected or treated as owners of Redeven data. The complete root is atomically moved to an operation-specific quarantine; every file below it is Redeven-owned and is removed only after fresh verification.

The operation does not read, migrate, or call APIs in the quarantined installation. It does not invoke old Gateway APIs, bridge commands, service fallback, broad path deletion, home-directory deletion, container prune, or unregistered volumes. A missing target is a fresh install. Only an unsafe registered coordinate, unavailable direct channel, or filesystem refusal fails an execution step. Logical SSH root aliases are re-resolved over the direct channel instead of being compared as local strings. Existing older quarantines remain recoverable evidence and do not block a new confirmed operation. Once isolation succeeds, the old installation is never restarted. Preserve mode stops any newly started processes before restoring both old managed directories and their suite manifest; rollback failure retains recovery evidence.

## Gateway separation

Managed Environment records live in Environment Target storage and appear only on the Environments page. Their internal Gateway supervisor is an implementation detail and is never projected into Gateway records or paired from Desktop. Standalone Gateways use `redeven-gateway --mode standalone`, own only their URL endpoint and trust/catalog, and never create Runtime binding, Runtime state, or lifecycle APIs. A Gateway-backed Environment is an access-only Environment reached through its explicit URL `access_endpoint`; it does not expose reinstall or Runtime lifecycle controls.

# Boundaries

Redeven clears the exact Desktop-registered root, including Gateway, Runtime, managed packages, workspaces, projects, application data, Floret/ReDevPlugin data, trust, identity, Catalog, and Environment configuration. It retains only channel credentials, target location, and the temporary journal required to complete or recover the operation. It does not delete upstream databases outside the root or inspect unrelated process file descriptors.

# Evidence

- `redeven:desktop/src/shared/desktopReinstallProgress.ts:1` - Canonical reinstall step plan and structured step snapshots.
- `redeven:desktop/src/main/reinstallTargetCoordinator.ts:1` - Exact-target preflight, process inventory, quarantine, fresh install, verification, journal recovery, and fail-closed validation.
- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:1` - Shared physical-target ownership across lifecycle and reinstall operations.
- `redeven:desktop/src/main/runtimePackageCache.ts:1` - Lightweight current-helper preparation without building the complete Runtime suite.
- `redeven:desktop/src/main/main.ts:3039` - Current Gateway/Runtime package acquisition and progress mapping through direct host/container executors.
- `redeven:desktop/src/main/main.ts:4481` - Launcher operation journal hydration after Desktop restart.
- `redeven:desktop/src/welcome/App.tsx:8850` - Shared Environment progress panel, explicit surface selection, and concise reinstall confirmation details.
- `redeven:desktop/src/main/gatewayStore.ts:779` - Gateway Store URL-only standalone record boundary.
- `redeven:cmd/redeven-gateway/main.go:494` - Standalone Gateway startup omits Runtime supervisor and lifecycle state.
- `redeven:desktop/src/main/reinstallTargetCoordinator.test.ts:1` - Exact-root replacement, quarantine retention, changed-target rejection, and direct executor coverage.
