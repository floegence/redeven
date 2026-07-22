---
type: Architecture Contract
title: Database schema migration ownership
description: Redeven automatically migrates product databases at startup while upstream-owned stores remain opaque.
tags: [architecture, storage, sqlite, migrations, upgrades]
timestamp: 2026-07-22T00:00:00Z
---
# Summary

- Authority: each repository migrates the schemas it owns; Redeven owns product databases, while Floret and ReDevPlugin own their internal stores.
- Outcome: a Redeven upgrade opens every product SQLite store through the versioned migration engine before dependent services accept requests.
- Invariants: supported forward migrations are contiguous, atomic, verified, and preserve product data; future, drifted, wrong-kind, and unsupported schemas fail closed.
- Failure boundary: migration failure stops the affected startup path with the previous supported database intact; no reset, replacement database, or direct upstream SQL is allowed.

# Contract

## Redeven-owned schemas

Redeven product SQLite stores declare a stable database kind, current version,
supported minimum version, ordered migration steps, and final schema verifier.
Opening a store serializes migration access, reads the durable version and kind,
applies each required step, updates version metadata, verifies the exact final
shape, and commits once. Fresh stores initialize at the current schema; an
existing supported store advances automatically during application startup
before the service is returned to callers.

The current startup composition opens the Code App registry, port-forward
registry, thread read state, AI product threadstore, Notes, Workbench layout,
and release-trust state through this contract. Their individual migration tests
remain responsible for historical shape validation and preservation of their
domain records. The shared engine rejects incomplete migration chains,
unsupported old versions, future versions, malformed metadata, wrong database
kinds, and unversioned non-empty databases. Migration and verification errors
roll back the transaction; startup must surface the error instead of deleting,
renaming aside, repairing heuristically, or replacing the database.

Every schema change must add the next explicit version step and tests for the
new upgrade edge, rollback, drift, future-version rejection, and user-data
preservation. The repository-level SQLite opening inventory makes any new
physical database entrypoint an explicit ownership review: production
Redeven-owned stores use the shared migration engine, while the two reviewed
direct openings are limited to threadstore migration preflight and in-memory
canonical-schema verification.

## Upstream-owned schemas

Floret owns Agent journal storage and its schema lifecycle. Redeven supplies a
path only to the published `flruntime.OpenSQLiteStore` entrypoint in the AI
composition root; it does not query, patch, version, or migrate Floret tables.
Redeven migrations may call public Floret maintenance APIs only when moving a
Redeven-owned field across the ownership boundary, and must complete their
product preflight before making such an upstream effect.

ReDevPlugin similarly owns the schemas behind its released registry and host
modules. Redeven may choose the product state root and open released module
APIs, but it does not inspect or migrate ReDevPlugin tables. Opaque upstream
identifiers may appear in Redeven coordination records; upstream content and
lifecycle state must not be copied into product tables as a migration shortcut.

# Boundaries

Automatic migration is not permission to accept arbitrary historical shapes.
Only explicitly versioned and exactly verified inputs are supported. Dropping a
migration requires a deliberate minimum-supported-version decision reflected
in release compatibility and this OKF corpus.

Cross-database atomicity is not assumed. A migration that must call a public
upstream maintenance API requires a read-only product preflight and idempotent
upstream semantics before the local schema transaction begins. Redeven never
opens an upstream database directly to manufacture a cross-store transaction.

# Evidence

- `redeven:internal/persistence/sqliteutil/engine.go:117` - Opens Redeven SQLite stores and runs the validated migration transaction.
- `redeven:internal/persistence/sqliteutil/engine_test.go:13` - Covers fresh initialization, atomic rollback, unsupported versions, kind checks, malformed metadata, and concurrent opens.
- `redeven:internal/persistence/sqliteutil/repository_contract_test.go:14` - Locks the reviewed Redeven, direct, and Floret SQLite opening inventories.
- `redeven:internal/codeapp/codeapp.go:156` - Opens product stores during service composition before returning the Code App service.
- `redeven:internal/ai/threadstore/store.go:43` - Preflights and automatically migrates the Redeven-owned AI product database.
- `redeven:internal/ai/floret_bootstrap.go:432` - Opens the Floret-owned store only through the published runtime API.
- `redeven:scripts/check_floret_dependency_boundary.sh:118` - Rejects Redeven access to Floret-owned storage schemas and raw SQL.
- `redeven:okf/ai/flower-storage-ownership-and-migrations.md:1` - Defines the specialized cross-owner Flower product migration.
