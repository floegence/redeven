---
type: Desktop Contract
title: Desktop runtime process lifecycle
description: Desktop serializes Runtime lifecycle ownership and reconciles managed processes through a scoped, digest-protected inventory.
tags: [desktop, runtime, lifecycle, coordination, process, inventory]
timestamp: 2026-07-15T00:00:00Z
---

Redeven Desktop governs Local, SSH-hosted, and container-hosted Env Runtime processes through one versioned process inventory. Stop, Restart, and Update do not infer liveness from a saved PID, a current state directory, an in-memory ready record, or a status command exit code. Gateway service processes remain outside this inventory and retain their independent lifecycle.

# Inventory identity

The inventory only considers command lines shaped as `redeven run ... --desktop-managed`. Each candidate is scoped to the current user and, on Linux, the current mount namespace. The stable process identity contains PID, process create time, mount namespace, state root, executable path and device/inode, and Desktop owner id. Linux additionally records deleted executable state. The JSON response exposes only the sanitized scope, process identity fields, runtime version when available, classification, counts, and a SHA-256 `inventory_digest`; it never returns full environment data, secret values, tokens, or raw command lines.

Classification is closed over five values: `current_owned`, `legacy_owned`, `legacy_ownerless`, `foreign_owner`, and `ambiguous`. Automatic stop is allowed only for the first three. A non-empty owner that differs from the requesting Desktop is always `foreign_owner`. An ownerless process is stoppable only when both its executable and state root match an explicit historical Desktop layout. Missing create time, user, namespace, executable inode, or another required identity field produces `ambiguous` and blocks destructive work.

Historical layouts are data, not guesses. They include the current runtime root, released and managed package layouts, Desktop cache and temporary roots, `instances/envinst_*/state`, `local-environment/state`, `local-environment/state/local-environment`, `machine/state`, and `scopes/local/default`. Discovery preserves historical state and databases; lifecycle cleanup removes only verified package staging or session-temporary files after no matching process remains.

# Stop transaction

`desktop-runtime-inventory` returns schema v1 inventory JSON. `desktop-runtime-stop --all-matching` requires the expected digest and returns schema v1 stop JSON. Before any signal, the command re-inventories the scope and rejects a changed digest, blocking classification, PID reuse, changed create time, changed owner, changed namespace, or changed executable inode. A target that exits before the signal set is committed also changes the transaction and causes `runtime_inventory_changed` instead of allowing a partial signal set.

All verified targets receive a graceful interrupt before one shared grace deadline begins. Targets that remain are re-identified before forced termination. The operation succeeds only when a final inventory is empty; a new matching process, a changed identity, or a surviving target is an explicit failure. Desktop stops managed Runtime processes only through this command contract. A startup report PID remains diagnostic and is never sufficient authority for a bare kill.

# Lifecycle ordering

Start and Open are observational. They inventory the target and may reuse one verified current process, but they never terminate a historical, foreign, ambiguous, or duplicate process. Such state becomes a maintenance requirement in Welcome. Explicit Stop, Restart, and Update may reconcile all safely stoppable current and historical processes; any blocking instance prevents all signals.

Restart is version-stable. It verifies that the installed managed package exists before stopping, then starts that installed package. A missing or invalid package requires Update. Update follows a strict transaction: prepare and verify staging, inventory, stop all matching processes, verify empty, activate the staged package, remove obsolete package layouts, start, and verify final identity. Failure before activation leaves the installed package untouched. Failure to stop or verify empty prevents package switching and process start.

SSH and container targets first try the installed runtime's inventory command. If that binary is missing or predates schema v1, Desktop uses a verified runtime asset as a temporary helper in the target user and namespace. An already prepared SSH staging binary may serve as the helper before activation. Helpers perform only inventory and stop, are removed after the operation, and do not select the package used by Restart. Container helper execution stays inside the selected container mount namespace, so the same path in the host or another container is outside the operation scope.

The first stop signal is the cancellation boundary. Before it, package preparation and identity discovery may still be canceled. Once progress reaches `stopping_legacy_runtimes` or `stopping_runtime_process`, Desktop marks the operation non-cancelable and continues through final inventory verification. Welcome presents counts, classification and owner status, PID, state root, and version when available; it does not expose environment variables or raw command lines.

# Lifecycle ownership

One Desktop process owns lifecycle mutation through a `RuntimeLifecycleCoordinator` shared by Local, SSH, container, and managed Gateway paths. The coordinator key is the physical target identity: host authority, process placement, normalized state root, and concrete container id when placement is a container. Local host state roots are resolved filesystem paths. Missing state root, SSH authority, container engine, or container id is rejected; an Environment display name is never an identity fallback.

The coordinator admits `start`, `stop`, `restart`, and `update`. Two requests for the same physical target, intent, and parameter fingerprint share one Promise. A different intent or fingerprint fails immediately with `runtime_lifecycle_in_progress`, includes the active launcher operation key, and is never queued, retried, delayed, or silently converted into another action. Automatic ensure paths wait for an active Start, Restart, or Update to settle and then probe or attach again. They fail immediately while Stop is active, so Flower, Open, Gateway catalog/profile sync, and `start_if_needed` cannot restart a target during shutdown.

