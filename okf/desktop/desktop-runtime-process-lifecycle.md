---
type: Desktop Contract
title: Desktop runtime process lifecycle
description: Desktop serializes Runtime lifecycle ownership and reconciles managed processes through a scoped, digest-protected inventory.
tags: [desktop, runtime, lifecycle, coordination, process, inventory]
timestamp: 2026-07-16T00:00:00Z
---

Redeven Desktop governs Local, SSH-hosted, and container-hosted Env Runtime processes through one process inventory contract. Stop, Restart, and Update do not infer liveness from a saved PID, a current state directory, an in-memory ready record, or a status command exit code. Gateway service processes remain outside this inventory and retain their independent lifecycle.

# Inventory identity

The inventory only considers command lines shaped as `redeven run ... --desktop-managed`. Each candidate is scoped to the current user and, on Linux, the current mount namespace. The stable process identity contains PID, process create time, mount namespace, state root, executable path and device/inode, and Desktop owner id. Linux additionally records deleted executable state. The JSON response exposes only the sanitized scope, process identity fields, runtime version when available, orthogonal authority fields, counts, and a SHA-256 `inventory_digest`; it never returns full environment data, secret values, tokens, or raw command lines.

Schema 2 is the only process contract. Its inventory, scope, summary, stop result, and process instance objects accept only their declared fields. Each instance contains `identity_status`, `owner_status`, `layout_status`, `owner_evidence`, and `stop_authority`. `owner_evidence` records only whether owner identity came from the process environment, the current Runtime lock, or was unavailable; it never exposes the full environment or an owner id in a user-facing takeover proposal.

The contract has exactly three stop authorities. `automatic` covers a verified current-layout process owned by this Desktop. `confirmed_takeover` covers a process whose core OS identity and current managed layout are complete but whose owner evidence is missing or belongs to another Desktop. `blocked` covers any incomplete PID/create-time, user, namespace, state-root, executable path, device/inode, or current-layout evidence. Owner confirmation never promotes `blocked` authority and never relaxes process identity verification.

Only the configured state root and current managed executable layout are eligible. A matching Desktop-managed process under the target state root with an unexpected executable layout remains visible as `blocked`; it is never ignored or reclassified through historical path rules.

# Stop transaction

`desktop-runtime-inventory` always returns schema 2. `desktop-runtime-stop --all-matching` requires the expected digest. Its `--reconciliation-mode` is `automatic` by default, while `confirmed_takeover` is valid only with `--all-matching` and `--expected-inventory-digest`. There is no contract-version flag or legacy-layout option.

Before any signal, Stop re-inventories the whole scope and rejects a changed digest, any `blocked` instance, PID reuse, changed create time, changed user, changed state root, changed owner, changed namespace, or changed executable device/inode. Automatic mode also rejects any `confirmed_takeover` instance with `runtime_takeover_confirmation_required`. Confirmed takeover includes both automatic and confirmed-takeover targets in one transaction, but one blocked instance prevents signals to every target. A target that exits before the signal set is committed also changes the transaction and causes `runtime_inventory_changed` instead of allowing a partial signal set.

After every target passes fresh process-identity verification and before the signal set is committed, Stop captures the original bytes of the current `stateRoot/local-environment/agent.lock` only when its structured JSON metadata names a verified target. That snapshot defines the lease-cleanup ownership boundary for the transaction. Other paths and raw-PID lock content are not compatibility inputs. Stop does not perform a global stale-lock sweep or infer ownership from a lock path alone.

All verified targets receive a graceful interrupt before one shared grace deadline begins. Targets that remain are re-identified before forced termination. Once a target exits, an already empty captured lease is complete and an unchanged captured lease can be safely retired. A captured lease whose PID, instance identity, or original content changed causes `runtime_inventory_changed`; changed malformed content causes `runtime_lock_cleanup_failed`. The final process inventory is inspected even when lease cleanup fails, and a new live Runtime takes precedence as `runtime_inventory_changed`. The operation succeeds only when the final inventory is empty and every captured lease is settled. Desktop stops managed Runtime processes only through this command contract. A startup report PID remains diagnostic and is never sufficient authority for a bare kill.

# Lifecycle ordering

