---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret v7 canonical journal ownership and contiguous Redeven product migrations.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-09-03T00:00:00Z
---
# Summary

Floret owns its opaque two-table backend, logical schema, and session-tree domain migration lineage. Redeven owns `ai_threadstore_product_v1`, whose current version is 6. Its contiguous migrations import retired queue data, retain only durable product facts, and remove obsolete physical storage. Existing product validation reads the complete SQLite main-plus-WAL view. Neither repository reads or mutates the other's schema. Drift, future versions, or failed verification stop startup without reset or repair.

# Contract

Fresh product databases initialize directly at version 6 with exactly seven tables: schema metadata, thread settings, execution authority, uploads, upload attempts, upload references, and upload staging scopes. There is no product queue, migration staging, provider-capability cache, thread-routing record, or delete tombstone. Version 1 upgrades atomically to version 2: queued inputs are copied to `ai_pending_input_imports` using their stable request IDs, retired lifecycle tables are dropped, `queue_revision` is removed, and the exact target shape is verified. Version 2 to 3 adds the minimum submitting-user authority needed for restart redispatch. Version 3 to 4 historically adds endpoint-scoped delete authority.

For an existing non-empty product database, the shared Redeven SQLite opener runs the exact historical-schema validator through `mode=ro` before any writable pragma or migration. Immutable mode is forbidden here because it ignores valid uncheckpointed WAL content and can misclassify a real v4 database as empty v0. Rejection preserves main, WAL, and SHM bytes and their original existence; a temporary inspection SHM or WAL is removed. Missing and zero-length files continue through fresh initialization. Threadstore owns only its kind, version, and reviewed shape rules, while `sqliteutil` owns path, connection, transaction, and sidecar handling.

Version 4 to 5 is the removal edge. While the product migration transaction still owns the exact retired source, a migration-only callback converts every pending row into typed Floret queue input through the public idempotent import API. The same product transaction records restart authority, rebuilds `ai_upload_refs` around its natural `(endpoint_id, upload_id, ref_kind, ref_id)` identity, preserves every live reference field, and drops `ai_pending_input_imports`. This removes the unused surrogate `id`, its redundant indexes, and the resulting SQLite sequence metadata. A verified post-migration vacuum removes SQLite's otherwise-retained internal sequence table; repeated current-version startup is clean and idempotent.

Version 5 to 6 rebuilds the affected tables and copies only current facts. It drops `provider_capabilities`, `ai_flower_thread_routing`, and `ai_thread_delete_authority`; removes unused user-audit, upload-declaration, claim-time, reference-time, and scope-release columns; and renames upload-reference `thread_id` to `target_id`. Released and expired staging scopes and their exact claims are deleted during migration. The old names and columns remain readable only inside the closed migration functions. Fresh and migrated databases end in the same exact seven-table schema.

Provider capability is pure current computation. Canonical resource target authority comes only from the current `ToolTargetPolicy`; no database row or callback can override it. Upload `complete` and `failed` request identities provide a seven-day idempotency window. Ordinary execution authority also expires after seven days, while the active or waiting Turn, every queued RequestKey, and the latest failed Turn remain protected. Maintenance reads public Floret `ThreadView`; not-found or deleted threads release their authority immediately, while any other read failure skips deletion.

Startup and 15-minute maintenance use bounded keyset pages with process-local cursors. Released or expired upload scopes are physically deleted instead of retained as tombstones. After each pass Redeven checks SQLite free pages and schedules background incremental vacuum only when at least 4 MiB, 256 pages, and 10 percent of the file are free.

The historical version 1 to 2 edge remains immutable, so a direct version 1 upgrade may create `ai_pending_input_imports` temporarily inside the single contiguous migration transaction. Version 4 to 5 removes it before that transaction commits. Canonical import failure rolls back to the exact source schema and records. If a later product write fails after Floret accepted the input, restart repeats the same stable request key and Floret deduplicates it. Legacy codecs and old-table reads exist only in the closed migration path; production handlers cannot create, read, reorder, settle, or recover a Redeven queue row.

Published Floret v7.1.2 opens its own physical backend and migrates logical and session-tree domain state through its public runtime boundary. Domain schema v9 retains the complete v2-to-v9 chain. The v6-to-v7 edge restores exact RunID identity, terminates uncertain effects, and removes terminal forked Effect Attempt records only with exact ancestry and execution evidence. The v7-to-v8 edge rewrites only the exact legacy Engine continuation prompt paired with its save point into a control signal. The v8-to-v9 edge moves context identity into the canonical entry and follows each canonical Run across interaction resumes within one Turn; it does not reuse the Turn's initial Run. It repairs only verified fork copies whose payload ThreadID names an ancestor while TurnID and RunID still match. Non-ancestor identity, drift, malformed JSON, mixed state, and future versions fail without writes. Provider-context v6 remains an internal render boundary, not a domain migration. Every migration edge is atomic and has no production dual-read path. These layers remain opaque to Redeven: Redeven never inspects or edits Floret tables, including for an affected historical fork. Canonical user input, interactions, assistant output, tools, effects, context identity, and terminal facts stay upstream.

Floret v7.1.2 classifies fresh, current-v9, and legacy stores through one startup path, reuses SQLite statements during migration, and avoids duplicate full-state verification when no write occurred. A legacy store reports `migrating` then `verifying`; fresh and current stores report only `verifying`. Redeven forwards those phases and never derives progress from record counts or polling. Current format, mixed state, corruption, and cancellation retain the same fail-closed and transactional guarantees.

# Boundaries

Every future product schema change appends a contiguous automatic migration and retains database kind `ai_threadstore_product_v1`. Redeven never resets a distributed schema, deletes an upgrade edge, opens Floret tables, retains a migration staging table in the current schema, or turns retired storage into production lifecycle authority.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Version 6 initializer and the complete contiguous migration registration.
- `redeven:internal/ai/threadstore/wal_preflight_test.go` - Covers WAL-only v4 migration, durable-record preservation, typed rejection, idempotent reopen, and sidecar restoration.
- `redeven:internal/ai/threadstore/pending_input_migration.go` - Closed v4-to-v5 conversion, authority persistence, retired-table removal, and upload-reference rebuild.
- `redeven:internal/ai/pending_input_migration.go` - Migration-only decoding and typed public Floret import.
- `redeven:internal/ai/service.go` - Supplies the migration callback before subscriptions and maintenance.
- `redeven:internal/ai/pending_input_migration_startup_test.go` - Covers canonical import, stable ordering, source rollback, and retired-storage removal.
- `redeven:internal/ai/threadstore/schema_v6_test.go` - Covers every supported version, v5 data preservation, retired-state removal, clean reopen, and failure rollback.
- `redeven:internal/ai/threadstore/uploads_test.go` - Covers seven-day pruning, scope deletion, shared references, and physical SQLite compaction.
- `redeven:internal/ai/execution_authority_maintenance_test.go` - Covers canonical retention, missing threads, read failures, and keyset paging.
- `redeven:internal/ai/threadstore/reviewed_schema_manifest.json` - Reviewed product schema source.
- `redeven:internal/boundarycontract/threadstore_sql.go` - Closed product SQL ownership inventory.
- `redeven:internal/persistence/sqliteutil/engine.go` - Owns the single WAL-aware physical preflight and writable migration path.
- `redeven:go.mod` - Pins the released Floret v7.1.2 module without local source wiring.
- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces exact published-v7 adoption and rejects replacement or retired imports.
