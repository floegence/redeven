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

`ai_thread_settings` stores endpoint, namespace, model, reasoning, permission type, working directory, pin state, queue revision, host audit identity, and independent settings timestamps. Canonical title, title source, lifecycle times, status, phase, preview, latest turn, and Agent relationships exist only in Floret. Upload rows and physical files remain Redeven resources. Before admission, `ai_upload_refs` binds uploads to one queued command; after admission, one transaction replaces those refs with thread ownership and deletes the command. There is no durable TurnID/RunID attachment mapping.

Permission snapshots are append-only Redeven security audit and pending-approval evidence, not the current permission source. Schema v3 keeps only strict snapshot version 2 records; snapshot v1 and malformed versions are removed during migration. Current permission always comes from `ai_thread_settings.permission_type` and invalid data fails closed.

Create, fork, and delete operation tables persist immutable host-owned snapshots and step confirmations. These tables coordinate effects across stores but do not contain a Floret result, canonical lifecycle snapshot, or data capable of rebuilding an Agent journal.

## Product v2 to v3

Startup first opens the existing database read/write without beginning the migration transaction, verifies kind `ai_threadstore_product_v2`, and accepts only schema version 2 or 3. Version 2 titles are read in one read-only transaction, then that transaction is closed. Each non-empty title is compared with Floret `ReadThreadOverview`: an empty canonical title is written through `SetThreadTitle`, an equal title is idempotent, and a different title is a startup-stopping conflict.

Only after every title succeeds does the normal SQLite migration transaction rebuild `ai_threads` as `ai_thread_settings`, remove all title columns, deduplicate admitted upload refs into thread ownership, preserve queued ownership, create the durable create-operation table, strip title data from pending fork snapshots, and retain only permission snapshot v2. The schema version is committed once with the rebuilt product tables. A crash before that commit leaves schema v2, and repeating already completed title writes is safe.

Fresh stores run the declared product migration chain to v3. Existing databases with another kind, version 0, versions below 2, future versions, absent/malformed metadata, or schema drift are rejected non-destructively. The removed canonical v15-v40 chain is not a supported input path.

# Boundaries

Redeven migration code may call only public Floret maintenance APIs and may retain only host settings, resources, queue state, routing/read state, audit, and operation intent. It must not query Floret SQLite, infer canonical data from old Redeven rows, or keep legacy aliases and compatibility parsers after the v2-to-v3 conversion.

# Evidence

- `redeven:internal/ai/threadstore/schema.go:12` - Threadstore declares product schema version 3 and the host-only settings table.
- `redeven:internal/ai/threadstore/schema_preflight.go:18` - Startup reads version-2 titles outside the SQL migration transaction and rejects unsupported stores.
- `redeven:internal/ai/service.go:256` - Title preflight compares and writes through Floret public APIs.
- `redeven:internal/ai/threadstore/product_migrations.go:73` - The v2-to-v3 migration rebuilds settings, ownership, snapshots, and operation tables.
- `redeven:internal/ai/threadstore/schema_migration_test.go:51` - Tests cover host-only v3, title migration, replay, conflicts, strict versions, and snapshot retention.
- `redeven:scripts/check_floret_dependency_boundary.sh:1` - Static checks reject Floret storage access and local dependency wiring.
