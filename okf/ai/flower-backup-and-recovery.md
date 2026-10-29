---
type: Recovery Contract
title: Flower backup and recovery
tags: [ai, storage, recovery, backups]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Readiness drains generations; storage owners snapshot/migrate their data and Floret ends old execution. Recover history/settings/read-state/uploads without stopping other surfaces. Freeze Flower writes during capture/replacement, verify complete collections and retain snapshots. Space, malformed data, migration or interruption blocks Flower while preserving recovery; no effect replay or binary rollback.

# Contract

## Preserved snapshots
Ordinary startup, binary changes and transactional migrations do not create full snapshots. A damaged old snapshot cannot block healthy live data.

Abandoned task staging is removed only after any durable replacement completes and before a new generation opens; an unclosed generation prevents that path.

## Administrator recovery
Settings and the Flower maintenance action expose backup time, source build, size and protection.

Old unfinished Turns become terminal, old interactions become resolved and non-executable, and queued input remains canonical readonly `RestoredInputs`.

Diagnostics use the existing sanitized export and do not include conversations, credentials, database contents or uploaded files by default.

# Boundaries

Only conversation-owned databases and uploaded resources participate in a restore. Environment extension configuration, including the [Agent Plugins registry and data](flower-agent-plugins.md), remains outside conversation snapshots and is preserved unchanged. Restore staging never initializes its plugin manager. Core Runtime services remain available.

# Evidence

- `redeven:internal/ai/storage_snapshot.go` - Explicit capture, metadata and preserved snapshot inventory.

- `redeven:internal/ai/storage_files.go` - Directory durability, staging cleanup and replacement verification.
