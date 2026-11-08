---
type: Architecture Contract
title: Tessiven immutable canvases, DSL and display compatibility
tags: [architecture, tessiven, persistence]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Runtime owns immutable canvas YAML and contiguous version migration; clients render a frozen data-only display contract. The `tessiven_canvas_library` SQLite lineage starts at schema v1. Paths must be unique, acyclic and complete, with source validation, target validation and semantic checks.

# Contract

## Canvas storage
- A canvas document contains stable IDs for Runtime nodes, visual groups, business services, instances, external resources, relations, and evidence.
- Every service has at least one instance on an existing node. A missing placement fails validate/save at the service ID with a source location.
- A service kind describes its primary responsibility independently of its product name, instance role or deployment format. The [DSL versioning contract](#dsl-versions) owns version selection, read projections and write upgrades.

Canvas identities, archive state, immutable YAML versions, and idempotent request results remain intact.

The v1 → v2 → v3 library lineage preserves immutable versions and request
receipts. v3 records canvas conversation ownership in `flower_threads`, backfills
exact v2 `flower_thread_id` bindings, and retains that existing column as the
sole active conversation pointer. A thread has one canvas owner; ambiguous
historical bindings fail transactionally without mutating source state. New
conversations and forks retain every ownership row and select one active root.
Selection updates that single pointer atomically; it never deletes old journals.
Redeven serializes selection and run admission by canvas, reads canonical Floret
activity, queued work, interactions, host work and descendants before switching,
and rejects switching until the active conversation's work has settled. An idle
conversation can be reactivated without losing its history. Replayed creation
receipts never reactivate an older conversation.
Fresh, upgraded and reopened stores use the same verified schema. Floret journals
remain opaque and unchanged.

## DSL versions
The contiguous v1→v1.0.0→v1.1.0 chain changes version only and retains legacy layout. New canvases use v1.1.0; invalid/unknown/failed migration remains unchanged for explicit repair. Reads preserve YAML/digest/revision; writes create current snapshots.

### Version Identities And Releases
DSL identities use stable `vMAJOR.MINOR.PATCH` strings, for example `v1.2.3`.

Do not introduce a schema-only registry entry without its executable migration and fixtures.

### Read Compatibility
Validation selects the exact source schema, applies the explicit upgrade chain, and validates the current shape and cross-object contracts. Returned `document` is canonical current data.

The [canvas contract](#canvas-storage) owns those semantic rules.

Native rendering uses the independently frozen [canvas presentation contract](#display-projection), not the current DSL identity. Every DSL release must verify its explicit mapping to the oldest supported display contract without rewriting source or granting resource authority.

Ordinary edits valid in the original schema continue to upgrade automatically; no historical YAML is rewritten.

## Display projection
Unsupported source remains viewable/exportable without guessed topology; integrity failure forbids export.

### Read And Negotiation
Under `/_redeven_proxy/api/tessiven`, `GET /presentation-contract` returns `formats` and `capabilities`. Unknown well-formed capabilities are ignored rather than treated as authority.

The initial optional `group_layouts` capability enables authored group packing; without it automatic layout preserves the same memberships and relationships.

### Compatibility And Authority
The frozen schema is independent of the DSL registry. Existing display meanings must not change in place.

Resource requests continue to read the original version, check exact bindings and enforce current permissions.

# Boundaries

The local Runtime owns the SQLite canvas library and immutable version documents. Canvas references never authorize resource actions; the [Flower and operations contract](../ai/tessiven-runtime-operations.md#flower-document-tools) owns that boundary. Tessiven does not deploy services, discover targets in the background, or synchronize libraries between devices.

### New Snapshots And Failure Boundary
Creation, imports, full save and exact edits write the current DSL. Existing history is never bulk-rewritten.

The [canvas storage contract](#canvas-storage) continues to own atomic startup database upgrades independently.

One normalized snapshot drives graph, object selection, compact summaries, details and Flower references. Native bridges receive display data and revision identity, never historical YAML, credentials or downloaded renderer code.

Removing a supported display format requires an explicit client compatibility-window decision; a DSL release cannot remove it incidentally.

# Evidence

- `spec/tessiven/v1.1.0.schema.json`
- `internal/tessiven/document.go`
- Tests.

- Exact formats, current identity and forward edges.
- Frozen legacy schema.
- Frozen semantic baseline schema.

- Frozen data-only display shape.
- Source.
- Tests.
