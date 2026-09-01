---
type: Architecture Contract
title: Database schema migration ownership
description: Redeven automatically migrates product databases at startup while upstream-owned stores remain opaque.
tags: [architecture, storage, sqlite, migrations, upgrades]
timestamp: 2026-08-30T00:00:00Z
---
# Summary

- Authority: each repository migrates the schemas it owns; Redeven owns product databases, while Floret and ReDevPlugin own their internal stores.
- Outcome: a Redeven upgrade opens every product SQLite store through the versioned migration engine before dependent services accept requests.
- Invariants: supported forward migrations are contiguous, atomic, verified, and preserve product data; future, drifted, wrong-kind, and unsupported schemas fail closed.
- Failure boundary: migration failure stops only the affected service generation with the previous supported database intact; no reset, replacement database, or direct upstream SQL is allowed.

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
registry, thread read state, Notes, Workbench layout, Terminal Group Catalog, and release-trust state
before returning the product service. The AI product threadstore opens inside
the isolated AI readiness generation, so its failure blocks Agent surfaces
without preventing unrelated Code App capabilities from starting. Its current
`ai_threadstore_product_v1` is currently version 2. The exact reviewed version 1
shape upgrades automatically through the contiguous v1-to-v2 migration: stable
queued request ids move into migration-only pending-input staging, retired
lifecycle tables are removed, product settings are rebuilt in the reviewed v2
shape, metadata advances, and the whole target is verified before commit. Missing
or empty storage initializes directly at v2. Unknown, future, unsupported, or
drifted shapes are rejected read-only. All later versions retain the same kind
and append contiguous automatic migrations. Other product stores retain their existing supported
migration histories. Their individual migration tests
remain responsible for historical shape validation and preservation of their
domain records. The port-forward registry's contiguous v1-to-v2 migration adds
managed Web Service and persistent operation records while retaining the exact
v1 forward table and every user-owned forward; v2-to-v3 adds immutable template
snapshots and service-family state; v3-to-v4 adds the constrained forward access
mode; v4-to-v5 versions configuration and typed resources; v5-to-v6 adds
schema-v1 operation details; and v6-to-v7 separates the historical DeepSeek Host
and container families. V7-to-v8 upgrades all TemplateSpec documents to v2,
converts retired DeepSeek deployment names, and adds an exact, hashed release
identity. It reconstructs only reviewed unambiguous historical npm integrity and
exact OCI digests; ambiguity rejects the migration. Existing workspaces, data,
volumes, secrets, forwards, configuration, operations, timestamps, Hooks, and
journals remain unchanged. V8-to-v9 introduces TemplateSpec v3 and adds managed
environment only to exact built-in DeepSeek Host definitions. Other built-in
and custom v2 documents remain byte-for-byte valid until an explicit edit. The
edge restores the original desired-running intent only for the latest failed
Runtime-generated recovery Start. A later user operation always wins. The edge
recomputes affected document digests without moving historical Host directories
or container volumes and preserves release identity, secrets, forwards,
configuration, operation history, failure facts, timestamps, Hooks, and
journals. The v4 edge defaults ordinary forwards to the unified
proxy and selects Desktop loopback only for an existing managed DeepSeek forward.
Drifted historical inputs, future versions, and failed migrations remain unchanged;
managed service, protected forward, and first operation creation is separately atomic at runtime. The
shared engine rejects incomplete migration chains,
unsupported old versions, future versions, malformed metadata, wrong database
kinds, and unversioned non-empty databases. Migration and verification errors
roll back the transaction; startup must surface the error instead of deleting,
renaming aside, repairing heuristically, or replacing the database.

Every schema change must add the next explicit version step and tests for the
new upgrade edge, rollback, drift, future-version rejection, and user-data
preservation. The repository-level SQLite opening inventory makes any new
physical database entrypoint an explicit ownership review: production
Redeven-owned stores use the shared migration engine, while reviewed direct
openings are limited to the threadstore existing-only, read-only full-schema
gate and in-memory canonical-schema verification.

## Upstream-owned schemas

Floret v7 owns the canonical Thread journal and its schema lifecycle. Redeven supplies
the configured path to the published runtime startup API and consumes its typed
readiness result. Floret owns inspection, migration, verification, exact open,
and conflict classification; Redeven does not query, patch, version, migrate,
or provide a compatibility fallback for Floret records.
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
- `redeven:internal/portforward/registry/schema.go` - Owns the exact contiguous port-forward Registry v1-to-v9 migration chain and final verifier.
- `redeven:internal/portforward/registry/registry_test.go` - Covers managed-service v7-to-v9 preservation, recovery intent, rollback, drift, future versions, and idempotent open.
- `redeven:okf/architecture/ai-readiness-lifecycle.md:1` - Defines isolated AI startup and generation failure behavior.
- `redeven:internal/ai/threadstore/store.go` - Verifies exact supported historical or current product shape before writable open.
- `redeven:internal/ai/threadstore/schema.go` - Defines current v2 and the atomic reviewed v1-to-v2 migration.
- `redeven:internal/ai/floret_bootstrap.go` - Opens the published Floret v7 runtime without direct storage access.
- `redeven:scripts/check_floret_dependency_boundary.sh:118` - Rejects Redeven access to Floret-owned storage schemas and raw SQL.
- `redeven:okf/ai/flower-storage-ownership-and-migrations.md:1` - Defines the specialized cross-owner Flower product migration.
