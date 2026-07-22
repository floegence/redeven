---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret owns Agent state while Redeven schema v4 stores only host settings, resources, queue state, routing, and security audit.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Floret owns admitted Agent state; Redeven owns host settings, unadmitted work, upload storage, routing/read state, security audit, and cross-store operation intent.
- Outcome: threadstore schema v4 uses `ai_thread_settings` plus product-only `ai_flower_thread_routing` and contains no title, transcript, turn, run, projection, approval, todo, context, provider-state, or SubAgent hierarchy copy.
- Invariants: migration accepts only verified product schemas v2, v3, and v4; Floret title migration for v2 runs before the Redeven SQL migration transaction.
- Failure boundary: title conflicts, unsupported kind/version, schema drift, invalid records, and failed Floret calls stop startup without repair, backup, reset, or substitute database creation.

# Contract

## Schema v4 ownership

`ai_thread_settings` stores endpoint, namespace, model, reasoning, permission type, working directory, pin state, queue revision, host audit identity, and independent settings timestamps. Canonical title, title source, lifecycle times, status, phase, preview, latest turn, and Agent relationships exist only in Floret. Upload rows and physical files remain Redeven resources. Before admission, `ai_upload_refs` binds uploads to one queued command. The command has only `ready` or `in_flight` admission state; in-flight commands are immutable and excluded from bulk draft recovery. Canonical admission atomically settles the command and upload ownership, while a known execution failure before admission releases the command as a draft instead of silently retrying it. Startup recovery may return a crash-interrupted command to queued `ready` only after public Floret reads prove that its exact TurnID was not admitted. There is no durable admitted TurnID/RunID lifecycle or message mapping, so a missing row during settlement is an explicit error.

Permission snapshots are append-only Redeven security audit and pending-approval evidence, not the current permission source. Schema v4 keeps only strict snapshot version 2 records; snapshot v1 and malformed versions are removed during the v2-to-v3 step. Current permission always comes from `ai_thread_settings.permission_type` and invalid data fails closed.

Create, fork, and delete operation tables persist immutable host-owned snapshots and step confirmations. These tables coordinate effects across stores but do not contain a Floret result, canonical lifecycle snapshot, or data capable of rebuilding an Agent journal. The SubAgent publication operation is pending-only coordination intent: while pending it holds the exact hashed Floret spawn request plus host session/model inputs required for deterministic replay; commit atomically finalizes the permission audit and clears those payloads. A non-retryable failure moves the operation to terminal `failed` and also clears replay payloads. Only `pending` operations are listed for recovery, so a failed spawn cannot be replayed. The operation never stores child status, membership, messages beyond the unresolved request, events, or projections. Operation rows and queued commands accept only their exact current schema through strict single-value JSON decoding. Create binds its decoded snapshot to row identity and request fingerprint; fork and delete additionally bind the complete snapshot payload to a dedicated fingerprint. Damaged durable intent is rejected rather than normalized, guessed, or replayed with zero values.

## Product v2 and v3 to v4

Startup first opens the existing database read/write without beginning the migration transaction, verifies kind `ai_threadstore_product_v2`, and accepts only schema version 2, 3, or 4. For version 2, one read-only transaction verifies the complete frozen v2 table, column, index, trigger, and metadata shape plus every upload reference, strict permission row, pending fork snapshot, and pending delete snapshot before reading titles. Reference kinds must match the exact supported literals; version-2 permission audit rows must satisfy the complete current owner and lifecycle validator. Any shape or payload drift aborts before calling Floret. The transaction is then closed before each non-empty title is compared with Floret `ReadThreadOverview`: an empty canonical title is written through `SetThreadTitle`, an equal title is idempotent, and a different title is a startup-stopping conflict. Versions 3 and 4 contain no title copy and therefore make no Floret write during preflight.

Only after every v2 title succeeds does the normal SQLite migration transaction rebuild `ai_threads` as `ai_thread_settings`, remove all title columns, deduplicate admitted `turn`/`run`/`thread` upload refs into thread ownership, preserve `queued_turn` ownership, add explicit queue admission state, create durable create and SubAgent-publication operation tables, convert pending fork snapshots to the intermediate schema-v2 host shape, fingerprint fork/delete snapshots, and retain only permission snapshot v2. Snapshot v1 rows are intentionally discarded and never used as current authority. A legacy source-title fallback inside a pending fork is removed unless the stored request fingerprint proves the title was explicit.

The v3-to-v4 step creates `ai_flower_thread_routing`, copies only non-empty product placement fields, rewrites pending fork snapshots to schema v3 with the same product-only routing shape, then drops `ai_flower_thread_metadata`, `ai_flower_transfers`, and `ai_flower_handoffs`. Agent owner, parent, context, action, transfer envelope, and handoff envelope fields are discarded rather than renamed or retained behind a compatibility reader. Both migration steps commit with the final schema version through the declared migration runner; a crash before commit leaves the previous verified version for deterministic retry.

Fresh stores are initialized directly with the declared schema v4 shape. An existing verified v2 database runs v2-to-v3 and v3-to-v4; an existing verified v3 database runs only v3-to-v4. Existing databases with another kind, version 0, versions below 2, future versions, absent or malformed metadata, or schema drift are rejected non-destructively. The removed product v1 and canonical v15-v40 migration paths are not supported inputs.

# Boundaries

The repository-wide automatic migration and database ownership contract is
defined by [Database schema migration ownership](../architecture/database-schema-migrations.md).
This concept defines the Flower-specific cross-owner exception and does not
grant Redeven authority over Floret's database schema.

Redeven migration code may call only public Floret maintenance APIs and may retain only host settings, resources, queue state, routing/read state, audit, and operation intent. It must not query Floret SQLite, infer canonical data from old Redeven rows, or keep legacy aliases and compatibility parsers after conversion to v4.

# Evidence

- `redeven:internal/ai/threadstore/schema.go:12` - Threadstore declares product schema version 4 and its host-only tables.
- `redeven:internal/ai/threadstore/schema_preflight.go:19` - Startup accepts only v2/v3/v4 and reads version-2 titles outside the SQL migration transaction.
- `redeven:internal/ai/service.go:270` - Service startup supplies the Floret public title migration callback.
- `redeven:internal/ai/service.go:289` - Title preflight compares and writes through Floret public APIs before opening the product store.
- `redeven:internal/ai/threadstore/product_migrations.go:14` - The v3-to-v4 migration retains product routing and removes legacy Agent shadow tables.
- `redeven:internal/ai/threadstore/schema_migration_test.go:93` - Tests verify fresh stores initialize directly at schema v4.
- `redeven:internal/ai/threadstore/schema_migration_test.go:126` - Tests verify v3-to-v4 retains product routing without Agent shadows.
- `redeven:internal/ai/threadstore/schema_migration_test.go:332` - Tests verify v2 title and ownership migration through both schema steps.
- `redeven:internal/ai/threadstore/schema_migration_test.go:525` - Tests verify title migration failures leave the v2 schema unchanged.
- `redeven:internal/ai/threadstore/schema_migration_test.go:550` - Tests reject invalid legacy upload ownership kinds before effects.
- `redeven:internal/ai/threadstore/schema_migration_test.go:789` - Tests reject unsupported legacy database kinds and versions.
- `redeven:scripts/check_floret_dependency_boundary.sh:1` - Static checks reject Floret storage access and local dependency wiring.
