---
type: Storage Contract
title: Flower storage ownership and migrations
description: Keep canonical Floret storage opaque and preserve every supported product migration through deterministic imports.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Floret owns canonical Agent data and its physical and logical formats; Redeven owns product facts, read state and uploaded resources.
- Outcome: supported existing data upgrades automatically and remains usable for new conversations.
- Invariants: stable database kinds, contiguous transactional migrations, immutable historical decoders, public Floret APIs and one service generation.
- Failure boundary: unknown formats, future versions, drift or failed validation block Flower without resetting data or disabling the core Runtime.

# Contract

## Storage owners
Redeven consumes the exact published Floret version in go.mod with `GOWORK=off`.

Floret owns bounded startup recognition and background per-thread migration. Each validated dependency closure publishes atomically; retained sources retire only after complete verification. The oldest v2-v5 snapshots reserve historical identities through a resumable scan before new-thread admission. Segmented stores admit new threads immediately. Redeven uses public status, thread preparation and per-thread media contracts and never decodes upstream records.

Cancellation, shutdown and execution-context settlement resolve canonical control records through Floret. The host keeps the original Stop request and does not read or reconstruct upstream conversation bodies to settle it.

A read-state failure cannot become a core Runtime constructor failure or a synthetic read record.

## Readonly checks and owner transactions
`sqliteutil` owns WAL-aware readonly preflight, integrity checks and complete SQLite snapshots for product and read-state owners. Inspection never creates missing data or runs a migration.

Required upgrade snapshots precede Floret space maintenance and all migrations, as specified by the [backup and recovery contract](flower-backup-and-recovery.md).

## Frozen historical queue conversion
The migration-only `pendinginputlegacy` package owns the complete interpretation of historical queue bytes: session identity, options, context shapes, default values, resource metadata and normalization limits.

The v4-to-v5 product transaction imports canonical pending inputs through Floret's public idempotent import API, records necessary product authority and removes retired source tables before commit. The upgrade operation contains only target build, original snapshot identity and completion; owner versions and canonical records remain the progress authority.

## Resource and authorization retention
Product upload references retain resources for every canonical thread that contains them, including ordinary forks, nested forks and restored inputs.

After activation, product recovery pages settings, retains each thread's complete descriptors and promotes eligible admitted input. Failures retain the cleanup gate while independent threads recover. Tool-media collection keeps its complete global inventory, write gate and idle constraint.

Bounded keyset maintenance and compaction stop and drain with their owning generation.

# Boundaries

Floret is the sole authority for canonical history, execution and queue semantics. Historical byte interpretation never grants current execution permission.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Stable product kind and contiguous migration registration.

- `redeven:internal/threadreadstate/schema.go` - Read-state lineage and exact historical validation.

- `redeven:internal/persistence/sqliteutil/preflight.go` - Shared readonly inspection.
