---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret owns Agent state while Redeven owns product records and migrates only explicitly versioned schemas.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Floret owns admitted Agent state; Redeven owns product metadata and migration coordination.
- Outcome: Product threadstore opens only after its schema and any supported canonical legacy source are validated and migrated through explicit steps.
- Invariants: Redeven never queries Floret SQLite, copies Agent state into product tables, or synthesizes missing permission, approval, event, or control values.
- Failure boundary: Unknown kinds, unsupported versions, schema drift, invalid data, and failed Floret identity establishment abort the transaction without repair or partial conversion.

# Contract

## Ownership

Floret is the only durable authority for admitted conversation, thread path, turn and run lifecycle, projections, control signals, approvals, Agent todos, tool lifecycle, provider continuation, prompt state, and subagent lifecycle. Redeven threadstore contains only product thread configuration, commands that Floret has not admitted, uploads and resource references, Flower routing and handoff metadata, permission audit snapshots, read acknowledgement, and fork or delete coordination records.

## State and flow

The current Redeven threadstore is product schema v2. The supported canonical legacy kind is explicitly versioned v15 through v40. Migration verifies the declared source version, applies each consecutive canonical step to v40, validates product data, and establishes every non-empty product thread identity through Floret `ThreadMaintenanceHost.EnsureThread`. Only after those calls succeed does the same transaction remove Agent shadow tables and convert retained product records to product v1; the deterministic product v1-to-v2 migration then removes the obsolete Floret result shadow column. Queued command conversion maps `turn_id` from the legacy `message_id` and `run_id` from `queue_id`; empty or duplicate identities fail before Floret calls.

Every SQLite store uses one immediate-lock migration transaction. The engine acquires the write lock before reading `PRAGMA user_version`, verifies the exact metadata row and schema contract, applies consecutive migrations, verifies tables, columns, indexes, triggers, constraints, and kind, updates version metadata, and commits. Fresh empty databases follow the same declared version chain. The same ownership rules apply to notes, thread read state, Workbench layout, Code App registry, and port-forward registry.

## Failure semantics

Any failed Floret identity call, canonical step, product conversion, version update, final verification, or input validation rolls back the Redeven transaction. Non-empty databases without metadata, malformed metadata, unknown kinds, unsupported old versions, future versions, schema drift, and invalid data fail without file deletion, schema claiming, conditional DDL, or runtime repair. Pending approvals and events must carry complete identity, lifecycle, batch, timestamp, and argument-hash contracts; missing values are errors. Projection unavailability remains diagnostic state and does not rewrite a successful Floret execution as failed. A malformed `ask_user` signal is rejected instead of receiving generated clarification text.

# Boundaries

Redeven must not import Floret internals, query Floret-managed tables, persist transcript, run, projection, control, approval, todo, context, provider, or tool mirrors, or use local dependency wiring. Migration code may retain only product records and opaque references needed to call public Floret maintenance APIs. [Floret thread runtime integration](floret-thread-runtime.md) owns the runtime authority boundary; this concept owns storage conversion and schema failure behavior.

# Evidence

- `redeven:internal/persistence/sqliteutil/engine.go:123` - The shared engine opens stores through the immediate-lock schema contract.
- `redeven:internal/ai/threadstore/schema.go:23` - The threadstore schema registers consecutive product migrations and canonical v15-v40 migrations.
- `redeven:internal/ai/threadstore/canonical_migrations.go:65` - Canonical migration validates source versions, converts product data, and establishes Floret thread identities.
- `redeven:internal/ai/threadstore/product_migrations.go:34` - Product v1-to-v2 performs the deterministic product schema rebuild.
- `redeven:internal/ai/threadstore/schema_migration_test.go:16` - Migration tests cover canonical v15-v40 conversion and product schema outcomes.
- `redeven:internal/ai/floret_runtime.go:209` - Invalid Floret turn contracts are rejected at the runtime boundary.
