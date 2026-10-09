---
type: Architecture Contract
title: Tessiven canvas contract
description: Store immutable service canvases in one Runtime-owned library.
tags: [architecture, tessiven, persistence]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Tessiven is the Runtime-owned library of immutable service canvases. Each
canvas stores a complete `redeven.io/tessiven/v1` YAML document and every save
creates a new version. The Runtime is the single owner of canvas data; the
Desktop Welcome surface and the local Env App render that same library. A
failed validation or version conflict leaves the last saved document intact.

# Contract

- A canvas document contains stable IDs for Runtime nodes, visual groups,
  business services, instances, external resources, relations, and evidence.
- Groups are visual membership only. Instance bindings and Runtime references
  are data references and do not grant permission or create a connection. A
  descriptive or unavailable Runtime remains unbound and may only carry an
  explicit `unknown` or `unavailable` observation.
- A physical node may belong to multiple logical groups while retaining one
  stable node ID and one inventory of instances. Optional group `instanceRefs`
  identifies exact project or cluster membership; every referenced instance
  must run on a node in that group's `nodeRefs`. Omitting `instanceRefs` retains
  membership of all instances on those nodes. Rendering replicas never become
  persistent nodes, execution targets, or independent management identities.
- Relations require evidence and may form cycles. Missing observations remain
  explicitly unknown.
- The schema accepts data and presentation hints only. It does not accept
  executable scripts, credentials, arbitrary styles, or management commands.
  Position coordinates express preferred placement, not fixed geometry. Their
  schema describes automatic layout as the default; collision resolution belongs
  to the published renderer under the [canvas UI contract](../ui/tessiven-canvas.md).
  Validation and save success confirm valid persisted data, not visual acceptance.
- Saves use an expected latest version and an idempotent request ID. Flower
  content changes produce complete new versions; history is immutable.
- A fresh empty library receives one fictional example before accepting
  requests. Archived canvases count as existing data, so archiving the example
  does not recreate it on restart. Existing user canvases remain intact.
- UI creation accepts only a request ID and title, and saves an empty first
  version. Network retries return the same canvas. User-authored document
  mutations use the authorized Flower tools, not manual HTTP write routes.
- Historical and archived versions are readable but cannot mutate resources.

# Storage Upgrades

The `tessiven_canvas_library` SQLite lineage starts at schema v1. Schema v2
adds an initially empty `flower_thread_id` to each canvas. Runtime startup
validates the exact historical shape for its recorded version before opening a
writable connection, then automatically migrates v1 to v2 before accepting
requests. Source and target verification, the column addition, schema version,
and migration metadata commit in one transaction. Canvas identities, archive
state, immutable YAML versions, and idempotent request results remain intact.

Migration or verification failure rolls back to the supported source database.
Unknown kinds, future versions, and schema drift fail read-only; they must never
trigger a reset or manual data deletion. Schema errors identify the rejected
object and expected version. A fresh v2 library and an upgraded v1 library must
both reopen successfully.

# Boundaries

The local Runtime owns the SQLite canvas library and immutable version
documents. Desktop and Env App use the same service and do not persist a second
business graph. Pan, zoom, temporary expansion, and selection are browsing
state, not document versions. Canvas references never authorize resource
actions; the [Flower and operations contract](../ai/tessiven-flower-and-operations.md)
owns that boundary. Tessiven does not deploy services, discover targets in the
background, or synchronize libraries between devices.

# Evidence

- `spec/tessiven/v1.schema.json`
- `internal/tessiven/document.go`
- `internal/tessiven/document_test.go` - Shared-node membership validation and YAML round-trip.
- `internal/tessiven/store.go`
- `internal/tessiven/store_test.go`
- `internal/tessiven/schema_test.go` - Historical upgrade, restart, rollback, and read-only rejection.
- `internal/tessiven/onboarding_test.go`
- `internal/codeapp/appserver/tessiven_test.go`
