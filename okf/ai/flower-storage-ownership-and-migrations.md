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
Redeven consumes published Floret v7.78.2 with `GOWORK=off`.

Ordinary Floret writes stage, validate and persist affected canonical records only; startup, migrations and explicit integrity checks still validate the complete repository.

A read-state failure cannot become a core Runtime constructor failure or a synthetic read record.

## Readonly checks and owner transactions
`sqliteutil` owns WAL-aware readonly preflight, integrity checks and complete SQLite snapshots for product and read-state owners. Inspection never creates missing data or runs a migration.

Required upgrade snapshots precede Floret space maintenance and all migrations, as specified by the [backup and recovery contract](flower-backup-and-recovery.md).

## Frozen historical queue conversion
The migration-only `pendinginputlegacy` package owns the complete interpretation of historical queue bytes: session identity, options, context shapes, default values, resource metadata and normalization limits.

The v4-to-v5 product transaction imports canonical pending inputs through Floret's public idempotent import API, records necessary product authority and removes retired source tables before commit. The upgrade operation contains only target build, original snapshot identity and completion; owner versions and canonical records remain the progress authority.

## Resource and authorization retention
Product upload references retain resources for every canonical thread that contains them, including ordinary forks, nested forks and restored inputs.

Bounded keyset maintenance and compaction stop and drain with their owning generation.

# Boundaries

Floret is the sole authority for canonical history, execution and queue semantics. Historical byte interpretation never grants current execution permission.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Stable product kind and contiguous migration registration.

- `redeven:internal/threadreadstate/schema.go` - Read-state lineage and exact historical validation.

- `redeven:internal/persistence/sqliteutil/preflight.go` - Shared readonly inspection.
