---
type: Desktop Contract
title: Desktop managed Environment reinstall
description: Runtime-only direct-channel reinstall with minimal Desktop recovery journal.
tags: [desktop, reinstall, runtime, ssh, containers]
timestamp: 2026-08-26T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Wipe-data reinstall is Desktop's final recovery path for a broken managed Redeven Runtime. After the user confirms the exact Local, SSH, or container target and Runtime root, Desktop prepares a verified Runtime-only package, attempts to stop old Redeven processes, replaces the exact root, starts and verifies the fresh Runtime, and cleans retained old data. Gateway, old Runtime health, old databases, unknown process state, previous journals, and quarantine content cannot reject the operation before a direct filesystem action is attempted. Preserve-data reinstall is a convenience path and rolls back its managed-file replacement when fresh verification fails.

# Contract

Interaction sessions follow [Desktop interaction continuity](desktop-interaction-continuity.md), including authority invalidation, retained drafts, explicit visibility and stale-completion fencing.

## Confirmation and prerequisites
Environment card menus name both data modes as **Reinstall**, never **Uninstall**.

Timeout and cancellation preserve the journal and command diagnostics for retry.

## Runtime-only sequence
The authoritative progress order is:

They may be removed as part of exact-root wipe cleanup but are never prepared, installed, started, or verified.

## Recovery journal
Desktop writes one minimal journal outside the target root. The journal intentionally stores no package identity; the current Desktop package cache and validation contract are authoritative on every incomplete recovery.

A later-stage failure is never rewritten as an earlier filesystem failure.

# Boundaries

Reinstall never scans a home directory, follows an unconfirmed symlink target, performs container-wide prune, or removes data outside the exact Runtime root and its operation quarantine. Remote commands perform one bounded filesystem or process action; Desktop owns ordering, journal commits, progress, and retry.

# Evidence

- `redeven:desktop/src/main/reinstallTargetCoordinator.ts:1` - Direct target confirmation, journal, exact-root replacement, verification, and recovery.

- `redeven:desktop/src/shared/desktopReinstallProgress.ts:1` - Runtime-only ordered phase contract.

- `redeven:desktop/src/main/reinstallTargetProcess.ts:1` - Temporary helper inventory and best-effort stop.
