---
type: Desktop Contract
title: Desktop runtime process lifecycle
description: Target-scoped Runtime inventory, lifecycle fencing, and Gateway execution boundaries.
tags: [desktop, runtime, lifecycle, coordination, process, inventory]
timestamp: 2026-08-18T00:00:00Z
quality_exception: Cross-placement Runtime process contract spanning identity, reconciliation, lifecycle ordering, and Gateway delegation.
---
# Summary

Desktop discovers Runtime process facts and initiates user-facing operations, but it does not own Runtime lifecycle state. Every product-managed start, stop, restart, or update is authorized and executed by the target OS user's Gateway supervisor. Desktop uses `lifecycle_target_id` plus `target_generation` and attaches to the durable Gateway operation from any authorized client.

# Contract

## Identity and inventory

The Runtime inventory records PID/create time, user, namespace, state root, executable identity, Runtime version, workload identities, snapshot revision, and an inventory digest. Missing, malformed, stale, or incompatible inventory is `unknown`; it is never coerced to zero. Target identity is stable across Desktop clients and transport changes. A changed OS principal, container instance, or installation root creates a new target id; a supervisor key rotation advances generation under the same target lock.

## Operation ordering

Desktop performs support, authorization, readiness, target, generation, compatibility, and artifact-policy checks before invoking a builder or uploader. The Gateway `prepare` response creates or attaches to one durable operation. User confirmation precedes artifact staging. Commit acquires the Runtime lifecycle fence, compares the exact confirmed workload identity set, atomically replaces the artifact, checks health, and records recovery. Identity replacement, added risk, or `known -> unknown` requires `confirmation_required`. A conflicting operation returns `operation_in_progress`; it is never queued or forcefully taken over.

Desktop closes an attached Env App session only after a destructive operation is accepted by the shared coordinator. A transport disconnect does not cancel a Gateway operation; reopening either a direct or Provider card queries the exact target and attaches to active Gateway progress. Only the original operation client can resume confirmation, artifact upload, or commit. Another authorized manager receives redacted progress, while a current binding administrator may start the separate permit-bound reconcile action for quarantine. Connect, Workspace, terminal, files, and web sessions remain separate from the lifecycle operation store.

Provider cards use a Provider-scoped management client key and their own protected management tunnel. The bound Gateway, not the Runtime Agent, maintains that reverse transport, so stopping Runtime does not remove the supervisor management route. Provider cards never ask the user to select another Gateway card and never read its paired key or transport. Direct cards use their own explicit setup flow to install/enroll the target supervisor; a local-host Gateway package is selected for the actual Linux or Darwin host and CPU architecture, while SSH and container bootstrap remain Linux-only. Access-only URL cards remain unsupported for managed lifecycle. The planner first projects support, then authorization, then readiness, and does not mark an action available until that route can execute it.

The product smoke starts the real Runtime without Gateway and verifies ordinary ping and Desktop bridge access first. It then starts the real `redeven-gateway` service, enters only through `desktop-bridge`, completes the signed Gateway protocol pairing chain, and validates capability target/generation, compatibility epoch, Runtime identity, version, and executable digest. Restart and custom-build update traverse prepare, confirmation, artifact staging where required, commit, and succeeded states against the real Runtime process. Operation and event history must survive a Gateway service restart. Commit-before-confirmation, same-target lock conflict, and executable-digest tampering fail closed. Tests do not use `serve`, pairing-code shortcuts, fake controllers, direct Runtime replacement, or legacy stamp writes as lifecycle evidence.

# Boundaries

External shell, systemd, launchd, or container-entrypoint maintenance is outside Redeven lifecycle authority and produces no operation, permit, target lock, fence, rollback, or recovery guarantee. When Gateway is later enabled, it revalidates Runtime identity, service protocol, epoch, capabilities, and digest before allowing lifecycle management. Desktop owner ids, takeover confirmation, and ownership mismatch are not Runtime concepts.

# Evidence

- `redeven:internal/runtimemanagement/process_inventory.go:1` - Target-scoped process inventory and digest validation.
- `redeven:internal/runtimegateway/protocol/lifecycle_v2.go:283` - Prepare and exact workload confirmation contracts.
- `redeven:internal/gatewayservice/server.go:188` - Gateway operation authorization and target checks.
- `redeven:desktop/src/shared/desktopRuntimeOperationPlanner.ts:1` - Desktop preflight and operation projection.
- `redeven:desktop/src/main/sshRuntime.ts:1` - SSH placement delegates lifecycle execution to the Gateway boundary.
- `redeven:desktop/src/main/runtimeLifecycleAttachment.ts:1` - Cross-client confirmation, redacted observation, resume, and recovery projection.
- `redeven:desktop/src/main/providerRuntimeLifecycleClient.ts:1` - Provider-scoped signed lifecycle tunnel without Gateway-card credential borrowing.
- `redeven:desktop/src/main/gatewayServiceHost.test.ts:1` - Local-host platform selection permits published Darwin Gateway packages without widening the SSH platform boundary.
- `redeven:tests/docker_runtime_e2e/gateway_lifecycle_smoke_test.go:1` - Real service, Desktop bridge, signed lifecycle, persistence, and negative smoke.
