---
type: Development Contract
title: Desktop development bundle retention
description: Bound generated development packages while retaining every package selected by a running Desktop or Runtime process.
tags: [desktop, development, storage, retention]
timestamp: 2026-09-20T00:00:00Z
---
# Summary

- Authority: the development launcher owns immutable generated packages within its selected state root.
- Outcome: repeated development launches remove obsolete packages automatically after publishing the next complete bundle.
- Invariants: keep the three newest bundles, the selected launch bundle, and every bundle referenced by running processes; never clean another environment or user data.
- Failure boundary: incomplete process inventory prevents deletion; cleanup failures warn without blocking Desktop startup.

# Contract

`scripts/dev_desktop.sh` publishes each complete bundle below
`<development-state-root>/desktop/bundles/<manifest-sha256>` and then runs
retention before launching Electron. The three newest verified bundles are
ordered by directory modification time with a deterministic name tie-break.
The selected bundle is always retained, including reuse of an older build.
Process arguments and inherited environments protect additional older bundles:
Electron keeps `REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT` even when no package file
is open. The inventory stays in memory and is never logged or persisted.
After those processes exit, the next successful cleanup can remove their old
packages. Multiple Desktop owners for one Runtime remain outside the
[managed lifecycle contract](desktop-runtime-process-lifecycle.md).

Only direct child directories named by the SHA-256 of their regular manifest
file are eligible. Symlinked Desktop or bundle roots are rejected. Unknown,
damaged, symlinked, and in-progress `.build.*` entries are left alone and counted
in the cleanup report. Deletion restores owner access on package directories
without following symlinks or changing files shared through hard links. Live
process references take precedence over the ordinary retention count.

Every launch reports removed, retained, active, and ignored counts. A failed or
truncated process inventory, including an inventory that omits environments,
stops deletion before it starts. Filesystem failures are reported; later launches
retry ordinary retention. There is no persistent cleanup ledger or package lease.
The dry-run launch reports the retention policy without deleting packages.

To inspect an existing development profile without rebuilding or launching:

```bash
node scripts/prune_dev_desktop_bundles.mjs --state-root /absolute/development/profile --dry-run
```

Omit `--dry-run` to apply the same policy. The launcher also supplies
`--current-bundle` to protect its selected complete package. Retention is a
count bound on inactive verified packages, not a byte quota; active processes
and unverified entries can require additional space.

# Boundaries

Only generated packages within the selected development profile participate.
Live Runtime installations, caches, settings, databases, and
[Flower recovery snapshots](../ai/flower-backup-and-recovery.md) remain outside
this cleanup boundary. In-progress build directories belong to their builders.

# Evidence

- `redeven:scripts/dev_desktop.sh` - Complete bundle publication and startup cleanup.
- `redeven:scripts/prune_dev_desktop_bundles.mjs` - Process protection, bounded retention, and exact deletion scope.
- `redeven:scripts/prune_dev_desktop_bundles.test.mjs` - Repeated builds, live processes, filesystem boundaries, and failed inventory.
- `redeven:scripts/dev_desktop_signal_cleanup_test.sh` - Actual launcher pruning and signal shutdown with isolated fixtures.
