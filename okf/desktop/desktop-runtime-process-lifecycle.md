---
type: Desktop Contract
title: Desktop runtime process lifecycle
description: Target-scoped Runtime inventory, lifecycle fencing, and Gateway execution boundaries.
tags: [desktop, runtime, lifecycle, coordination, process, inventory]
timestamp: 2026-08-17T00:00:00Z
quality_exception: Cross-placement Runtime process contract spanning identity, reconciliation, lifecycle ordering, and Gateway delegation.
---
# Summary

Desktop discovers Runtime process facts and initiates user-facing operations, but it does not own Runtime lifecycle state. Every product-managed start, stop, restart, or update is authorized and executed by the target OS user's Gateway supervisor. Desktop uses `lifecycle_target_id` plus `target_generation` and attaches to the durable Gateway operation from any authorized client.

# Contract

## Identity and inventory

The Runtime inventory records PID/create time, user, namespace, state root, executable identity, Runtime version, workload identities, snapshot revision, and an inventory digest. Missing, malformed, stale, or incompatible inventory is `unknown`; it is never coerced to zero. Target identity is stable across Desktop clients and transport changes. A changed OS principal, container instance, or installation root creates a new target id; a supervisor key rotation advances generation under the same target lock.

## Operation ordering

Desktop performs support, authorization, readiness, target, generation, compatibility, and artifact-policy checks before invoking a builder or uploader. The Gateway `prepare` response creates or attaches to one durable operation. User confirmation precedes artifact staging. Commit acquires the Runtime lifecycle fence, compares the exact confirmed workload identity set, atomically replaces the artifact, checks health, and records recovery. Identity replacement, added risk, or `known -> unknown` requires `confirmation_required`. A conflicting operation returns `operation_in_progress`; it is never queued or forcefully taken over.

Desktop closes an attached Env App session only after a destructive operation is accepted by the shared coordinator. A transport disconnect does not cancel a Gateway operation; reopening the card attaches to its redacted progress. Connect, Workspace, terminal, files, and web sessions remain separate from the lifecycle operation store.

# Boundaries

External shell, systemd, launchd, or container-entrypoint maintenance is outside Redeven lifecycle authority and produces no operation, permit, target lock, fence, rollback, or recovery guarantee. When Gateway is later enabled, it revalidates Runtime identity, service protocol, epoch, capabilities, and digest before allowing lifecycle management. Desktop owner ids, takeover confirmation, and ownership mismatch are not Runtime concepts.

# Evidence

- `redeven:internal/runtimemanagement/process_inventory.go:1` - Target-scoped process inventory and digest validation.
- `redeven:internal/runtimegateway/protocol/lifecycle_v2.go:283` - Prepare and exact workload confirmation contracts.
- `redeven:internal/gatewayservice/server.go:188` - Gateway operation authorization and target checks.
- `redeven:desktop/src/shared/desktopRuntimeOperationPlanner.ts:1` - Desktop preflight and operation projection.
- `redeven:desktop/src/main/sshRuntime.ts:1` - SSH placement delegates lifecycle execution to the Gateway boundary.
