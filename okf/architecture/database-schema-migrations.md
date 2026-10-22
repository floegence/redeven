---
type: Architecture Contract
title: Database schema migration ownership
description: Redeven automatically migrates product databases at startup while upstream-owned stores remain opaque.
tags: [architecture, storage, sqlite, migrations, upgrades]
timestamp: 2026-09-04T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: each repository migrates the schemas it owns; Redeven owns product databases, while Floret and ReDevPlugin own their internal stores.
- Outcome: each Redeven product store opens through an exact versioned schema contract before the dependent service accepts requests.
- Invariants: released migration lineages are contiguous, atomic, verified, and data-preserving; existing-file preflight reads the complete SQLite main-plus-WAL view, while future, drifted, wrong-kind, and unsupported inputs fail without changing database files or sidecars.
- Failure boundary: a failed migration stops the affected service with the previous supported database intact; Redeven never patches an upstream database or silently replaces an incompatible product database.

# Contract

## Redeven-owned stores
Each SQLite store declares a stable database kind, current version, supported minimum version, ordered `n -> n+1` migrations, an existing-schema validator, and a final exact verifier.

Migration and verification failure rolls back.

Host identity upgrades use their own private journal and native verification after Registry migration; no live-engine guess or database reset substitutes for resource ownership.

## Upstream-owned stores
Floret owns canonical thread storage and its schema lifecycle through the published Runtime APIs.

Cross-database atomicity is never assumed or simulated by copying upstream lifecycle state into Redeven tables.

# Boundaries

Automatic migration is not permission to accept arbitrary historical shapes. A repository-owned pre-release reset is exceptional, user-approved, and permanently closes once its new baseline is distributed.

# Evidence

- `redeven:internal/persistence/sqliteutil/engine.go` - Owns WAL-aware read-only preflight, sidecar restoration, exact initialization, and transactional migrations.

- `redeven:internal/persistence/sqliteutil/engine_test.go` - Covers initialization, rollback, kind, version, metadata, and concurrency rules.

- `redeven:internal/persistence/sqliteutil/repository_contract_test.go` - Locks the reviewed Redeven and upstream SQLite opening inventory.
