---
type: Desktop Contract
title: Desktop managed Environment reinstall
description: Runtime-only direct-channel reinstall with minimal Desktop recovery journal.
tags: [desktop, reinstall, runtime, ssh, containers]
timestamp: 2026-08-24T00:00:00Z
---
# Summary

Wipe-data reinstall is Desktop's final recovery path for a broken managed Redeven Runtime. After the user confirms the exact Local, SSH, or container target and Runtime root, Desktop prepares a verified Runtime-only package, attempts to stop old Redeven processes, replaces the exact root, starts and verifies the fresh Runtime, and cleans retained old data. Gateway, old Runtime health, old databases, unknown process state, previous journals, and quarantine content cannot reject the operation before a direct filesystem action is attempted. Preserve-data reinstall is a convenience path and rolls back its managed-file replacement when fresh verification fails.

# Contract

## Confirmation and prerequisites

Preview is local and non-destructive. It shows one short risk statement, with host, container, root, affected registrations, and process details collapsed. Confirmation binds the saved host/user/port, exact container engine/id when present, normalized Runtime root, mode, and operation identity.

Execution has four prerequisites only: the confirmed direct channel opens, the target resolves to the confirmed exact root, the current Desktop can prepare and verify a Runtime package for the target platform, and the filesystem permits the required exact-root operations. Gateway availability, Runtime protocol, schema, trust, token, old process identity, or old directory contents are not prerequisites.

After confirmation, Desktop commits `direct_channel_open` to the journal before opening the executor or issuing a target command. Direct host commands are bounded (30 seconds for checks and filesystem actions, 10 minutes for package transfer), and the whole reinstall has a 15-minute deadline. Timeout and cancellation preserve the journal and command diagnostics for retry.

## Runtime-only sequence

The authoritative progress order is:

```text
confirmation
-> direct_channel_open
-> target_resolved
-> package_batch_prepared_and_verified
-> redeven_process_stop_attempted
-> old_root_isolated_or_cleared
-> runtime_installed
-> runtime_started
-> runtime_verified
-> catalog_and_local_ui_verified
-> old_data_cleaned
-> completed
```

Package preparation completes before target disruption and contains Runtime plus its required companions, never Gateway. `package_batch_prepared_and_verified` remains the persisted phase name for journal compatibility; there is one Runtime package and no multi-component batch owner. Reinstall installs the same standard `runtime/managed` slot recognized by Start, Restart, Update, and Refresh, including `redeven`, verified ReDevPlugin companions, and `managed-runtime.stamp`. Helper preparation and package preparation may run together, but the helper is optional for wipe recovery: inventory or stop failure is recorded and replacement proceeds against the exact confirmed root.

The coordinator owns install, start, and verification as separate committed stages. Installation only switches the standard managed slot. It never attaches a bridge or advances the start phase. `runtime_started` is committed only after Desktop issues the real Runtime start command and observes a ready Runtime Service. Recovery from `runtime_installed` runs that start command; recovery from `runtime_started` rechecks readiness and the final process inventory. Success requires exactly one current Runtime process, an openable Runtime Service, and an accessible Desktop bridge and Local UI. Stop is the only lifecycle operation whose successful terminal state permits no Runtime process.

Wipe mode adopts an existing operation quarantine when safe, otherwise atomically isolates the exact Runtime root or performs controlled clearing of that same root. It never restores or starts the old Runtime after isolation. Preserve mode keeps user data in place, replaces only managed Runtime files, and restores the previous managed files when the fresh installation cannot be verified. After rollback, Desktop attempts to restart and verify the restored Runtime before reporting recovery.

Old Gateway directories under the confirmed Runtime root are historical residue. They may be removed as part of exact-root wipe cleanup but are never prepared, installed, started, or verified.

## Recovery journal

Desktop writes one minimal journal outside the target root. It records the confirmed target, mode, normalized physical root, operation quarantine, and last committed phase. Each committed phase is repeatable. After Desktop or transport interruption, a repeated confirmation resumes from this Desktop journal without consulting an old Gateway API, Runtime database, target-side lock, checkpoint service, or shell state machine.

Desktop presents one current recovery operation per physical target. If several journals remain for that target, the newest committed journal owns the popup and older journals remain cleanup inputs only. A post-confirmation interruption is shown as **Reinstall interrupted** with one direct **Continue reinstall** action bound to the original operation and preflight identity. Target-coordinate changes return to target review instead of reusing that confirmation. Button presentation is not execution authority: the journal, operation identity, and exact-target validation decide whether work can resume.

When the progress popup has a confirmation, continuation, retry, cancellation, or diagnostic action, its single normalized action stack stays in a fixed footer while steps and technical details scroll above it. The footer never creates a second action source or operation owner; it only keeps the existing executable actions immediately visible.

An old journal or quarantine is input to continuation or cleanup, not a reason to hide or block wipe reinstall. A genuine target-coordinate change still requires new confirmation because continuing against another host, container, user, or explicit root could delete unrelated data.

`manual_recovery_required` is reserved for cases where the direct channel or filesystem prevents continuation and, for preserve mode, also prevents safe rollback. Wipe failures retain the journal and present Continue Reinstall with the original command, exit status, stderr, and filesystem reason in technical details.

Failure ownership follows the active command: exact-root isolation and cleanup report filesystem errors; managed-slot switching reports installation errors; daemon launch reports startup errors; process count or Runtime Service mismatch reports Runtime verification errors; bridge, Catalog, or Local UI failure reports access verification errors. A later-stage failure is never rewritten as an earlier filesystem failure.

# Boundaries

Reinstall never scans a home directory, follows an unconfirmed symlink target, performs container-wide prune, or removes data outside the exact Runtime root and its operation quarantine. It does not require a remote lock or long-running script. Remote commands perform one bounded filesystem or process action; Desktop owns ordering, journal commits, progress, and retry.

# Evidence

- `redeven:desktop/src/main/reinstallTargetCoordinator.ts:1` - Direct target confirmation, journal, exact-root replacement, verification, and recovery.
- `redeven:desktop/src/shared/desktopReinstallProgress.ts:1` - Runtime-only ordered phase contract.
- `redeven:desktop/src/main/reinstallTargetProcess.ts:1` - Temporary helper inventory and best-effort stop.
- `redeven:desktop/src/main/reinstallRuntimePackage.ts:1` - Standard managed Runtime package staging, switching, startup, inventory verification, rollback, and cleanup.
- `redeven:desktop/src/main/main.ts:1` - Local, SSH, and container executor wiring and Launcher Operation projection.
- `redeven:desktop/src/welcome/App.tsx:1` - Confirmation, details disclosure, progress, and continuation UI.
