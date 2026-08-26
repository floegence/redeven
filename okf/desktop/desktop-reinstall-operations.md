---
type: Desktop Contract
title: Desktop managed Environment reinstall
description: Runtime-only direct-channel reinstall with minimal Desktop recovery journal.
tags: [desktop, reinstall, runtime, ssh, containers]
timestamp: 2026-08-26T00:00:00Z
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

Package preparation completes before target disruption and contains Runtime plus its required companions, never Gateway. `package_batch_prepared_and_verified` remains the persisted phase name for journal compatibility; there is one Runtime package and no multi-component batch owner. Reinstall installs the same standard `runtime/managed` slot recognized by Start, Restart, Update, and Refresh, including `redeven`, verified ReDevPlugin companions, and `managed-runtime.stamp`. That slot uses the same private `0700` directory/executable and `0600` metadata contract as Update, independent of target `umask`. Process inventory uses `redeven` extracted from that verified archive rather than preparing another helper asset. The process tool is optional for wipe recovery: inventory or stop failure is recorded and replacement proceeds against the exact confirmed root.

The coordinator owns install, start, and verification as separate committed stages. Installation only switches the standard managed slot. It never attaches a bridge or advances the start phase. `runtime_started` is committed only after the exact launch session writes a valid ready startup report with an openable Runtime Service; a valid blocked report fails at startup with its original reason. Every confirmed journal below `catalog_and_local_ui_verified` replays package preparation, process stop, safe target replacement, installation, startup, and verification with the current Desktop package. A historical `runtime_installed`, `runtime_started`, or `runtime_verified` phase proves only that the old attempt committed that command; it never authorizes reuse of old installed bytes. Success requires exactly one process whose PID, managed binary path, release, commit, and Runtime Service match the current package, followed by an accessible Desktop bridge and Local UI. Stop is the only lifecycle operation whose successful terminal state permits no Runtime process.

Wipe mode adopts an existing operation quarantine when safe, otherwise atomically isolates the exact Runtime root or performs controlled clearing of that same root. It never restores or starts the old Runtime after isolation. Preserve mode keeps user data in place, replaces only managed Runtime files, and restores the previous managed files when the fresh installation cannot be verified. After rollback, Desktop attempts to restart and verify the restored Runtime before reporting recovery.

Old Gateway directories under the confirmed Runtime root are historical residue. They may be removed as part of exact-root wipe cleanup but are never prepared, installed, started, or verified.

## Recovery journal

Desktop writes one minimal journal outside the target root. It records the confirmed target, mode, normalized physical root, operation quarantine, and last committed phase. Each committed phase is repeatable. After Desktop or transport interruption, a current Desktop request resumes an already confirmed journal directly without asking the user to confirm the same destructive target again and without consulting an old Gateway API, Runtime database, target-side lock, checkpoint service, or shell state machine. The journal intentionally stores no package identity; the current Desktop package cache and validation contract are authoritative on every incomplete recovery.

Launcher progress belongs only to the current Desktop process. Startup never restores a journal as an automatically opened popup. Unstarted confirmation journals are discarded; a post-confirmation journal remains internal recovery authority and contributes to the Environment's current `reinstall_required` state while the Runtime is unhealthy. When the user opens that recovery action, Desktop creates one current-process progress owner at the journal's committed phase with a direct Continue action.

An Environment that requires recovery exposes one standard **Reinstall Redeven** action and **Refresh status**. Open and ordinary Runtime lifecycle actions fail with the same typed reinstall-required result until recovery is cleared. If the newest confirmed journal still matches the registered target, selecting Reinstall creates a current-process recovery operation that continues its original mode without another confirmation. If no confirmed journal matches, Desktop creates a fresh confirmation for the current target. Only a genuinely live current-process task may return `reinstall_target_in_progress`.

A successful current Runtime health probe clears the recovery marker and retires matching Desktop journals when no reinstall is live. It never deletes target-side quarantine data during status refresh. An old journal or quarantine is input to a later exact-root reinstall or cleanup, not a reason to revive historical progress or block a newly confirmed wipe. A genuine target-coordinate change still requires new confirmation because continuing against another host, container, user, or explicit root could delete unrelated data.

`manual_recovery_required` is reserved for cases where the direct channel or filesystem prevents retry and, for preserve mode, also prevents safe rollback. Wipe failures retain the journal and present the standard Reinstall action with the original command, exit status, stderr, and filesystem reason in technical details during the current process.

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
