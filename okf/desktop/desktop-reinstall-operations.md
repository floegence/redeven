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

Preview is local and non-destructive. It shows one short risk statement, with host, container, root, affected registrations, and process details collapsed. A saved `remote_default` root is shown as the user-facing `~/.redeven`; Desktop does not connect merely to expand the remote home directory. Confirmation binds the saved host/user/port, exact container engine/id when present, registered Runtime root identity, mode, preflight, and operation identity. Execution resolves the physical absolute root through the confirmed direct channel and rejects any mismatch before target mutation.

One Reinstall selection owns one current-process disclosure from preflight through execution. It opens before preview and binds the first matching new operation or the exact existing identity returned by Desktop; unrelated old progress cannot replace it. A later selection transfers ownership, user closure survives snapshot refreshes, and conflict or recovery focus uses the same state.

Execution has four prerequisites only: the confirmed direct channel opens, the target resolves to the confirmed exact root, the current Desktop can prepare and verify a Runtime package for the target platform, and the filesystem permits the required exact-root operations. Gateway availability, Runtime protocol, schema, trust, token, old process identity, or old directory contents are not prerequisites.

After confirmation, Desktop first persists the reinstall-required marker. Only then does it commit `direct_channel_open`, open the executor, or issue a target command. If marker persistence fails, the journal remains at confirmation and the target is untouched. Direct host commands are bounded (30 seconds for checks and filesystem actions, 10 minutes for package transfer), and the whole reinstall has a 15-minute deadline. Timeout and cancellation preserve the journal and command diagnostics for retry.

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

Package preparation precedes target disruption and contains Runtime plus required companions, never Gateway. `package_batch_prepared_and_verified` remains only for journal compatibility; there is one package owner. Reinstall writes the standard `runtime/managed` slot used by other lifecycle actions, including `redeven`, the complete verified ReDevPlugin companion and release-evidence suite on every native target platform, and `managed-runtime.stamp`, with private `0700` directory/executable and `0600` metadata permissions independent of target `umask`. Inventory runs the archive's verified `redeven`; wipe records inventory or stop failure and still replaces the exact confirmed root.

The coordinator commits install, start, and verification separately; installation only switches the managed slot. `runtime_started` requires the exact launch session's valid ready report and openable Runtime Service, while a valid blocked report fails with its original reason. Every confirmed journal below `catalog_and_local_ui_verified` replays replacement and verification with the current Desktop package. Historical phases never authorize reuse of old bytes. Success requires exactly one process whose PID, managed path, release, commit, and Runtime Service match that package, followed by an accessible Desktop bridge and Local UI. Only successful Stop permits no Runtime process.

Wipe mode adopts an existing operation quarantine when safe, otherwise atomically isolates the exact Runtime root or performs controlled clearing of that same root. It never restores or starts the old Runtime after isolation. Preserve mode keeps user data in place, replaces only managed Runtime files, and restores the previous managed files when the fresh installation cannot be verified. After rollback, Desktop attempts to restart and verify the restored Runtime before reporting recovery.

Old Gateway directories under the confirmed Runtime root are historical residue. They may be removed as part of exact-root wipe cleanup but are never prepared, installed, started, or verified.

## Recovery journal

Desktop writes one minimal journal outside the target root. It records the confirmed target, mode, registered or resolved root, operation quarantine, and last committed phase. Each committed phase is repeatable. After Desktop or transport interruption, a current Desktop request resumes an already confirmed journal directly without asking the user to confirm the same destructive target again and without consulting the marker, an old Gateway API, Runtime database, target-side lock, checkpoint service, or shell state machine. The journal intentionally stores no package identity; the current Desktop package cache and validation contract are authoritative on every incomplete recovery.

Launcher progress belongs only to the current Desktop process. Startup never restores a journal as an automatically opened popup. Unstarted confirmation journals are discarded; a post-confirmation journal remains internal recovery authority and contributes to the Environment's current `reinstall_required` state while the Runtime is unhealthy. When the user opens that recovery action, Desktop creates one current-process progress owner at the journal's committed phase with a direct Continue action.

An Environment that requires recovery exposes one standard **Reinstall Redeven** action and **Refresh status**. A Runtime startup report with `runtime_state_incompatible` records this state and opens the wipe-mode target review; it never deletes data before confirmation. Open and ordinary Runtime lifecycle actions fail with the same typed reinstall-required result until recovery is cleared. If the newest confirmed journal still matches the registered target, selecting Reinstall creates a current-process recovery operation that continues its original mode without another confirmation. If no confirmed journal matches, Desktop creates a fresh confirmation for the current target. Only a genuinely live current-process task may return `reinstall_target_in_progress`.

After verification, journal affected IDs drive convergence. Desktop keeps current success, removes older reinstall and terminal Runtime/Open records for all affected Environments through shared cleanup, resets the Launcher issue, then forces one manual health refresh before the final snapshot. Reinstall has no generic refresh; projection errors cannot rewrite success or revive old errors.

A successful current Runtime health probe clears the recovery marker and retires matching Desktop journals when no reinstall is live. It never deletes target-side quarantine data during status refresh. An old journal or quarantine is input to a later exact-root reinstall or cleanup, not a reason to revive historical progress or block a newly confirmed wipe. A genuine target-coordinate change still requires new confirmation because continuing against another host, container, user, or explicit root could delete unrelated data.

Execution accepts only a request whose Environment, mode, preflight, and operation key exactly match the stored preview. That check happens before lifecycle locking or success/in-progress shortcuts. The stored preview and journal then supply the descriptor lookup, lifecycle fingerprint, progress, retry, and coordinator inputs, so Desktop cannot lock one target while executing another.

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
