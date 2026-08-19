---
type: Desktop Contract
title: Desktop runtime process lifecycle
description: Target-scoped Runtime inventory, lifecycle fencing, and Gateway execution boundaries.
tags: [desktop, runtime, lifecycle, coordination, process, inventory]
timestamp: 2026-08-19T00:00:00Z
quality_exception: Cross-placement Runtime process contract spanning identity, reconciliation, lifecycle ordering, and Gateway delegation.
---
# Summary

Desktop validates and starts its packaged environment services, but it does not own Runtime lifecycle state. Every product-managed start, stop, restart, or update is authorized and executed by the target OS user's Gateway supervisor. Desktop uses `lifecycle_target_id` plus `target_generation` and attaches to the durable Gateway operation from any authorized client. A missing, damaged, incompatible, or incorrectly targeted packaged service fails during Desktop startup, before an Environment Open action can depend on it.

# Contract

## Identity and inventory

The Runtime inventory records PID/create time, user, namespace, state root, executable identity, Runtime version, workload identities, snapshot revision, and an inventory digest. Missing, malformed, stale, or incompatible inventory is `unknown`; it is never coerced to zero. Target identity is stable across Desktop clients and transport changes. A changed OS principal, container instance, or installation root creates a new target id; a supervisor key rotation advances generation under the same target lock.

## Packaged Desktop startup

Desktop distributions contain a precompiled Gateway, Runtime suite, and one manifest bound to the product version, commit, platform, architecture, file size, executable mode, and SHA-256 digest. Desktop validates the exact manifest inventory before starting its managed Gateway. The Gateway supervisor then provisions the verified Runtime suite into the managed slot and starts it through the same fenced process controller used by later lifecycle operations. Desktop does not spawn Runtime through a second authority.

Normal Desktop startup and Environment Open never copy source, build assets, compile Runtime, upload an artifact, or create `update_runtime`. A configured source root is consulted only after the user explicitly selects Update and the Gateway operation reaches `awaiting_artifact`. If a target lock already identifies a durable non-terminal operation, packaged startup leaves that lock and operation intact so Desktop can reattach instead of creating a duplicate operation.

After a successful explicit update, a Gateway restart may accept a managed slot that differs from the packaged bundle only when the persisted validation matches the Runtime executable digest, platform, architecture, version, and a canonical digest of the complete managed suite inventory. Missing, additional, symlinked, non-regular, permission-changed, or byte-changed suite entries fail closed. The packaged bundle itself always requires its exact declared inventory.

## Operation ordering

For an explicit update, Desktop performs support, authorization, readiness, target, generation, compatibility, and artifact-policy checks before invoking a builder or uploader. The Gateway `prepare` response creates or attaches to one durable operation. User confirmation precedes artifact staging. Commit acquires the Runtime lifecycle fence, compares the exact confirmed workload identity set, atomically replaces the artifact, checks health, and records recovery. Identity replacement, added risk, or `known -> unknown` requires `confirmation_required`. A conflicting operation returns `operation_in_progress`; it is never queued or forcefully taken over.

The Gateway Runtime operation store uses contiguous schema migrations. Schema v2 records with nanosecond-era `snapshot_revision` values that cannot round-trip through Desktop JavaScript are migrated atomically to schema v3 using the same snapshot's bounded observation timestamp, preserving operation authority, target locks, artifacts, and events. Current and newly observed snapshots outside the JSON-safe integer range fail closed before they can be persisted or committed; a failed migration leaves the original file unchanged.

Desktop closes an attached Env App session only after a destructive operation is accepted by the shared coordinator. A transport disconnect does not cancel a Gateway operation; reopening either a direct or Provider card queries the exact target and attaches to active Gateway progress. Only the original operation client can resume confirmation, artifact upload, or commit. Another authorized manager receives redacted progress, while a current binding administrator may start the separate permit-bound reconcile action for quarantine. Connect, Workspace, terminal, files, and web sessions remain separate from the lifecycle operation store.

