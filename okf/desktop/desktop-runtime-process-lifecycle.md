---
type: Desktop Contract
title: Desktop runtime process lifecycle
description: One Desktop-owned direct Runtime lifecycle for Local, WSL, SSH, and container targets.
tags: [desktop, runtime, lifecycle, coordination, process, inventory, wsl]
timestamp: 2026-10-17T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven Desktop is the only product owner of managed Runtime lifecycle. Start, Stop, Restart, Update, Refresh, Open recovery, and Reinstall for Local, WSL-host, SSH-host, local-container, and SSH-container targets enter one process-local `RuntimeLifecycleCoordinator` before creating an active Launcher Operation, then use the saved direct channel. The first accepted operation owns the target until terminal; a conflicting request neither preempts nor queues work and returns the current operation identity. Gateway and Provider are access-only; Runtime does not expose a second external lifecycle protocol. A direct-channel or filesystem failure can end an operation, while old Runtime, Gateway, data, process, or renderer state cannot create another owner or fallback path.

# Contract

## Single owner
Every directly managed target has one normalized coordination key made from its host authority, exact container engine/id when present, and normalized Runtime root. Native Local host-process targets instead use the canonical actual state root: resolve absolute paths and symlinks, compare exact directories, and never equate a parent with its child.

Its accepted handoff rechecks source and target authority before entering this same coordinator; [scoped Runtime operations](../ai/tessiven-runtime-operations.md) owns that confirmation boundary.

## Direct execution
Lifecycle execution is selected only from the saved Local, WSL, SSH, or container placement.

- Start is idempotent when one verified Runtime is already healthy. - Stop is idempotent when inventory is empty and verifies the stopped result. - Restart stops the observed Runtime when present, starts the installed Runtime, and verifies readiness. - Update prepares and verifies the current Runtime package before replacement, starts it even when the previous Runtime was stopped, and verifies the result. - Refresh performs a fresh direct observation without changing installation or process state. - Reinstall follows the dedicated direct recovery contract.

A package preparation failure occurs before a remote target is modified.

## Maintenance helper
Desktop uses the current `redeven` binary as the temporary process tool for exact inventory and best-effort stop.

Package build, dependency download, archive preparation, upload, or extraction must appear in the single Runtime-package progress phase and cannot be hidden under process discovery.

Desktop exit and Desktop update retire Bridges but do not enter Runtime Stop for WSL targets.

## Capability and presentation
Directly managed Environment menus keep Start, Stop, Restart, Update, Refresh, wipe reinstall, preserve reinstall, and Provider Connect/Disconnect visible regardless of health diagnosis. While an operation owns the target, conflicting lifecycle items remain visible but disabled and explain which current operation must finish or be canceled.

They expose their real Open/Connect/refresh-access functions and no Runtime lifecycle menu or Gateway/Provider management fallback.

# Boundaries

Runtime manages business services and owns proxy sessions. External systemd, Docker, or Kubernetes automation may be added by users, but it is outside Redeven's lifecycle contract.

# Evidence

- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:1` - One process-local target coordinator.

- `redeven:desktop/src/main/launcherOperations.ts:1` - Accepted-operation projection, terminal states, and action-specific cancellation presentation.

- `redeven:desktop/src/main/runtimeLifecycleExecutionPlan.ts:1` - Ordered direct lifecycle steps by intent and placement.
