---
type: Desktop Contract
title: Desktop managed Environment reinstall
tags: [desktop, reinstall, runtime, ssh, containers]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Wipe reinstall is Desktop's recovery for a broken managed Runtime. After exact-target/root confirmation, Desktop verifies a Runtime package, attempts process stop, isolates/replaces the root, starts and verifies Runtime, then cleans old data. Old health, databases, journals or unknown process state cannot block the direct filesystem attempt. Preserve-data reinstall instead replaces managed files and rolls back when verification fails.

# Contract

- Both modes are named Reinstall. [Interaction continuity](desktop-interaction-continuity.md) owns confirmation sessions; timeout/cancellation preserve journal and diagnostics.
- The sequence is confirmation, direct channel, target resolution, verified package, stop attempt, old-root isolation, install, start, Runtime verification, catalog/Local UI verification and old-data cleanup. See the exact phase constants below. Only Runtime is prepared, installed, started and verified.
- One minimal journal lives outside the target root. It stores no package identity: current package-cache validation is authoritative on incomplete recovery. Preserve the actual failing phase rather than rewriting later failures as filesystem failures.

# Boundaries

Never scan a home directory, follow an unconfirmed symlink, prune containers globally or delete outside the confirmed root/quarantine. Remote commands perform bounded actions; Desktop owns sequence, journal commits, progress and retry.

# Evidence

- `redeven:desktop/src/main/reinstallTargetCoordinator.ts:1` - Direct target confirmation, journal, exact-root replacement, verification, and recovery.

- `redeven:desktop/src/shared/desktopReinstallProgress.ts:1` - Runtime-only ordered phase contract.

- `redeven:desktop/src/main/reinstallTargetProcess.ts:1` - Temporary helper inventory and best-effort stop.
