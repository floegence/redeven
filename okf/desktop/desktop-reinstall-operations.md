---
type: Desktop Contract
title: Desktop managed Environment reinstall
description: Direct-channel destructive reinstall, shared progress operation, and target ownership boundaries.
tags: [desktop, reinstall, runtime, gateway, ssh, containers]
timestamp: 2026-08-22T00:00:00Z
---
# Summary

Desktop owns one `reinstall_target` operation with `wipe_data` and `preserve_data` modes for Local, SSH host, Local container, and SSH container Managed Environments. It acquires the same physical-target lifecycle owner used by Start, Stop, Restart, Update, Open recovery, Refresh, and automatic startup. It uses the saved direct host or container channel and never depends on the old Gateway, Runtime, bridge, or state. Gateway and Runtime packages form one verified parallel batch, while the current lightweight process helper is prepared in parallel with that batch. Wipe is the final recovery path: if the confirmed direct channel, supported current packages, and exact-root filesystem operations work, old Redeven state cannot block completion. Preserve atomically replaces both managed component directories and restores both on failure.

# Contract

## One operation and one timeline

The click creates a Launcher Operation before preflight, so the existing `EnvironmentProgressPanel` immediately shows the complete ordered plan. Preflight, confirmation, package acquisition, installation, startup, verification, and cleanup retain one `operation_key`. The panel keeps completed, running, and pending steps visible, carries elapsed time and structured diagnostics, and can be reopened from the Environment card after it is closed. Confirmation is a state of the same operation, not a second renderer dialog or a second preflight. Runtime lifecycle and Open recovery carry an explicit progress surface, so a stale Open snapshot cannot replace the active Update timeline.

The fixed plan and durable commit points are:

```text
confirmation -> direct_channel_open -> target_resolved
-> package_batch_prepared_and_verified -> redeven_process_stop_attempted
-> old_root_isolated_or_cleared -> fresh_suite_installed
-> gateway_started -> runtime_started -> runtime_verified
-> catalog_and_local_ui_verified -> old_data_cleaned -> completed
```

The package phase shows independent Gateway and Runtime sub-progress. Desktop upload and remote install both validate manifest, release, commit, platform, architecture, archive size, and SHA-256. Development cache identity includes the source commit, so equal development tags cannot mix binaries from different source revisions. Public ReDevPlugin release metadata is fetched over verified HTTPS and does not require a signed-in GitHub CLI. Platform detection occurs once. The process helper and component batch start concurrently after that probe and publish independent ready events; helper failure remains best-effort, while a package failure cancels its sibling and cleans staging. Parallel cancellation retains the first initiating build or transfer failure as the structured operation cause instead of replacing it with a sibling cancellation. The journal records `package_batch_prepared_and_verified` only after every component is ready. A matching suite manifest is required before activation, so partial installation is impossible.

Every direct Managed Environment menu always contains Start, Stop, Restart, Update, Refresh, wipe reinstall, preserve reinstall, and Provider connect/disconnect. Diagnosis changes the recommended primary action but never removes or disables direct lifecycle recovery. Provider connect alone may be disabled when no compatible Provider Environment exists. Repeating the active action reopens its existing progress; a different action shows the current owner instead of creating a competing operation.

## Direct-channel ownership

After confirmation, the direct Local/SSH/container channel is the only required authority. One in-process coordinator serializes lifecycle requests from the current Desktop. The owner key is the SSH authority or local host, exact container engine/id when present, and canonical `runtime_root`; registration id and alternate state-root projections cannot create a second owner. `remote_default`, `~/.redeven`, and the confirmed account home path are one root. The target stores no lifecycle lock, PID lease, daemon, or second state machine. Multiple Desktop instances changing the same physical target concurrently are unsupported. Old Gateway/Runtime state, unknown processes, installation strategy, journal age, and existing quarantine never block wipe reinstall.

A current lightweight maintenance helper is staged once outside `runtime_root`; inventory and best-effort stop reuse that session. Every process whose executable is loaded from the exact Redeven root is owned by that target regardless of historical filename or directory layout; PID, start time, user, namespace, device, and inode still protect every signal from PID reuse. Process-helper, identity, or stop failure does not prevent wipe cleanup. Other processes are not inspected or treated as owners merely because they read files below the root. Wipe first attempts an atomic sibling quarantine; if that exact rename is unavailable it clears only the validated root and creates a fresh one. Every file below the root is Redeven-owned. All operation and older exact-root quarantines are removed only after fresh verification.

The operation does not read, migrate, or call APIs in the quarantined installation. It does not invoke old Gateway APIs, bridge commands, service fallback, broad path deletion, home-directory deletion, container prune, or unregistered volumes. A missing target is a fresh install. Only an unsafe coordinate, unsupported package platform, unavailable direct channel, or real filesystem/command refusal fails an execution step. Logical SSH aliases are resolved over the direct channel instead of compared as local strings. Existing journals and quarantines are takeover inputs rather than blockers. Once wipe isolation starts, the old installation is never restarted.

Each journal phase is idempotent and is written outside the target only after its command reaches the phase commit point. A Desktop crash, duplicate IPC, or SSH result loss resumes the same confirmed operation. Wipe discards a failed fresh root while preserving the original quarantine, stages the current package batch again when necessary, and continues until verification succeeds. Preserve uses one operation-scoped rollback directory for the Gateway, Runtime, and suite manifest. Activation, rollback, and commit cleanup are separate short filesystem actions; only the Desktop journal decides which action runs. A successful preserve rollback returns a retryable result that recommends wipe. Invalid Desktop-owned journal bytes are discarded without touching the target; they do not acquire recovery authority or become a permanent blocker. `manual_recovery_required` is reserved for a direct channel or filesystem state that prevents both continuation and the required cleanup or rollback.

## Gateway separation

Managed Environment records live in Environment Target storage and appear only on the Environments page. Their internal Gateway supervisor is an implementation detail and is never projected into Gateway records or paired from Desktop. Standalone Gateways use `redeven-gateway --mode standalone`, own only their URL endpoint and trust/catalog, and never create Runtime binding, Runtime state, or lifecycle APIs. A Gateway-backed Environment is an access-only Environment reached through its explicit URL `access_endpoint`; it does not expose reinstall or Runtime lifecycle controls.

# Boundaries

Redeven clears the exact Desktop-registered root, including Gateway, Runtime, managed packages, workspaces, projects, application data, Floret/ReDevPlugin data, trust, identity, Catalog, and Environment configuration. It retains only channel credentials, target location, and the temporary journal required to complete or recover the operation. It does not delete upstream databases outside the root or inspect unrelated process file descriptors. User-facing failures keep a structured category for direct-channel, package-batch, filesystem, Gateway-start, and Runtime-readiness failure; raw command, exit status, stderr, and startup files remain folded technical diagnostics.

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
