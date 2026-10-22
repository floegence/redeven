---
type: Recovery Contract
title: Flower backup and recovery
description: Restore preserved Flower collections without replaying old work or backing up every upgrade.
tags: [ai, storage, recovery, backups]
timestamp: 2026-09-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: the readiness controller drains generations; each storage owner snapshots and migrates its own data; Floret alone terminates old execution.
- Outcome: administrators can recover Flower history, settings, read state and uploads while other Runtime surfaces remain usable.
- Invariants: no Flower writer during capture or replacement, complete verified collections, preservation of all existing snapshots, and no automatic execution replay.
- Failure boundary: insufficient space, malformed backups, migration defects or interrupted replacement block Flower and preserve recoverable data; recovery does not roll back external actions or binaries.

# Contract

## Preserved snapshots
Ordinary startup, binary changes and transactional migrations do not create full snapshots. A damaged old snapshot cannot block healthy live data.

Abandoned task staging is removed only after any durable replacement completes and before a new generation opens; an unclosed generation prevents that path.

## Administrator recovery
Settings and the Flower maintenance action expose backup time, source build, size and protection.

Old unfinished Turns become terminal, old interactions become resolved and non-executable, and queued input remains canonical readonly `RestoredInputs`.

Diagnostics use the existing sanitized export and do not include conversations, credentials, database contents or uploaded files by default.

# Boundaries

Only Flower-owned databases and uploaded resources participate in a restore. Core Runtime services remain available.

# Evidence

- `redeven:internal/ai/storage_snapshot.go` - Explicit capture, metadata and preserved snapshot inventory.

- `redeven:internal/ai/storage_restore.go` - Owner preparation and durable complete-set replacement.

- `redeven:internal/ai/storage_files.go` - Directory durability, staging cleanup and replacement verification.
