---
type: Desktop Contract
title: Desktop runtime process lifecycle
description: Desktop reconciles current and historical managed Runtime processes through a scoped, digest-protected process inventory.
tags: [desktop, runtime, lifecycle, process, inventory]
timestamp: 2026-07-13T00:00:00Z
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
