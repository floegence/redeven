---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret owns Agent state while Redeven owns product records and migrates only explicitly versioned schemas.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-07-18T00:00:00Z
---

Floret is the only durable authority for admitted conversation, thread path,
turn and run lifecycle, projections, control signals, approvals, Agent todos,
tool lifecycle, provider continuation, prompt state, and subagent lifecycle.
Redeven never reads Floret SQLite, imports Floret internals, or persists a
queryable mapping of those records. Redeven threadstore contains only product
thread configuration, queued commands that Floret has not admitted, uploads and
resource references, Flower routing and handoff metadata, permission audit
snapshots, read acknowledgement, and fork or delete coordination records.

# Migration contract

The current Redeven threadstore is product schema v2. The only supported legacy
kind is the explicitly identified canonical threadstore at versions v15 through
v40. A canonical database is verified at its declared source version, migrated
through every consecutive canonical version to v40, validated for product data,
and then asked to establish every non-empty product thread identity through
Floret `ThreadMaintenanceHost.EnsureThread`. Only after all identity calls
succeed does the same Redeven transaction delete Agent shadow tables and convert
the retained product records to product v1. The standard product v1-to-v2
migration then removes the obsolete Floret result shadow column through a
deterministic table rebuild. Redeven never copies canonical transcript, run,
tool, todo, memory, checkpoint, delegated Agent lifecycle, or projection data
into a replacement product table.

Queued command identity conversion exists only in the canonical conversion:
`turn_id` is the declared legacy `message_id`, and `run_id` is
`run_migrated_` plus `queue_id`. Empty or duplicate identities fail before any
Floret thread is established. A failed Floret identity call, canonical step,
product conversion, version update, or final schema verification rolls back the
Redeven transaction. Already-created empty Floret identities are harmless and
make a retry idempotent; Redeven does not add a runtime repair branch.

Every Redeven SQLite store uses one immediate-lock migration transaction. The
transaction reads `PRAGMA user_version` only after acquiring the write lock,
verifies the exact metadata table and one metadata row, applies consecutive
migrations, verifies the final table, column, index, trigger, constraint, and
kind contract, updates version metadata, and commits. Fresh empty databases
create the current schema through the declared version chain. Non-empty
databases without metadata, malformed metadata, unknown kinds, unsupported old
versions, future versions, schema drift, and invalid data fail without repair,
file deletion, schema claiming, or conditional DDL.

Notes, thread read state, Workbench layout, Code App registry, and port-forward
registry follow the same engine. Their migrations use exact version SQL and
source verification. Code App's removed `code_port` shape is accepted only as
the explicitly identified `codeapp_registry_legacy` v1 kind; field-existence
probing is not a migration contract.

# Runtime consequences

Permission values are limited to `readonly`, `approval_required`, and
`full_access`; unknown persisted or incoming values are contract errors. Floret
pending approvals and events must carry complete identity, lifecycle, batch,
timestamp, and argument-hash contracts. Redeven does not invent missing approval
state, timestamps, revisions, tool names, or `ask_user` questions. A malformed
Floret event aborts the corresponding run processing. Projection availability
remains independent from execution status: an unavailable final projection is
diagnostic state and does not rewrite a successful Floret execution as failed.

# Verification

Table-driven tests cover every canonical start version v15 through v40,
product v1 through v2, Floret identity failure, invalid product data, schema
drift, transaction rollback, current and future versions, malformed metadata,
unversioned non-empty databases, and concurrent open serialization. Focused
store and AI tests also cover strict permission, approval, event, and
`ask_user` contracts.

# Related

- [AI tool runtime](ai-tool-runtime.md)
- [Flower thread fork coordination](flower-thread-fork-coordination.md)
- [Flower thread deletion coordination](flower-thread-deletion-coordination.md)

# Citations

[1] redeven:internal/persistence/sqliteutil/engine.go - The shared engine owns immediate-lock version and kind migration.
[2] redeven:internal/ai/threadstore/canonical_migrations.go - Canonical v15-v40 verification, identity establishment, and product conversion.
[3] redeven:internal/ai/threadstore/product_migrations.go - Product v1-to-v2 deterministic rebuild.
[4] redeven:internal/ai/service.go - Service opens Floret first and supplies the idempotent thread identity ensurer.
[5] redeven:internal/ai/threadstore/schema_migration_test.go - Canonical, product, rollback, and invalid-data migration coverage.
[6] redeven:internal/persistence/sqliteutil/engine_test.go - Metadata, concurrency, and migration-chain coverage.