Start and Open are observational. They inventory the target and may reuse one verified current-owner process, but they never terminate a foreign-owner, missing-owner, duplicate, blocked, or takeover-eligible process. Local health inspection also inventories processes when lease and Runtime status cannot attach, so a live ownerless or foreign process remains a managed maintenance state instead of appearing stopped. A verified missing-owner or foreign-owner process becomes `runtime_process_takeover_required` maintenance rather than a startup failure. If a takeover-eligible process appears after Start's initial observation but before its final inventory, Desktop finishes the launcher attempt as terminal `needs_confirmation`, stores the maintenance in Runtime Presence, and returns the successful `runtime_maintenance_required` outcome without opening the destructive Dialog or sending a signal. A hard-blocked identity remains non-forceable. Explicit Stop, Restart, and Update without a matching confirmation return the existing structured `confirmation_required` outcome before sessions close, packages switch, or signals are sent.

Welcome receives a sanitized `DesktopRuntimeProcessTakeoverProposal` containing the operation, physical location, inventory digest, process count, PID/create-time identities, owner status and evidence source, state root, Runtime version, and reason. It lists every process that the confirmed transaction will stop, including automatic current-owner instances in a mixed inventory. It does not contain a raw owner id, environment data, token, command line, or executable path. The destructive Dialog focuses Cancel first, explains possible active-work loss, and submits only the server-provided continuation with `runtime_process_reconciliation: { mode: 'confirmed_takeover', expected_inventory_digest }`. IPC accepts that reconciliation object only for Stop, Restart, and Update. Cancel leaves the existing process running and keeps a maintenance entry. A changed inventory produces a fresh proposal and requires another review; prior confirmation is never reused.

Restart is version-stable. It verifies that the installed managed package exists before stopping, then starts that installed package. A missing or invalid package requires Update. Update follows a strict transaction: prepare and verify staging, inventory, stop all matching processes, verify empty, activate the staged package, start, and verify final identity. Failure before activation leaves the installed package untouched. Failure to stop or verify empty prevents package switching and process start.

SSH and container targets use the verified current Desktop Runtime asset as the sole temporary process helper in the target user and namespace. Desktop does not probe the installed Runtime for an older process contract and does not fall back between protocol implementations. The helper performs only inventory and stop, is removed after the operation, and does not select the package used by Restart. Container helper execution stays inside the selected container mount namespace, so the same path in the host or another container is outside the operation scope. SSH `auto` bootstrap deterministically uses Desktop upload; remote installation occurs only when the target explicitly selects `remote_install`.

The first committed destructive callback is the cancellation boundary. Before it, package preparation, identity discovery, and user confirmation may still be canceled. Once Desktop closes sessions for an authorized Stop/Restart/Update or reaches `stopping_runtime_process`, it marks the operation non-cancelable and continues through final inventory verification. `needs_confirmation` is a terminal launcher status, not a failure and not active lifecycle ownership, so the coordinator is released while the user decides.

# Lifecycle ownership

One Desktop process owns lifecycle mutation through a `RuntimeLifecycleCoordinator` shared by Local, SSH, container, and managed Gateway paths. The coordinator key is the physical target identity: host authority, process placement, normalized state root, and concrete container id when placement is a container. Local host state roots are resolved filesystem paths. Missing state root, SSH authority, container engine, or container id is rejected; an Environment display name is never an identity fallback.

The coordinator admits `start`, `stop`, `restart`, and `update`. Two requests for the same physical target, intent, and parameter fingerprint share one Promise. A different intent or fingerprint fails immediately with `runtime_lifecycle_in_progress`, includes the active launcher operation key, and is never queued, retried, delayed, or silently converted into another action. Automatic ensure paths wait for an active Start, Restart, or Update to settle and then probe or attach again. They fail immediately while Stop is active, so Flower, Open, Gateway catalog/profile sync, and `start_if_needed` cannot restart a target during shutdown.

The coordinator owns its cancellation signal independently of launcher presentation. User cancellation, target deletion, and Desktop quit request cancellation through the coordinator, including the interval before a launcher progress record exists. Ownership remains active until child processes, SSH or container commands, temporary files, bridges, and inventory reconciliation settle. Once a destructive callback begins closing sessions or releasing a live daemon, the matching launcher attempt becomes non-cancelable before that mutation starts. Deletion and quit cancel only pre-commit work; committed Stop, Restart, or Update work is awaited through completion.

