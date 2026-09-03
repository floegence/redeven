---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret v7 canonical journal ownership and contiguous Redeven product migrations.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Floret owns its opaque backend, logical schema, and session-tree domain migration lineage. Redeven owns `ai_threadstore_product_v1`, whose current version is 5 and whose contiguous migrations import retired queue data, add execution and delete authority, and remove obsolete physical storage. Neither repository reads or mutates the other's schema. Drift, future versions, or failed verification stop startup without reset or repair.

# Contract

Fresh product databases initialize directly at version 5 with ten physical tables including shared schema metadata. They contain thread settings, uploads, upload staging scopes, provider capabilities, Flower routing, execution authority, and delete authority, but no product queue or migration-staging table. Version 1 upgrades atomically to version 2: queued inputs are copied to `ai_pending_input_imports` using their stable request IDs, retired lifecycle tables are dropped, `queue_revision` is removed, and the exact target shape is verified. Version 2 to 3 adds the minimum submitting-user authority needed for restart redispatch. Version 3 to 4 adds endpoint-scoped delete authority.

Version 4 to 5 is the removal edge. While the product migration transaction still owns the exact retired source, a migration-only callback converts every pending row into typed Floret queue input through the public idempotent import API. The same product transaction records restart authority, rebuilds `ai_upload_refs` around its natural `(endpoint_id, upload_id, ref_kind, ref_id)` identity, preserves every live reference field, and drops `ai_pending_input_imports`. This removes the unused surrogate `id`, its redundant indexes, and the resulting SQLite sequence metadata. A verified post-migration vacuum removes SQLite's otherwise-retained internal sequence table; repeated current-version startup is clean and idempotent.

The historical version 1 to 2 edge remains immutable, so a direct version 1 upgrade may create `ai_pending_input_imports` temporarily inside the single contiguous migration transaction. Version 4 to 5 removes it before that transaction commits. Canonical import failure rolls back to the exact source schema and records. If a later product write fails after Floret accepted the input, restart repeats the same stable request key and Floret deduplicates it. Legacy codecs and old-table reads exist only in the closed migration path; production handlers cannot create, read, reorder, settle, or recover a Redeven queue row.

Published Floret v7.1.2 opens its own physical backend and migrates logical and session-tree domain state through its public runtime boundary. Domain schema v9 retains the complete v2-to-v9 chain. The v6-to-v7 edge restores exact RunID identity, terminates uncertain effects, and removes terminal forked Effect Attempt records only with exact ancestry and execution evidence. The v7-to-v8 edge rewrites only the exact legacy Engine continuation prompt paired with its save point into a control signal. The v8-to-v9 edge moves context identity into the canonical entry and follows each canonical Run across interaction resumes within one Turn; it does not reuse the Turn's initial Run. It repairs only verified fork copies whose payload ThreadID names an ancestor while TurnID and RunID still match. Non-ancestor identity, drift, malformed JSON, mixed state, and future versions fail without writes. Provider-context v6 remains an internal render boundary, not a domain migration. Every migration edge is atomic and has no production dual-read path. These layers remain opaque to Redeven: Redeven never inspects or edits Floret tables, including for an affected historical fork. Canonical user input, interactions, assistant output, tools, effects, context identity, and terminal facts stay upstream.

Floret v7.1.2 classifies fresh, current-v9, and legacy stores through one startup path, reuses SQLite statements during migration, and avoids duplicate full-state verification when no write occurred. A legacy store reports `migrating` then `verifying`; fresh and current stores report only `verifying`. Redeven forwards those phases and never derives progress from record counts or polling. Current format, mixed state, corruption, and cancellation retain the same fail-closed and transactional guarantees.

# Boundaries

Every future product schema change appends a contiguous automatic migration and retains database kind `ai_threadstore_product_v1`. Redeven never resets a distributed schema, deletes an upgrade edge, opens Floret tables, retains a migration staging table in the current schema, or turns retired storage into production lifecycle authority.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Version 5 initializer and the complete contiguous migration registration.
- `redeven:internal/ai/threadstore/pending_input_migration.go` - Closed v4-to-v5 conversion, authority persistence, retired-table removal, and upload-reference rebuild.
- `redeven:internal/ai/pending_input_migration.go` - Migration-only decoding and typed public Floret import.
- `redeven:internal/ai/service.go` - Supplies the migration callback before subscriptions and maintenance.
- `redeven:internal/ai/pending_input_migration_startup_test.go` - Covers canonical import, stable ordering, source rollback, and retired-storage removal.
- `redeven:internal/ai/threadstore/pending_input_migration_test.go` - Covers the full v1-to-v5 chain, v4 data preservation, clean reopen, and failure rollback.
- `redeven:internal/ai/threadstore/reviewed_schema_manifest.json` - Reviewed product schema source.
- `redeven:internal/boundarycontract/threadstore_sql.go` - Closed product SQL ownership inventory.
- `redeven:go.mod` - Pins the released Floret v7.1.2 module without local source wiring.
- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces exact published-v7 adoption and rejects replacement or retired imports.
