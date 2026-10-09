---
type: Development Contract
title: Desktop development sessions and bundles
description: Run current-source local development services together and bound generated packages without removing live bundles.
tags: [desktop, development, storage, retention]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

- Authority: the development launcher owns its selected Desktop session, local Runtime, saved local host Gateways, and immutable generated packages.
- Outcome: development services run current checkout code and stop together; repeated launches remove obsolete packages after publishing the next complete bundle.
- Invariants: preserve service identity and data; keep recent, selected, and live bundles; never stop unrelated services or remove user data.
- Failure boundary: service preparation failures prevent Desktop launch and trigger cleanup; incomplete process inventory prevents bundle deletion.

# Contract

## Development service lifecycle

`scripts/dev_desktop.sh` builds Desktop and its Runtime bundle from the current
checkout, including uncommitted source. Before Electron starts, it rebuilds and
starts every enabled local host Gateway saved in the selected development
profile, then stops the profile's previous local Runtime so Desktop launches the
new bundle. Each launch uses a fresh temporary Gateway package cache even when
the source commit has not changed. The normal package installer validates and
stamps each Gateway; development does not bypass version or build checks.

Gateway readiness checks the managed executable, installation stamp schema and
provenance, release identity, and source commit. A source-built Desktop expects
the Gateway binary and stamp to match its target commit. Matching the release
tag alone is insufficient. Automatic development installation keeps these facts
aligned rather than requiring a manual update after each checkout change.

The selected profile's saved local host connections define Gateway ownership.
An explicit local directory and `remote_default` (the host's `~/.redeven`)
are supported. Only the exact `gateways/<saved-gateway-id>/state` service is
managed; SSH, container, URL, and unsaved Gateways remain independent. Sharing
the same local Gateway between development and production profiles means the
development launcher will update and stop that saved service. Use a separate
Gateway directory when independent simultaneous operation is required.

Normal Electron exit, startup failure after service preparation begins, Ctrl+C,
and SIGTERM stop the development Runtime and local Gateways. Cleanup uses the
Runtime's verified process inventory and Gateway's service-stop identity checks.
A small session inventory retains Gateway locations removed or edited during
the session; newly saved local connections are included at exit. Service data,
identity, members, endpoints, and Cloud configuration are preserved. Failed
cleanup is reported and can be retried using `--stop-only`, including after an
uncatchable launcher termination. The selected Runtime bundle path is saved so
that command also works when no legacy managed Runtime executable exists.

`--no-stop` does not allow a second live Desktop owner for the same instance.
The existing `REDEVEN_DESKTOP_AUTO_START_RUNTIME=0` override still disables
automatic Runtime startup. Production Desktop exit continues to leave services
running under the [managed lifecycle contract](desktop-runtime-process-lifecycle.md).
Development coordination belongs to the launcher, not to product shutdown.

## Bundle retention

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
- `redeven:scripts/dev_desktop_gateways.mjs` - Fresh local Gateway preparation and exact saved-service cleanup.
- `redeven:scripts/dev_desktop_gateways.test.mjs` - Saved connection scope, repeated builds, and partial-start recovery.
