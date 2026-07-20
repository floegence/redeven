---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret owns Agent state while Redeven schema v3 stores only host settings, resources, queue state, routing, and security audit.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Floret owns admitted Agent state; Redeven owns host settings, unadmitted work, upload storage, routing/read state, security audit, and cross-store operation intent.
- Outcome: threadstore schema v3 uses `ai_thread_settings` and contains no title, transcript, turn, run, projection, approval, todo, context, provider-state, or SubAgent hierarchy copy.
- Invariants: migration supports only the current product schema v2 to v3 and never calls Floret while a Redeven SQL transaction is open.
- Failure boundary: title conflicts, unsupported kind/version, schema drift, invalid records, and failed Floret calls stop startup without repair, backup, reset, or substitute database creation.

# Contract

## Schema v3 ownership

`ai_thread_settings` stores endpoint, namespace, model, reasoning, permission type, working directory, pin state, queue revision, host audit identity, and independent settings timestamps. Canonical title, title source, lifecycle times, status, phase, preview, latest turn, and Agent relationships exist only in Floret. Upload rows and physical files remain Redeven resources. Before admission, `ai_upload_refs` binds uploads to one queued command. The command has only `ready` or `in_flight` admission state; in-flight commands are immutable and excluded from bulk draft recovery. Only run-end canonical reconciliation may release one: admitted commands settle to thread ownership, unadmitted failures return to ready, and unadmitted cancellations become drafts. There is no durable TurnID/RunID attachment mapping, so a missing row during settlement is an explicit error.

Permission snapshots are append-only Redeven security audit and pending-approval evidence, not the current permission source. Schema v3 keeps only strict snapshot version 2 records; snapshot v1 and malformed versions are removed during migration. Current permission always comes from `ai_thread_settings.permission_type` and invalid data fails closed.

Create, fork, and delete operation tables persist immutable host-owned snapshots and step confirmations. These tables coordinate effects across stores but do not contain a Floret result, canonical lifecycle snapshot, or data capable of rebuilding an Agent journal. The SubAgent publication operation is pending-only coordination intent: while pending it holds the exact hashed Floret spawn request plus host session/model inputs required for deterministic replay; commit atomically finalizes the permission audit and clears those payloads. A non-retryable failure moves the operation to terminal `failed` and also clears replay payloads. Only `pending` operations are listed for recovery, so a failed spawn cannot be replayed. The operation never stores child status, membership, messages beyond the unresolved request, events, or projections. Operation rows and queued commands accept only their exact current schema through strict single-value JSON decoding. Create binds its decoded snapshot to row identity and request fingerprint; fork and delete additionally bind the complete snapshot payload to a dedicated fingerprint. Damaged durable intent is rejected rather than normalized, guessed, or replayed with zero values.

## Product v2 to v3

Startup first opens the existing database read/write without beginning the migration transaction, verifies kind `ai_threadstore_product_v2`, and accepts only schema version 2 or 3. For version 2, one read-only transaction verifies the complete frozen v2 table, column, index, trigger, and metadata shape plus every upload reference, strict permission row, pending fork snapshot, and pending delete snapshot before reading titles. Reference kinds must match the exact supported literals; version-2 permission audit rows must satisfy the complete current owner and lifecycle validator. Any shape or payload drift aborts before calling Floret. The transaction is then closed before each non-empty title is compared with Floret `ReadThreadOverview`: an empty canonical title is written through `SetThreadTitle`, an equal title is idempotent, and a different title is a startup-stopping conflict.

Only after every title succeeds does the normal SQLite migration transaction rebuild `ai_threads` as `ai_thread_settings`, remove all title columns, deduplicate admitted `turn`/`run`/`thread` upload refs into thread ownership, preserve `queued_turn` ownership, add explicit queue admission state, create durable create and SubAgent-publication operation tables, convert pending fork snapshots to host-only settings/resource shape, fingerprint fork/delete snapshots, and retain only permission snapshot v2. Snapshot v1 rows are intentionally discarded by this one supported migration and never used as current authority. A legacy source-title fallback inside a pending fork is removed unless the stored request fingerprint proves the title was explicit. The schema version is committed once with the rebuilt product tables. A crash before that commit leaves schema v2, and repeating already completed title writes is safe.

Fresh stores are initialized directly with the declared schema v3 shape. Only an existing, fully validated product schema v2 database runs the v2-to-v3 migration. Existing databases with another kind, version 0, versions below 2, future versions, absent/malformed metadata, or schema drift are rejected non-destructively. The removed product v1 and canonical v15-v40 migration paths are not supported inputs.

# Boundaries

Redeven migration code may call only public Floret maintenance APIs and may retain only host settings, resources, queue state, routing/read state, audit, and operation intent. It must not query Floret SQLite, infer canonical data from old Redeven rows, or keep legacy aliases and compatibility parsers after the v2-to-v3 conversion.

# Evidence

- `redeven:internal/ai/threadstore/schema.go:12` - Threadstore declares product schema version 3 and the host-only settings table.
- `redeven:internal/ai/threadstore/schema_preflight.go:18` - Startup reads version-2 titles outside the SQL migration transaction and rejects unsupported stores.
- `redeven:internal/ai/service.go:256` - Title preflight compares and writes through Floret public APIs.
- `redeven:internal/ai/threadstore/product_migrations.go:73` - The v2-to-v3 migration rebuilds settings, ownership, snapshots, and operation tables.
- `redeven:internal/ai/threadstore/schema_migration_test.go:51` - Tests cover host-only v3, title migration, replay, conflicts, strict versions, and snapshot retention.
- `redeven:scripts/check_floret_dependency_boundary.sh:1` - Static checks reject Floret storage access and local dependency wiring.
