---
type: Desktop Contract
title: Desktop runtime process lifecycle
description: One Desktop-owned direct Runtime lifecycle for Local, WSL, SSH, and container targets.
tags: [desktop, runtime, lifecycle, coordination, process, inventory, wsl]
timestamp: 2026-08-28T00:00:00Z
---
# Summary

Redeven Desktop is the only product owner of managed Runtime lifecycle. Start, Stop, Restart, Update, Refresh, Open recovery, and Reinstall for Local, WSL-host, SSH-host, local-container, and SSH-container targets enter one process-local `RuntimeLifecycleCoordinator` before creating any Launcher Operation, then use the saved direct channel. The first accepted operation owns the target until terminal; a conflicting request neither preempts nor queues work and returns the current operation identity. Gateway and Provider are access-only; Runtime does not expose a second external lifecycle protocol. A direct-channel or filesystem failure can end an operation, while old Runtime, Gateway, data, process, or renderer state cannot create another owner or fallback path.

# Contract

## Single owner

Every directly managed target has one normalized coordination key made from its host authority, exact container engine/id when present, and normalized Runtime root. Default remote-root spellings resolve to the same target. The coordinator exists only in the current Desktop process and applies one admission rule: the first accepted Open, Start, Stop, Restart, Update, Refresh, or Reinstall continues. An identical request joins the exact same task and operation key. A different request fails immediately with `runtime_lifecycle_in_progress` and the active operation key; it does not preempt, wait, or create a hidden queue. Multiple Desktop processes controlling the same target are unsupported; Desktop writes no remote lifecycle lock, lease, supervisor state, or daemon.

Coordinator ownership is acquired atomically before the Launcher registry projects the accepted operation. An active Runtime Launcher Operation must therefore have exactly one coordinator owner; a Launcher progress record without that owner is invalid. Every accepted execution catches success, failure, and cancellation, writes `succeeded`, `failed`, or `canceled`, and only then releases coordinator ownership. Cancellation targets the current owner only and advances the same operation through `running -> canceling -> canceled` when cleanup completes.

Open is a lifecycle owner and never waits behind Start, Restart, or Update. If Open itself determines that Runtime must start or update, that recovery executes inside the accepted Open task with the same Open operation key and timeline. Product actions such as “update and open” begin this one parent Open operation rather than creating sequential or competing Update and Open operations. Auto Start uses the same coordinator before the Local Environment becomes interactive.

Every direct command receives the coordinator cancellation signal and a bounded command deadline. A lifecycle operation also has an overall deadline; timeout releases the in-process owner after preserving the failure and retry state.

## Direct execution

Lifecycle execution is selected only from the saved Local, WSL, SSH, or container placement. After coordinator admission, the accepted task creates its one Launcher Operation before probing or opening transport, then performs only the steps needed by its intent:

- Start is idempotent when one verified Runtime is already healthy.
- Stop is idempotent when inventory is empty and verifies the stopped result.
- Restart stops the observed Runtime when present, starts the installed Runtime, and verifies readiness.
- Update prepares and verifies the current Runtime package before replacement, starts it even when the previous Runtime was stopped, and verifies the result.
- Refresh performs a fresh direct observation without changing installation or process state.
- Reinstall follows the dedicated direct recovery contract.

Start, Restart, Update, and Reinstall share one successful terminal contract: the installed package is valid, exactly one current Runtime process is running, Runtime Service is openable, and Desktop can access the bridge and Local UI. A process launch or package switch alone is never success. Stop is the only operation that succeeds with no Runtime process; Refresh reports observed state without manufacturing readiness.

The Runtime package contains `redeven` and required Runtime companions only. Runtime package preparation never builds, bundles, installs, starts, or verifies Gateway. Update and Reinstall prepare and verify this archive exactly once before opening a process session or modifying the target. A package preparation failure occurs before a remote target is modified.

## Maintenance helper

Desktop uses the current `redeven` binary as the temporary process tool for exact inventory and best-effort stop. Update and Reinstall extract it from the same already verified Runtime archive that will be installed; they do not build, download, cache, or display a second maintenance component. Start, Stop, and Restart use the installed managed `redeven` and do not prepare a package for inventory. The tool returns typed before/after inventory; it is not resident, stores no lifecycle state, and provides no network API or lock protocol.

Process discovery performs only inventory work. Package build, dependency download, archive preparation, upload, or extraction must appear in the single Runtime-package progress phase and cannot be hidden under process discovery. Preserve Reinstall and Update fail before target replacement when exact inventory or stop cannot be completed. Wipe Reinstall records a process-tool failure and continues only against the user-confirmed exact root. Desktop stops only processes tied to that Runtime root and target namespace; it never scans broadly or prunes a host/container.

WSL-host process behavior uses the same managed-Linux scripts as SSH-host behavior through a different executor. Stop signals only the exact Linux inventory and never terminates the distribution. Desktop exit and Desktop update retire Bridges but do not enter Runtime Stop for WSL targets.

## Capability and presentation

Directly managed Environment menus keep Start, Stop, Restart, Update, Refresh, wipe reinstall, preserve reinstall, and Provider Connect/Disconnect visible regardless of health diagnosis. Diagnosis changes the recommended action, not direct capability. While an operation owns the target, conflicting lifecycle items remain visible but disabled and explain which current operation must finish or be canceled. Provider Connect may be disabled when no Provider is available.

Welcome derives the main button, lifecycle menu, refresh control, progress panel, and cancel control from one `EnvironmentOperationState`. Renderer `busyState` only suppresses duplicate clicks during the short IPC admission interval; it never owns long-running progress. Runtime health remains a separate observation and cannot overwrite operation status. A conflict response focuses the operation key returned by the main process and never creates a second error or progress presentation. Cancel labels describe the parent action, including Open, Runtime Update, and Runtime Restart.

Gateway-only, Provider-only, and URL Environments have no authorized direct process channel. They expose their real Open/Connect/refresh-access functions and no Runtime lifecycle menu or Gateway/Provider management fallback.

# Boundaries

Runtime owns business services, active sessions, and graceful cleanup after a normal process signal. Desktop owns installation and process actions. Maintenance helper performs two temporary low-level operations. Gateway and Provider own access. External systemd, Docker, or Kubernetes automation may be added by users, but it is outside Redeven's lifecycle contract.

# Evidence

- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:1` - One process-local target coordinator.
- `redeven:desktop/src/main/launcherOperations.ts:1` - Accepted-operation projection, terminal states, and action-specific cancellation presentation.
- `redeven:desktop/src/main/runtimeLifecycleExecutionPlan.ts:1` - Ordered direct lifecycle steps by intent and placement.
- `redeven:desktop/src/main/main.ts:1` - Local, SSH, and container action routing into the coordinator.
- `redeven:desktop/src/welcome/launcherBusyState.ts:1` - One derived Environment operation state for Welcome controls and progress.
- `redeven:desktop/src/main/runtimePackageCache.ts:1` - One verified Runtime archive and extraction of its `redeven` process tool.
- `redeven:desktop/src/main/runtimeProcess.ts:1` - Local Runtime inventory and exact stop operations.
- `redeven:desktop/src/main/sshRuntime.ts:1` - Direct SSH Runtime execution and one-operation helper session.
- `redeven:desktop/src/main/managedLinuxRuntime.ts:1` - Shared SSH/WSL managed-Linux package, process, start, and verification contract.
- `redeven:desktop/src/main/runtimePlacementManager.ts:1` - Direct container Runtime execution.
- `redeven:desktop/src/shared/environmentManagementPrinciples.ts:1` - Direct-operation versus access-only Environment boundary.
