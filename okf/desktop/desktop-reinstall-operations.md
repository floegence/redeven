---
type: Desktop Contract
title: Desktop managed Environment reinstall
tags: [desktop, reinstall, runtime, ssh, containers]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Wipe reinstall confirms exact target/root, verifies package, attempts stop, replaces root, verifies startup and cleans old data. Unknown process or broken state cannot block filesystem recovery. Both modes are named Reinstall. [Interaction continuity](desktop-interaction-continuity.md) owns confirmation sessions; timeout/cancellation preserve journal and diagnostics.

# Contract

- The sequence is confirmation, direct channel, target resolution, verified package, stop attempt, old-root isolation, install, start, Runtime verification, catalog/Local UI verification and old-data cleanup. See the exact phase constants below. Only Runtime is prepared, installed, started and verified.
- One minimal journal lives outside the target root. It stores no package identity: current package-cache validation is authoritative on incomplete recovery. Preserve the actual failing phase rather than rewriting later failures as filesystem failures.

# Boundaries

Never scan a home directory, follow an unconfirmed symlink, prune containers globally or delete outside the confirmed root/quarantine. Remote commands perform bounded actions; Desktop owns sequence, journal commits, progress and retry.

# Evidence

- `redeven:desktop/src/main/reinstallTargetCoordinator.ts:1` - Source.
