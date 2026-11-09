---
type: Architecture Contract
title: Database schema migration ownership
tags: [architecture, storage, sqlite, migrations, upgrades]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Each repository migrates its own opaque stores. Validate full SQLite/WAL before readiness; contiguous atomic edges preserve records. Future, drifted, wrong-kind or unsupported state remains untouched. Failure blocks only its service without upstream repair or database replacement.

# Contract

## Redeven-owned stores
Each SQLite store declares a stable database kind, current version, supported minimum version, ordered `n -> n+1` migrations, an existing-schema validator, and a final exact verifier.

Migration and verification failure rolls back.

The process-locked redeven_automation store migrates local schema 1 grants to publication-version keys, then schema 2 to 3 recovers published_revision from retained definitions. Changed drafts remain unpublished; grants, runs and private platform bindings are preserved. The adjacent scheduler database remains upstream-owned.

Host identity upgrades use their own private journal and native verification after Registry migration; no live-engine guess or database reset substitutes for resource ownership.

## Upstream-owned stores
Floret owns canonical thread storage and its schema lifecycle through the published Runtime APIs.

Cross-database atomicity is never assumed or simulated by copying upstream lifecycle state into Redeven tables.

# Boundaries

Automatic migration is not permission to accept arbitrary historical shapes. A repository-owned pre-release reset is exceptional, user-approved, and permanently closes once its new baseline is distributed.

# Evidence

- `redeven:internal/persistence/sqliteutil/engine.go` - Source.
- `redeven:internal/persistence/sqliteutil/engine_test.go` - Tests.
