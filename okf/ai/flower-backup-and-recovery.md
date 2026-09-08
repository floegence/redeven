---
type: Recovery Contract
title: Flower backup and recovery
description: Preserve complete Flower data before upgrades and restore a verified collection without replaying old work.
tags: [ai, storage, recovery, backups]
timestamp: 2026-09-08T00:00:00Z
---
# Summary

- Authority: the readiness controller drains generations; each storage owner snapshots and migrates its own data; Floret alone terminates old execution.
- Outcome: administrators can recover Flower history, settings, read state and uploads while other Runtime surfaces remain usable.
- Invariants: no Flower writer during capture or replacement, complete verified collections, original upgrade snapshot preservation, and no automatic execution replay.
- Failure boundary: insufficient space, malformed backups, migration defects or interrupted replacement block Flower and preserve recoverable data; recovery does not roll back external actions or binaries.

# Contract

## Automatic snapshots

Readonly inspection precedes the first write. Existing data receives an automatic
snapshot on first adoption of maintenance, a changed running build, or a required
migration. The build identity combines the reported version and executable
digest, so development binaries are covered too. An unfinished upgrade keeps its
original snapshot across retries and repair builds; partially migrated data never
replaces that source. Completion records successful storage preparation before
execution activation, not the outcome of any conversation.

The collection contains `ai/threads.sqlite`, `ai/floret_threads.sqlite`,
`apps/appserver/thread_read_state.sqlite` and Flower-managed `ai/uploads`.
The supported former read-state location maps to the current snapshot path.
Workspaces, external systems and global authentication configuration are outside
the collection. Floret is accessed only through its published SQLite snapshot
API; product and read-state owners use `sqliteutil`. Each SQLite backup includes
committed WAL records. Cross-database consistency comes from stopping every
Flower writer, including cleanup tasks, for the entire capture.

Files are copied and checked, then a manifest records fixed managed roots,
sizes, digests, time, source build and kind. Directory entries are synchronized
before atomic publication beneath `flower-maintenance/snapshots`. Pending copies
never appear as complete backups. Symlinks, unexpected files and malformed
manifests are refused. Space and capture failures stop the upgrade before owner
migration and remain local to Flower.

Retention keeps the newest three completed automatic snapshots. The source of an
unfinished upgrade and every preserved pre-restore scene are protected. Damaged
manifest entries remain visible as unavailable, without hiding valid choices.
Abandoned task staging is removed only after any durable replacement completes
and before a new generation opens; an unclosed generation prevents that path.

## Administrator recovery

Settings and the Flower maintenance action expose backup time, source build,
size and protection. An administrator selects one backup, reviews the complete
impact, then explicitly confirms. Both list and restore endpoints check admin
permission before generation access. The restore request requires an exact
snapshot ID and `confirmed: true`; no backup is chosen automatically.

The controller validates the selected snapshot before stopping a usable Flower
generation, drains all requests, closes every owner, and verifies the immutable
backup again. It preserves the current scene, including raw SQLite sidecars so
even a corrupt database remains available for diagnosis. It copies the selected
collection to a private staging directory, migrates each owner with execution
deferred, then invokes Floret `Host.PrepareRestore`. Old unfinished Turns become
terminal, old interactions become resolved and non-executable, and queued input
remains canonical readonly `RestoredInputs`. Retry cannot replay restored Turns;
new work requires a new user submission.

After the staged Host closes successfully, a durable file-operation journal
records the prepared set, original presence, digests and replacement step. Each
original root moves to the operation's previous location before its prepared
root moves live. Database sidecars and the former read-state path participate in
the same operation. Each rename and step is synchronized. A restart verifies and
finishes that journal before opening any Flower database. It never opens a mixed
set; invalid prepared data remains blocked with both sets preserved. Installed
bytes and owner formats are verified before removing the journal.

A fresh storage-generation value is persisted with each completed replacement,
including repeated restoration of the same backup. [Transport outbox recovery](../ui/flower-turn-launcher.md)
retains the submitted generation and rejects stale work rather than resending
it against restored data. This value identifies a dataset, not an execution or
migration ledger.

The running binary then uses ordinary preparation and activation. Restoring does
not select an older binary, undo commands or external actions, or repair an
unfixed migration defect. These limits appear beside the confirmation control.
Diagnostics use the existing sanitized export and do not include conversations,
credentials, database contents or uploaded files by default.

# Boundaries

Only Flower-owned databases and uploaded resources participate in a restore.
Workspace files, global credentials, external operations and the running binary
remain outside that boundary. A failed close or incomplete replacement prevents
any subsequent Flower store open until ownership and collection consistency
are established. Core Runtime services remain available.

# Evidence

- `redeven:internal/ai/storage_snapshot.go` - Capture, upgrade operation, metadata and retention.
- `redeven:internal/ai/storage_restore.go` - Owner preparation and durable complete-set replacement.
- `redeven:internal/ai/storage_files.go` - Directory durability, staging cleanup and replacement verification.
- `redeven:internal/codeapp/ai_readiness.go` - Drain, close, restore and publication ownership.
- `redeven:internal/codeapp/appserver/ai_storage_maintenance.go` - Administrator request boundary.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerStorageSettings.tsx` - Review, confirmation and failure presentation.
- `redeven:internal/ai/storage_upgrade_test.go` - Every rename interruption and stale request generation.
- `redeven:internal/ai/storage_failure_test.go` - Cancelled preparation, backup failure and protected retention.
- `redeven:internal/ai/storage_compatibility_test.go` - Historical lifecycle restoration and explicit new work.
