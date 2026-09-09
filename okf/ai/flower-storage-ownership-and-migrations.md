---
type: Storage Contract
title: Flower storage ownership and migrations
description: Keep canonical Floret storage opaque and preserve every supported product migration through deterministic imports.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-09-08T00:00:00Z
---
# Summary

- Authority: Floret owns canonical Agent data and its physical and logical formats; Redeven owns product facts, read state and uploaded resources.
- Outcome: supported existing data upgrades automatically and remains usable for new conversations.
- Invariants: stable database kinds, contiguous transactional migrations, immutable historical decoders, public Floret APIs and one service generation.
- Failure boundary: unknown formats, future versions, drift or failed validation block Flower without resetting data or disabling the core Runtime.

# Contract

## Storage owners

Redeven consumes published Floret v7.8.0 with `GOWORK=off`. Floret owns journal,
queue, interactions, context lineage, execution identity and recovery. Redeven
uses public `InspectSQLite`, `BackupSQLite`, deferred `runtime.Open`, typed
queue import, `Host.Activate` and `Host.PrepareRestore`; it neither queries nor
repairs Floret tables.

Product kind `ai_threadstore_product_v1` retains its entire contiguous v1-to-v6
migration chain. Fresh version 6 has exactly seven tables: schema metadata,
thread settings, execution authority, uploads, upload attempts, upload
references and staging scopes. Historical rows and shapes are accepted only by
the exact migration edge that owns them. The read-state owner retains its
supported v0-to-v4 lineage and moves the former path using a complete SQLite
snapshot before removing the source. Existing compatibility does not expand to
discarded experimental kinds.

The [AI generation lifecycle](../architecture/ai-readiness-lifecycle.md) owns
opening and closing all three stores plus attachment maintenance. AppServer
read-state operations use its retained request lease. A read-state failure
cannot become a core Runtime constructor failure or a synthetic read record.

## Readonly checks and owner transactions

`sqliteutil` owns WAL-aware readonly preflight, integrity checks and complete
SQLite snapshots for product and read-state owners. Inspection never creates
missing data or runs a migration. Existing main, WAL and SHM bytes and original
sidecar existence are preserved. SQLite immutable mode is not used because it
ignores committed WAL records. Missing and zero-length files use the reviewed
fresh initialization path.

Checks reject deterministic incompatibility before the first write. Each owner
checks again inside its migration transaction; final schema validation, records
and version metadata commit together or roll back. Required upgrade snapshots
precede Floret space maintenance and all migrations, as specified by the
[backup and recovery contract](flower-backup-and-recovery.md).

## Frozen historical queue conversion

The migration-only `pendinginputlegacy` package owns the complete interpretation
of historical queue bytes: session identity, options, context shapes, default
values, resource metadata and normalization limits. It does not import current
request DTOs, `session.Meta`, permission policy or business normalization.
Historical resource scope is decoded from persisted facts; current execution
permission still comes from the current authorization boundary.

The v4-to-v5 product transaction imports canonical pending inputs through
Floret's public idempotent import API, records necessary product authority and
removes retired source tables before commit. The same source always produces
the same RequestKey and normalized input. If Floret commits and the product
transaction rolls back, another startup repeats the same import and continues
without duplication. Different content under that key fails explicitly. No
per-record migration ledger or production queue mirror exists. The upgrade
operation contains only target build, original snapshot identity and completion;
owner versions and canonical records remain the progress authority.

## Resource and authorization retention

Product upload references retain resources for every canonical thread that
contains them, including ordinary forks, nested forks and restored inputs.
Missing retention may be filled only after canonical membership and immutable
upload identity are verified. It grants no new user or endpoint access.

Upload request idempotency and ordinary execution authority expire after seven
days. Active/waiting Turns, queued RequestKeys and the latest failed Turn remain
protected. Floret supplies the exact RequestKey and TurnID when an execution
binds its product authority; an unbound authority remains protected during
queue promotion. Missing/deleted canonical threads release authority, while
other canonical read failures skip deletion. Bounded keyset maintenance and
compaction stop and drain with their owning generation.

# Boundaries

Floret is the sole authority for canonical history, execution and queue
semantics. Redeven must use its published maintenance and import contracts.
Product facts and read state remain separate owner transactions; deterministic
imports provide retry continuity without claiming a distributed transaction.
Historical byte interpretation never grants current execution permission.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Stable product kind and contiguous migration registration.
- `redeven:internal/threadreadstate/schema.go` - Read-state lineage and exact historical validation.
- `redeven:internal/persistence/sqliteutil/preflight.go` - Shared readonly inspection.
- `redeven:internal/persistence/sqliteutil/backup_test.go` - Committed WAL snapshots and source-sidecar preservation.
- `redeven:internal/ai/pendinginputlegacy/input.go` - Frozen historical input interpretation.
- `redeven:internal/ai/pending_input_migration_startup_test.go` - Canonical-commit/product-rollback retry and conflict coverage.
- `redeven:internal/ai/floret_attachment_authority.go` - Canonical upload retention without access grants.
- `redeven:internal/ai/execution_authority_maintenance_test.go` - Queue handoff and canonical authority protection.
- `redeven:internal/ai/storage_compatibility_test.go` - Immutable writer upgrades, retained facts and real continuation.
- `redeven:scripts/contracts/threadstore_boundary_manifest.json` - Reviewed SQL ownership inventory.

The upstream v9 to v10 domain edge admits durable context and validation feedback
without rewriting existing entries. Redeven neither opens those records nor
reconstructs lost ephemeral history. References and runtime snapshots are submitted
through public `UserInput`; Floret owns their fingerprints, replay, and compaction.