Provider cards use a Provider-scoped management client key and their own protected management tunnel. The bound Gateway, not the Runtime Agent, maintains that reverse transport, so stopping Runtime does not remove the supervisor management route. Provider cards never ask the user to select another Gateway card and never read its paired key or transport. Direct cards use their own explicit setup flow to install/enroll the target supervisor. Local and SSH host-process bootstrap select the published Linux or Darwin package for the observed CPU architecture; container bootstrap remains Linux-only. Access-only URL cards remain unsupported for managed lifecycle. The planner first projects support, then authorization, then readiness, and does not mark an action available until that route can execute it.

The product smoke launches real Electron with an isolated user-data and state root, validates the packaged bundle, and observes automatic Local Gateway, Runtime, bridge, and Workspace readiness before the first click. It enters Gateway only through `desktop-bridge`, completes the signed pairing chain, and validates capability target/generation, compatibility epoch, Runtime PID, identity, version, executable digest, and phase timing. Normal cold startup and direct Open assert that no source copy, build script, `update_runtime`, `awaiting_artifact`, staging file, or artifact upload occurred. Restart and explicit custom-build update traverse prepare, confirmation, artifact staging where required, commit, and succeeded states against the real Runtime process. Pending confirmation and verified updated suites survive Desktop and Gateway restart without duplicate operations.

The macOS smoke exercises Local and a real temporary sshd/SSH Remote Environment through direct Open, stop, start-and-open, restart, cold and warm explicit update, reopen, and Desktop restart. The Docker E2E provides real Linux Local precompiled startup and restart recovery plus real Linux Local and sshd Remote lifecycle, signed bridge authorization, negative digest/lock/confirmation cases, and operation/event persistence. Tests do not use `serve`, pairing-code shortcuts, fake controllers, direct Runtime replacement, or legacy stamp writes as lifecycle evidence.

# Boundaries

External shell, systemd, launchd, or container-entrypoint maintenance is outside Redeven lifecycle authority and produces no operation, permit, target lock, fence, rollback, or recovery guarantee. When Gateway is later enabled, it revalidates Runtime identity, service protocol, epoch, capabilities, and digest before allowing lifecycle management. Desktop owner ids, takeover confirmation, and ownership mismatch are not Runtime concepts.

# Evidence

- `redeven:internal/runtimemanagement/process_inventory.go:1` - Target-scoped process inventory and digest validation.
- `redeven:internal/runtimegateway/protocol/lifecycle_v2.go:283` - Prepare and exact workload confirmation contracts.
- `redeven:internal/gatewayservice/server.go:188` - Gateway operation authorization and target checks.
- `redeven:desktop/src/shared/desktopRuntimeOperationPlanner.ts:1` - Desktop preflight and operation projection.
- `redeven:desktop/src/main/sshRuntime.ts:1` - SSH placement delegates lifecycle execution to the Gateway boundary.
- `redeven:desktop/src/main/runtimeLifecycleAttachment.ts:1` - Cross-client confirmation, redacted observation, resume, and recovery projection.
- `redeven:desktop/src/main/desktopBundle.ts:1` - Strict packaged Gateway and Runtime manifest validation before Desktop startup.
- `redeven:internal/runtimegateway/supervisor/precompiled.go:1` - Gateway-owned precompiled provisioning, startup, suite validation, and recovery.
- `redeven:desktop/src/main/providerRuntimeLifecycleClient.ts:1` - Provider-scoped signed lifecycle tunnel without Gateway-card credential borrowing.
- `redeven:scripts/build_desktop_bundled_runtime.sh:1` - Target-specific precompiled bundle assembly and manifest generation.
- `redeven:desktop/src/main/sshReleaseAssets.test.ts:1` - Linux and Darwin host-process SSH targets select published Runtime and Gateway packages.
- `redeven:scripts/smoke_desktop_runtime_lifecycle.mjs:1` - Real Desktop Local and SSH Remote lifecycle and workspace-open matrix.
- `redeven:tests/docker_runtime_e2e/gateway_lifecycle_smoke_test.go:1` - Real service, Desktop bridge, signed lifecycle, persistence, and negative smoke.
