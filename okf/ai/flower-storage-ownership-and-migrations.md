---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret v4 canonical journal ownership and contiguous Redeven product migrations.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Floret owns its opaque backend, logical schema, and session-tree domain migration lineage. Redeven owns `ai_threadstore_product_v1`, whose current version is 4 and whose contiguous migrations import retired queue data, add execution authority, and add delete authority. Neither repository reads or mutates the other's schema. Drift, future versions, or failed verification stop startup without reset or repair.

# Contract

Fresh product databases initialize version 4 with thread settings, pending-input migration staging, uploads, upload staging scopes, provider capabilities, Flower routing, execution authority, and delete authority. Version 1 upgrades atomically to version 2: queued inputs are copied to `ai_pending_input_imports` using their stable request IDs, retired lifecycle tables are dropped, `queue_revision` is removed, and the exact target shape is verified. Version 2 to 3 adds the minimum submitting-user authority needed for restart redispatch. Version 3 to 4 adds endpoint-scoped delete authority. Every edge verifies its exact target before the shared schema owner advances metadata and commits.

During service startup, after the Floret effect adapter is bound and before live subscriptions or maintenance start, the pending-input importer synchronously converts each migration row into Floret typed queue input. Only a successful canonical import is marked complete. If completion marking fails, startup fails and a restart repeats the same stable request keys; Floret idempotency prevents duplicates. Canonical import failure also stops startup and leaves staging intact. The legacy codecs live only beside that importer. Production handlers cannot create, read, reorder, settle, or recover a Redeven queue row.

Published Floret v4.0.12 opens its own physical backend and migrates logical and session-tree domain state through its public runtime boundary. Those layers have independent versions and remain opaque to Redeven; Redeven neither labels them as one product journal schema nor inspects their records. Canonical user input, queue intent, interactions, effect intent/results, assistant output, and terminal facts stay upstream. High-frequency deltas, subscribers, and execution tokens are in memory and are not mirrored into Redeven SQL.

# Boundaries

Every future product schema change appends a contiguous automatic migration and retains database kind `ai_threadstore_product_v1`. Redeven never resets a distributed schema, deletes an upgrade edge, opens Floret tables, or turns a migration staging table into production lifecycle authority.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Version 4 initializer and contiguous v1-to-v2, v2-to-v3, and v3-to-v4 migrations.
- `redeven:internal/ai/pending_input_import.go` - Migration-only decoding and typed Floret import.
- `redeven:internal/ai/service.go` - Runs pending-input import before subscriptions and maintenance.
- `redeven:internal/ai/pending_input_import_startup_test.go` - Covers completion failure, restart dedupe, ordering, and canonical failure.
- `redeven:internal/ai/threadstore/reviewed_schema_manifest.json` - Reviewed product schema source.
- `redeven:internal/boundarycontract/threadstore_sql.go` - Closed product SQL ownership inventory.
- `redeven:go.mod` - Pins the released Floret v4.0.12 module without local source wiring.
- `redeven:internal/session/floret_v4_dependency_contract_test.go` - Enforces exact published-v4 adoption and rejects replacement or retired imports.
