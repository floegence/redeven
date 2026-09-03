---
type: Architecture Contract
title: Database schema migration ownership
description: Redeven automatically migrates product databases at startup while upstream-owned stores remain opaque.
tags: [architecture, storage, sqlite, migrations, upgrades]
timestamp: 2026-09-03T00:00:00Z
---
# Summary

- Authority: each repository migrates the schemas it owns; Redeven owns product databases, while Floret and ReDevPlugin own their internal stores.
- Outcome: each Redeven product store opens through an exact versioned schema contract before the dependent service accepts requests.
- Invariants: released migration lineages are contiguous, atomic, verified, and data-preserving; future, drifted, wrong-kind, and unsupported inputs fail read-only.
- Failure boundary: a failed migration stops the affected service with the previous supported database intact; Redeven never patches an upstream database or silently replaces an incompatible product database.

# Contract

## Redeven-owned stores

Each SQLite store declares a stable database kind, current version, supported minimum version, ordered `n -> n+1` migrations, and a final exact verifier. Opening serializes migration access, verifies kind and source shape, applies all required steps, updates metadata, verifies the target, and commits once. A fresh store may initialize at the current version. Writable pragmas and service startup occur only after the read-only preflight accepts an existing file.

Migration and verification failure rolls back. Wrong kind, unknown or future version, missing migration edge, unversioned non-empty file, document digest mismatch, or exact schema drift is rejected without deletion, rename-aside, heuristic repair, partial write, or replacement. Every new version adds tests for fresh initialization, each new edge, user-record preservation, rollback, drift, future versions, and repeated current opens.

The current startup composition opens product stores such as Code App, Port Forward, thread read state, Notes, Workbench layout, Terminal Group Catalog, and release trust before returning their owning services. AI readiness may isolate its own product-store failure from unrelated Code App capabilities, but it follows the same ownership and migration rules.

`ai_threadstore_product_v1` is the permanent AI product lineage. Its exact version-1 input upgrades through the reviewed version-2 edge; later changes must retain the kind and append every contiguous migration. The one-time discarded pre-launch shapes are not accepted as migration inputs.

`portforward_registry_v1` version 1 is likewise a user-approved pre-release baseline reset. It initializes Port Forward and Managed Service tables together, including configuration, release identity, RuntimeBinding, resources, operation progress, and retry lineage. Version 2 is its first permanent forward edge: it upgrades TemplateSpec v3 documents to v4, removes duplicated version columns, and adds digest-verified release-check summaries in the same transaction. Version 3 adds workspace ownership and explicit workspace-deletion intent with conservative existing-service defaults. Version 4 atomically upgrades release-check documents to schema v2, retains known latest identities and timestamps, and marks their incomplete catalog stale until progressive discovery refreshes it. The kind intentionally has no decoder from discarded pre-release Registry kinds. It is permanent and every later change must append a contiguous automatic migration; another pre-release reset is not allowed.

State requiring a live external system is not manufactured inside a SQLite migration. Runtime resource identity must already be represented by the current Registry contract and verified by the owning generic driver. No marker import, live-engine guess, or cross-system adoption path supplements the fresh Port Forward Registry.

## Upstream-owned stores

Floret owns canonical thread storage and its schema lifecycle through the published Runtime APIs. Redeven supplies the configured path and consumes typed readiness or maintenance results; it does not query, patch, version, migrate, or implement SQL fallback for Floret tables.

ReDevPlugin similarly owns stores behind its released registry and host modules. Redeven may select a state root and retain opaque upstream identifiers in product coordination records, but it cannot inspect, duplicate, or migrate upstream content.

Cross-owner migration may use only a public upstream maintenance API. It requires a complete read-only product preflight and idempotent upstream behavior before the local product transaction. Cross-database atomicity is never assumed or simulated by copying upstream lifecycle state into Redeven tables.

# Boundaries

Automatic migration is not permission to accept arbitrary historical shapes. Removing a supported migration requires an explicit minimum-supported-version release decision and matching contract update. A repository-owned pre-release reset is exceptional, user-approved, and permanently closes once its new baseline is distributed.

# Evidence

- `redeven:internal/persistence/sqliteutil/engine.go` - Runs exact Redeven schema initialization and transactional migrations.
- `redeven:internal/persistence/sqliteutil/engine_test.go` - Covers initialization, rollback, kind, version, metadata, and concurrency rules.
- `redeven:internal/persistence/sqliteutil/repository_contract_test.go` - Locks the reviewed Redeven and upstream SQLite opening inventory.
- `redeven:internal/codeapp/codeapp.go` - Opens product stores before publishing dependent Runtime services.
- `redeven:internal/portforward/registry/schema.go` - Defines exact v1-v4 shapes plus every contiguous atomic edge.
- `redeven:internal/portforward/registry/registry.go` - Performs read-only Port Forward Registry preflight before writable open.
- `redeven:internal/portforward/registry/registry_test.go` - Covers fresh initialization, v1-to-v2 data preservation, and byte-preserving kind, future, and drift rejection.
- `redeven:internal/ai/threadstore/schema.go` - Defines the current AI product lineage and its contiguous migration.
- `redeven:internal/ai/floret_bootstrap.go` - Opens the published Floret Runtime without direct storage access.
- `redeven:scripts/check_floret_dependency_boundary.sh` - Rejects Redeven access to Floret-owned storage schemas and raw SQL.