The coordinator owns its cancellation signal independently of launcher presentation. User cancellation, target deletion, and Desktop quit request cancellation through the coordinator, including the interval before a launcher progress record exists. Ownership remains active until child processes, SSH or container commands, temporary files, bridges, and inventory reconciliation settle. Once a destructive callback begins closing sessions or releasing a live daemon, the matching launcher attempt becomes non-cancelable before that mutation starts. Deletion and quit cancel only pre-commit work; committed Stop, Restart, or Update work is awaited through completion.

`LauncherOperationRegistry` is a presentation registry, not a mutex. It rejects replacement of an active same-key attempt, and updates, completion, and delayed removal are guarded by action and start-time attempt identity. Local, SSH, container, and Gateway lifecycle progress use the physical target operation key, allowing stale windows to focus the current work without creating parallel action-specific records.

Inventory digest and PID identity checks remain the cross-process safety boundary. A CLI, second Desktop, or another lifecycle authority can still change the process inventory after this Desktop acquired its in-process coordinator. Machine errors with `runtime_inventory_changed` are preserved as typed command failures and presented as `runtime_lifecycle_conflict` with diagnostics. Desktop does not retry that conflict or weaken inventory validation.

# Success conditions

Stop succeeds only with an empty matching inventory. Restart and Update succeed only when the final inventory contains exactly one `current_owned` process whose PID matches the startup report, whose state root, owner, namespace, executable identity, and runtime version match the target, and whose PID/create-time identity differs from the pre-stop process. Local, SSH, and container launchers enforce the same rule.

# Citations

[1] redeven:internal/runtimemanagement/process_inventory.go:23 - Process inventory schema v1 and the closed classification set are defined together.
[2] redeven:internal/runtimemanagement/process_inventory.go:292 - System snapshots collect create time, user, namespace, executable identity, arguments, and Desktop owner id.
[3] redeven:internal/runtimemanagement/process_inventory.go:332 - Only `redeven run` processes carrying `--desktop-managed` enter the inventory.
[4] redeven:internal/runtimemanagement/process_inventory.go:484 - Classification enforces state layout, executable layout, user, namespace, owner, and complete identity boundaries.
[5] redeven:internal/runtimemanagement/process_inventory.go:631 - The stable identity key contains PID, create time, namespace, state root, executable inode identity, and owner.
[6] redeven:internal/runtimemanagement/process_stop.go:152 - Stop validates the expected digest and blocking classifications before signals.
[7] redeven:internal/runtimemanagement/process_stop.go:186 - Every graceful signal is preceded by a fresh identity check.
[8] redeven:internal/runtimemanagement/process_stop.go:205 - Forced termination applies only to remaining targets whose identity still matches.
[9] redeven:cmd/redeven/desktop_runtime_daemon.go:115 - `desktop-runtime-inventory` emits the versioned machine contract.
[10] redeven:cmd/redeven/desktop_runtime_daemon.go:162 - `desktop-runtime-stop --all-matching` requires an expected inventory digest.
[11] redeven:desktop/src/main/runtimeProcess.ts:790 - Local lifecycle discovery, stop, and final identity verification use the inventory contract.
[12] redeven:desktop/src/main/sshRuntime.ts:2940 - SSH prepares package state, reconciles processes, activates staging, starts, and verifies final identity in one flow.
[13] redeven:desktop/src/main/runtimePlacementManager.ts:490 - Container Update prepares the runtime asset before process reconciliation and activates it only after empty verification.
[14] redeven:desktop/src/main/main.ts:9580 - Product lifecycle progress becomes non-cancelable when the core SSH launcher enters the signal phase.
[15] redeven:tests/docker_runtime_e2e/docker_runtime_e2e_test.go:430 - Docker E2E proves container-scoped reconciliation does not terminate a matching process in another namespace.
[16] redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:64 - Physical lifecycle identity requires normalized state root, host authority, placement, and concrete container identity.
[17] redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:153 - Active lifecycle ownership coalesces identical requests and rejects incompatible requests without queuing.
[18] redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:134 - Coordinator cancellation keeps the target owned until the task and its cleanup settle.
[19] redeven:desktop/src/main/launcherOperations.ts:291 - Launcher operation creation rejects replacement of an active same-key attempt.
[20] redeven:desktop/src/main/runtimeProcess.ts:512 - Local startup cancellation enters deterministic child, inventory, and report-directory cleanup.
[21] redeven:desktop/src/main/runtimeProcessInventory.ts:65 - Runtime command JSON errors retain stable machine error codes.
[22] redeven:desktop/src/main/main.ts:2292 - Lifecycle conflicts return the active operation key through structured launcher failure.
[23] redeven:desktop/src/main/main.ts:16399 - Target deletion cancels pre-commit coordinator work and waits for lifecycle ownership to settle.
[24] redeven:desktop/src/main/main.ts:16790 - Desktop quit cancels cancelable lifecycle work and waits for all coordinator tasks.
