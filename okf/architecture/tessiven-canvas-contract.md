---
type: Architecture Contract
title: Tessiven canvas contract
description: Store immutable service canvases in one Runtime-owned library.
tags: [architecture, tessiven, persistence]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Tessiven is the Runtime-owned library of immutable service canvases. Each
canvas stores a complete `redeven.io/tessiven/v1.1.0` YAML document and every save
creates a new version. The Runtime is the single owner of canvas data; the
Desktop Welcome surface and the local Env App render that same library. A
failed validation or version conflict leaves the last saved document intact.

# Contract

- A canvas document contains stable IDs for Runtime nodes, visual groups,   business services, instances, external resources, relations, and evidence. - Every service has at least one instance on an existing node. A missing   placement fails validate/save at the service ID with a source location. - A service kind describes its primary responsibility independently of its   product name, instance role or deployment format. The [DSL versioning contract](tessiven-dsl-versioning.md)   owns version selection, read projections and write upgrades.

The `tessiven_canvas_library` SQLite lineage starts at schema v1. Canvas identities, archive state, immutable YAML versions, and idempotent request results remain intact.

A fresh v2 library and an upgraded v1 library must both reopen successfully.

# Boundaries

The local Runtime owns the SQLite canvas library and immutable version documents. Canvas references never authorize resource actions; the [Flower and operations contract](../ai/tessiven-flower-and-operations.md) owns that boundary. Tessiven does not deploy services, discover targets in the background, or synchronize libraries between devices.

# Evidence

- `spec/tessiven/v1.1.0.schema.json`

- `internal/tessiven/document.go`

- `internal/tessiven/document_test.go` - Shared-node membership validation and YAML round-trip.
