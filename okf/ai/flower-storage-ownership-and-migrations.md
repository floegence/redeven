---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret v4 canonical journal ownership and contiguous Redeven product migrations.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Floret owns its canonical journal and migration lineage. Redeven owns `ai_threadstore_product_v1`, whose current version is 2 and whose contiguous v1-to-v2 migration removes retired lifecycle tables after importing queued user input. Neither repository reads or mutates the other's schema. Drift, future versions, or failed verification stop startup without reset or repair.

# Contract

Fresh product databases initialize version 2 with thread settings, pending-input migration staging, uploads, upload staging scopes, provider capabilities, and Flower routing. Version 1 upgrades atomically: queued inputs are copied to `ai_pending_input_imports` using their stable request IDs, obsolete receipt, queue, operation, permission snapshot, and publication tables are dropped, `queue_revision` is removed, metadata advances to version 2, and the exact target shape is verified before commit.

During service startup, after the Floret effect adapter is bound and before live subscriptions or maintenance start, the pending-input importer synchronously converts each migration row into Floret typed queue input. Only a successful canonical import is marked complete. If completion marking fails, startup fails and a restart repeats the same stable request keys; Floret idempotency prevents duplicates. Canonical import failure also stops startup and leaves staging intact. The legacy codecs live only beside that importer. Production handlers cannot create, read, reorder, settle, or recover a Redeven queue row.

Floret v4 migrates its own canonical journal to schema version 5 through its published open path. Canonical user input, queue intent, interactions, effect intent/results, assistant output, and terminal facts stay upstream. High-frequency deltas, subscribers, and execution tokens are in memory and are not mirrored into Redeven SQL.

# Boundaries

Every future product schema change appends a contiguous automatic migration and retains database kind `ai_threadstore_product_v1`. Redeven never resets a distributed schema, deletes an upgrade edge, opens Floret tables, or turns a migration staging table into production lifecycle authority.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Version 2 initializer and atomic v1-to-v2 migration.
- `redeven:internal/ai/pending_input_import.go` - Migration-only decoding and typed Floret import.
- `redeven:internal/ai/service.go` - Runs pending-input import before subscriptions and maintenance.
- `redeven:internal/ai/pending_input_import_startup_test.go` - Covers completion failure, restart dedupe, ordering, and canonical failure.
- `redeven:internal/ai/threadstore/reviewed_schema_manifest.json` - Reviewed product schema source.
- `redeven:internal/boundarycontract/threadstore_sql.go` - Closed product SQL ownership inventory.
- `floret:internal/storage/sqlite/schema.go` - Upstream-owned canonical schema version.
