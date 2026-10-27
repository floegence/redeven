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

Each repository migrates its own stores: Redeven product data, Floret and ReDevPlugin internals. Open validates the complete SQLite/WAL view before service admission. Contiguous atomic migrations preserve data; future, drifted, wrong-kind or unsupported inputs remain untouched. Failure stops the affected service, never patches upstream data or replaces a database.

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
