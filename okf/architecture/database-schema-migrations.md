---
type: Architecture Contract
title: Database schema migration ownership
description: Redeven automatically migrates product databases at startup while upstream-owned stores remain opaque.
tags: [architecture, storage, sqlite, migrations, upgrades]
timestamp: 2026-09-04T00:00:00Z
---
# Summary

- Authority: each repository migrates the schemas it owns; Redeven owns product databases, while Floret and ReDevPlugin own their internal stores.
- Outcome: each Redeven product store opens through an exact versioned schema contract before the dependent service accepts requests.
- Invariants: released migration lineages are contiguous, atomic, verified, and data-preserving; existing-file preflight reads the complete SQLite main-plus-WAL view, while future, drifted, wrong-kind, and unsupported inputs fail without changing database files or sidecars.
- Failure boundary: a failed migration stops the affected service with the previous supported database intact; Redeven never patches an upstream database or silently replaces an incompatible product database.

# Contract

## Redeven-owned stores

Each SQLite store declares a stable database kind, current version, supported minimum version, ordered `n -> n+1` migrations, an existing-schema validator, and a final exact verifier. The shared `sqliteutil` opener owns path handling and every physical connection. For a non-empty existing file it first opens `mode=ro`, without immutable mode, so validation sees the same main-file and WAL state that the writable migration will use. It closes that transaction and restores any SHM bytes or sidecar existence changed only by inspection before proceeding. Missing and zero-length files skip preflight and use the normal fresh initializer.

After preflight, opening serializes migration access, applies writable pragmas, verifies kind and source shape, applies all required steps, updates metadata, verifies the target, and commits once. A fresh store may initialize at the current version. Business stores provide only schema kind, version, migration, and verification rules; they do not assemble SQLite URIs or open parallel validation connections.

Migration and verification failure rolls back. Wrong kind, unknown or future version, missing migration edge, unversioned non-empty file, document digest mismatch, or exact schema drift is rejected without deletion, rename-aside, heuristic repair, partial write, or replacement. Every new version adds tests for fresh initialization, each new edge, user-record preservation, rollback, drift, future versions, and repeated current opens.

The current startup composition opens product stores such as Code App, Port Forward, thread read state, Notes, Workbench layout, Terminal Group Catalog, and release trust before returning their owning services. AI readiness may isolate its own product-store failure from unrelated Code App capabilities, but it follows the same ownership and migration rules.

`ai_threadstore_product_v1` is the permanent AI product lineage. Its exact version-1 input upgrades through every reviewed edge to current version 6. The v5-to-v6 edge rebuilds the product schema to seven tables, copies current settings, authority, upload, reference, attempt, and active staging facts, and physically drops obsolete tables and columns in the same transaction. Later changes must retain the kind and append every contiguous migration. The one-time discarded pre-launch shapes are not accepted as migration inputs.

`portforward_registry_v2` is the permanent Port Forward and Managed Service lineage. Current version 3 retains the version-2 table shape, including the default opening URL added by the existing 1-to-2 migration, and upgrades TemplateSpec v5 documents to v6 in one atomic 2-to-3 migration. Static opening declarations remain static; retired output-prefix declarations become generic template hooks. The converter exists only in migration code. Template digests are recomputed transactionally while configuration, selected releases, RuntimeBinding, applied instance digests, private-opening references, resources, operation history, and user records remain intact. No supervisor protocol, process-management table, or operation-source field is added.

Fresh databases initialize the current schema. Supported existing version 1 is verified before conversion; migration, version metadata, and target verification commit together or roll back together. Every `portforward_registry_v1` version and any discarded kind, unknown kind, future version, or schema drift is rejected read-only. There is no second baseline reset or user-required state deletion.

State requiring a live external system is not manufactured inside a SQLite migration. Runtime resource identity must already be represented by the current Registry contract and verified by the owning generic driver. Host identity upgrades use their own private journal and native verification after Registry migration; no live-engine guess or database reset substitutes for resource ownership.

## Upstream-owned stores

Floret owns canonical thread storage and its schema lifecycle through the published Runtime APIs. Redeven supplies the configured path and consumes typed readiness or maintenance results; it does not query, patch, version, migrate, or implement SQL fallback for Floret tables.

ReDevPlugin similarly owns stores behind its released registry and host modules. Redeven may select a state root and retain opaque upstream identifiers in product coordination records, but it cannot inspect, duplicate, or migrate upstream content.

Cross-owner migration may use only a public upstream maintenance API. It requires a complete read-only product preflight and idempotent upstream behavior before the local product transaction. Cross-database atomicity is never assumed or simulated by copying upstream lifecycle state into Redeven tables.

# Boundaries

Automatic migration is not permission to accept arbitrary historical shapes. Removing a supported migration requires an explicit minimum-supported-version release decision and matching contract update. A repository-owned pre-release reset is exceptional, user-approved, and permanently closes once its new baseline is distributed.

# Evidence

- `redeven:internal/persistence/sqliteutil/engine.go` - Owns WAL-aware read-only preflight, sidecar restoration, exact initialization, and transactional migrations.
- `redeven:internal/persistence/sqliteutil/engine_test.go` - Covers initialization, rollback, kind, version, metadata, and concurrency rules.
- `redeven:internal/persistence/sqliteutil/repository_contract_test.go` - Locks the reviewed Redeven and upstream SQLite opening inventory.
- `redeven:internal/codeapp/codeapp.go` - Opens product stores before publishing dependent Runtime services.
- `redeven:internal/portforward/registry/schema.go` - Defines the exact `portforward_registry_v2` version-1 shape and document validation consumed by shared preflight.
- `redeven:internal/portforward/registry/registry_test.go` - Covers fresh initialization plus byte-preserving rejection of every v1 version, wrong kinds, future versions, and schema drift.
- `redeven:internal/ai/threadstore/schema.go` - Defines the current AI product lineage and its contiguous migration.
- `redeven:internal/ai/floret_bootstrap.go` - Opens the published Floret Runtime without direct storage access.
- `redeven:scripts/check_floret_dependency_boundary.sh` - Rejects Redeven access to Floret-owned storage schemas and raw SQL.
