---
type: Architecture Contract
title: Tessiven canvas contract
tags: [architecture, tessiven, persistence]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime owns immutable Tessiven service canvases: each save creates a version containing complete v1.1.0 YAML. Desktop Welcome and local Env App render the same library. Validation/version conflict preserves the last saved document; clients hold no separate canonical library.

# Contract

- A canvas document contains stable IDs for Runtime nodes, visual groups,   business services, instances, external resources, relations, and evidence. - Every service has at least one instance on an existing node. A missing   placement fails validate/save at the service ID with a source location. - A service kind describes its primary responsibility independently of its   product name, instance role or deployment format. The [DSL versioning contract](tessiven-dsl-versioning.md)   owns version selection, read projections and write upgrades.

The `tessiven_canvas_library` SQLite lineage starts at schema v1. Canvas identities, archive state, immutable YAML versions, and idempotent request results remain intact.

A fresh v2 library and an upgraded v1 library must both reopen successfully.

# Boundaries

The local Runtime owns the SQLite canvas library and immutable version documents. Canvas references never authorize resource actions; the [Flower and operations contract](../ai/tessiven-flower-and-operations.md) owns that boundary. Tessiven does not deploy services, discover targets in the background, or synchronize libraries between devices.

# Evidence

- `spec/tessiven/v1.1.0.schema.json`

- `internal/tessiven/document.go`

- `internal/tessiven/document_test.go` - Tests.