`LauncherOperationRegistry` is a presentation registry, not a mutex. It rejects replacement of an active same-key attempt, and updates, completion, and delayed removal are guarded by action and start-time attempt identity. Local, SSH, container, and Gateway lifecycle progress use the physical target operation key, allowing stale windows to focus the current work without creating parallel action-specific records.

Inventory digest and PID identity checks remain the cross-process safety boundary. A CLI, second Desktop, or another lifecycle authority can still change the process inventory after this Desktop acquired its in-process coordinator. Machine errors with `runtime_inventory_changed` are preserved as typed command failures and presented as `runtime_lifecycle_conflict` with diagnostics. A changed inventory during confirmed takeover is instead surfaced as a fresh confirmation proposal. Desktop does not retry either outcome or weaken inventory validation.

Lifecycle diagnostics record `takeover_required`, `takeover_confirmed`, `takeover_canceled`, and `takeover_inventory_changed` with operation, placement, target id, and process count. They do not record owner ids, process environments, tokens, or other secret material.

# Success conditions

Stop succeeds only with an empty matching inventory. Restart and Update succeed only when the final inventory contains exactly one process with verified identity, current owner, current layout, and `automatic` authority whose PID matches the startup report, whose state root, namespace, executable identity, and runtime version match the target, and whose PID/create-time identity differs from the pre-stop process. Local, SSH, and container launchers enforce the same rule.

# Citations

[1] redeven:internal/runtimemanagement/process_inventory.go:23 - Process inventory schema 2 and the orthogonal process authority fields are defined together.
[2] redeven:internal/runtimemanagement/process_inventory.go:292 - System snapshots collect create time, user, namespace, executable identity, arguments, and Desktop owner id.
[3] redeven:internal/runtimemanagement/process_inventory.go:332 - Only `redeven run` processes carrying `--desktop-managed` enter the inventory.
[4] redeven:internal/runtimemanagement/process_inventory.go:527 - Lock metadata may supply owner evidence without weakening the process identity.
[5] redeven:internal/runtimemanagement/process_inventory.go:443 - Inventory derives identity, owner, layout, evidence, and stop authority independently.
[6] redeven:internal/runtimemanagement/process_stop.go:175 - Stop validates digest, reconciliation mode, blocked instances, and takeover authority before signals.
[7] redeven:internal/runtimemanagement/process_stop.go:253 - Every target passes a fresh identity check before the graceful signal set is committed.
[8] redeven:internal/runtimemanagement/process_stop.go:284 - Forced termination applies only to remaining targets whose identity still matches.
[9] redeven:cmd/redeven/desktop_runtime_daemon.go:112 - `desktop-runtime-inventory` exposes the single current process contract.
[10] redeven:cmd/redeven/desktop_runtime_daemon.go:154 - Confirmed takeover requires all-matching and an expected inventory digest.
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
[21] redeven:desktop/src/main/runtimeProcessInventory.ts:230 - The shared Desktop planner separates hard identity blocks from digest-bound takeover confirmation.
[22] redeven:desktop/src/main/main.ts:2292 - Lifecycle conflicts return the active operation key through structured launcher failure.
[23] redeven:desktop/src/main/main.ts:16399 - Target deletion cancels pre-commit coordinator work and waits for lifecycle ownership to settle.
[24] redeven:desktop/src/main/main.ts:16790 - Desktop quit cancels cancelable lifecycle work and waits for all coordinator tasks.
[25] redeven:internal/runtimemanagement/process_stop.go:353 - Stop captures and later retires only lock leases that identify a verified target PID.
[26] redeven:desktop/src/shared/desktopRuntimePresence.ts:89 - Runtime Presence remains the sole renderer-facing source of management capability.
[27] redeven:desktop/src/shared/desktopLauncherIPC.ts:79 - `needs_confirmation` is a terminal launcher operation status.
[28] redeven:desktop/src/welcome/App.tsx:6400 - Welcome renders the sanitized, destructive takeover confirmation and sends only the digest-bound continuation.
