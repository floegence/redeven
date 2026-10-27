---
type: Desktop Contract
title: Desktop runtime process lifecycle
description: One Desktop-owned direct Runtime lifecycle for Local, WSL, SSH, and container targets.
tags: [desktop, runtime, lifecycle, coordination, process, inventory, wsl]
timestamp: 2026-10-17T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop owns managed Runtime lifecycle through one process-local `RuntimeLifecycleCoordinator`. Local, WSL, SSH and container Start, Stop, Restart, Update, Refresh, Open recovery and Reinstall use the saved direct channel. The first accepted operation owns its target until terminal; conflicts return that identity without preemption or queuing. Gateway and Provider provide access only. Old process, database or renderer state cannot create another lifecycle owner or fallback.

# Contract

## Ownership
Keys combine host authority, exact container engine/id and normalized Runtime root. Native Local keys use the actual canonical state directory, resolving symlinks without equating parent and child. [Scoped Runtime operations](../ai/tessiven-runtime-operations.md) recheck source/target authority before this coordinator admits a handoff.

## Execution
- Start reuses one verified healthy Runtime. Stop succeeds on empty inventory and verifies termination.
- Restart stops the observed Runtime, starts the installed binary and verifies readiness.
- Update prepares/verifies its package before modification, starts even a previously stopped Runtime and verifies it.
- Refresh observes directly without mutation. Reinstall follows [its recovery contract](desktop-reinstall-operations.md).

The current binary supplies temporary exact inventory and best-effort stop. Builds, downloads, archive preparation, upload and extraction belong to package progress, never process discovery. Desktop exit/update retires WSL Bridges without stopping WSL Runtime.

## Actions
Direct targets retain lifecycle and Provider Connect/Disconnect actions in every diagnosis. Conflicting actions stay visible but disabled, naming the active operation. Access-only targets offer Open/Connect/refresh-access without lifecycle or management fallback.

# Boundaries

Runtime owns business services and proxy sessions. User-supplied systemd, Docker or Kubernetes supervision is outside Desktop coordination.

# Evidence

- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:1` - One process-local target coordinator.

- `redeven:desktop/src/main/runtimeLifecycleExecutionPlan.ts:1` - Ordered direct lifecycle steps by intent and placement.
