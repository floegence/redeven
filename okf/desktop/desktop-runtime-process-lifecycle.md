---
type: Desktop Contract
title: Desktop runtime process lifecycle
description: One Desktop-owned direct Runtime lifecycle for Local, SSH, and container targets.
tags: [desktop, runtime, lifecycle, coordination, process, inventory]
timestamp: 2026-08-24T00:00:00Z
---
# Summary

Redeven Desktop is the only product owner of managed Runtime lifecycle. Start, Stop, Restart, Update, Refresh, Open recovery, and Reinstall for Local, SSH-host, local-container, and SSH-container targets enter one process-local `RuntimeLifecycleCoordinator` and execute through the saved direct channel. Gateway and Provider are access-only; Runtime does not expose a second external lifecycle protocol. A direct-channel or filesystem failure can end an operation, while old Runtime, Gateway, data, or process state cannot create another owner or fallback path.

# Contract

## Single owner

Every directly managed target has one normalized coordination key made from its host authority, exact container engine/id when present, and normalized Runtime root. Default remote-root spellings resolve to the same target. The coordinator exists only in the current Desktop process, deduplicates an identical in-flight action, and rejects a conflicting action with the active Launcher Operation. Multiple Desktop processes controlling the same target are unsupported; Desktop writes no remote lifecycle lock, lease, supervisor state, or daemon.

Open waits for an in-flight Start, Restart, or Update and consumes that operation's committed readiness result. Auto Start uses the same coordinator before the Local Environment becomes interactive. Renderer state displays the main-process Launcher Operation and never creates a second progress or lifecycle owner.

## Direct execution

Lifecycle execution is selected only from the saved Local, SSH, or container placement. Each operation creates its Launcher Operation before probing or opening transport, then performs only the steps needed by its intent:

- Start is idempotent when one verified Runtime is already healthy.
- Stop is idempotent when inventory is empty and verifies the stopped result.
- Restart stops the observed Runtime when present, starts the installed Runtime, and verifies readiness.
- Update prepares and verifies the current Runtime package before replacement, restores the prior running/stopped intent, and verifies the result.
- Refresh performs a fresh direct observation without changing installation or process state.
- Reinstall follows the dedicated direct recovery contract.

The Runtime package contains `redeven` and required Runtime companions only. Runtime package preparation never builds, bundles, installs, starts, or verifies Gateway. A package preparation failure occurs before a remote target is modified.

## Maintenance helper

Desktop may use the current `redeven` binary as a temporary maintenance helper for exact inventory and best-effort stop. One operation prepares and stages it at most once and reuses the same direct transport and platform observation. The helper returns typed before/after inventory; it is not resident, stores no lifecycle state, and provides no network API or lock protocol.

Process discovery performs only inventory work. Package build, dependency download, archive preparation, upload, or extraction must appear in their own progress phase and cannot be hidden under process discovery. Desktop stops only processes tied to the confirmed Runtime root and target namespace; it never scans broadly or prunes a host/container.

## Capability and presentation

Directly managed Environment menus keep Start, Stop, Restart, Update, Refresh, wipe reinstall, preserve reinstall, and Provider Connect/Disconnect available regardless of health diagnosis. Diagnosis changes the recommended action, not direct capability. Provider Connect may be disabled when no Provider is available; lifecycle actions remain clickable and idempotent.

Gateway-only, Provider-only, and URL Environments have no authorized direct process channel. They expose their real Open/Connect/refresh-access functions and no Runtime lifecycle menu or Gateway/Provider management fallback.

# Boundaries

Runtime owns business services, active sessions, and graceful cleanup after a normal process signal. Desktop owns installation and process actions. Maintenance helper performs two temporary low-level operations. Gateway and Provider own access. External systemd, Docker, or Kubernetes automation may be added by users, but it is outside Redeven's lifecycle contract.

# Evidence

- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:1` - One process-local target coordinator.
- `redeven:desktop/src/main/runtimeLifecycleExecutionPlan.ts:1` - Ordered direct lifecycle steps by intent and placement.
- `redeven:desktop/src/main/main.ts:1` - Local, SSH, and container action routing into the coordinator.
- `redeven:desktop/src/main/runtimePackageCache.ts:1` - Runtime package and temporary helper preparation.
- `redeven:desktop/src/main/runtimeProcess.ts:1` - Local Runtime inventory and exact stop operations.
- `redeven:desktop/src/main/sshRuntime.ts:1` - Direct SSH Runtime execution and one-operation helper session.
- `redeven:desktop/src/main/runtimePlacementManager.ts:1` - Direct container Runtime execution.
- `redeven:desktop/src/shared/environmentManagementPrinciples.ts:1` - Direct-operation versus access-only Environment boundary.
