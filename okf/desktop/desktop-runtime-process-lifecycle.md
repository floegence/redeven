---
type: Desktop Contract
title: Desktop Runtime coordination and readiness
tags: [desktop, runtime, lifecycle, coordination, process, inventory, wsl]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

One target-bound coordinator admits managed Local, WSL, SSH and container lifecycle work. Verified direct channels and current compatible Presence govern actions; Gateway/Cloud access stays separate. Conflicts retain the first operation and failed observations never prove stopped state or authorize alternate routing.

# Contract

## Process lifecycle
### Ownership
Keys combine host authority, exact container engine/id and normalized Runtime root. Native Local keys use the actual canonical state directory, resolving symlinks without equating parent and child. [Scoped Runtime operations](../ai/tessiven-runtime-operations.md#runtime-operations) recheck source/target authority before this coordinator admits a handoff.

### Execution
- Start reuses one verified healthy Runtime. Stop succeeds on empty inventory and verifies termination.
- Restart stops the observed Runtime, starts the installed binary and verifies readiness.
- Update prepares/verifies its package before modification, starts even a previously stopped Runtime and verifies it.
- Refresh observes directly without mutation. Reinstall follows [its recovery contract](desktop-reinstall-operations.md).

The current binary supplies temporary exact inventory and best-effort stop. Builds, downloads, archive preparation, upload and extraction belong to package progress, never process discovery. Desktop exit/update retires WSL Bridges without stopping WSL Runtime.

### Actions
Direct targets retain lifecycle and Provider Connect/Disconnect actions in every diagnosis. Conflicting actions stay visible but disabled, naming the active operation. Access-only targets offer Open/Connect/refresh-access without lifecycle or management fallback.

## Readiness
### Direct readiness
Native Local Environment is available on macOS/Linux; Windows uses registered WSL Environments. A newly published listener without final status remains pending within the startup deadline. Desktop update warns that Desktop and Local Runtime restart and interrupt Local sessions; Later changes nothing.

WSL, SSH and container observations use the saved channel. Unknown/failed health offers Refresh with its real diagnostic. Pending refresh retains prior diagnosis/startup age but withdraws live Presence; completion replaces it. Main retains credential-free `observed_runtime_control_status` until probe failure or management-configuration change. Gateway failure affects only that route.

A completed probe preserves missing-control diagnostics even when it publishes no Presence. Unknown or unauthenticated status must not become an observed stopped Runtime. Missing diagnostics may guide recovery but never grant live management capability; only current Presence can do so.

Direct lifecycle actions remain available in every diagnosis. Failed nested recovery names the actual operation and retains structured diagnostics; raw stderr appears only in technical details.

### Access and Flower
[Verified access routes](desktop-environment-access.md) owns association/defaults. Gateway directory presence, membership and application probing are distinct; failure never changes routes or starts Runtime recovery.

[Runtime Flower access](../../desktop/src/shared/runtimeFlowerAccess.ts) checks actual protocol/epoch for commands, subscriptions, frames and attachments. Desktop restart does not prove Runtime changed. Welcome admits Flower only with compatible openable Runtime and AI `ready`/`degraded`; transitional states show preparation with a return action, while missing/blocked/unavailable facts cannot admit requests.

## Bridge boundary
- [Process lifecycle](#process-lifecycle) owns coordination and exact-target actions; [readiness](#readiness) owns compatible admission.
- [SSH](desktop-ssh-runtime-operations.md), [WSL](desktop-wsl-runtime-operations.md) and [reinstall](desktop-reinstall-operations.md) define direct execution. [Transport recovery](desktop-transport-recovery.md#transport-recovery) owns bridge generations and disposal.
- [Session/model source](desktop-transport-recovery.md#model-source-sessions) owns target routes, model-process lifetime and session invalidation. Private bridge tokens never move between partitions or attach to public origins.

# Boundaries

Runtime owns business services and proxy sessions. User-supplied systemd, Docker or Kubernetes supervision is outside Desktop coordination.

Only Desktop chooses managed Runtime recovery. Optional platform display fields cannot change readiness or compatibility admission.

Runtime control is Desktop coordination, not a general network API or plugin grant. [ReDevPlugin](../architecture/redevplugin-boundary.md) retains its separate execution and capability boundary.

# Evidence

- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:1` - Source.
- `redeven:desktop/src/main/runtimeLifecycleExecutionPlan.ts:1` - Source.

- `redeven:desktop/src/main/desktopBundle.ts:1` - Source.
- `redeven:desktop/src/main/runtimeProcess.ts:1` - Source.

- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts` - Source.
- `redeven:desktop/src/main/codespaceNativeSession.ts` - Source.
