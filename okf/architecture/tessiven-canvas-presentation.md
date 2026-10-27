---
type: Architecture Contract
title: Tessiven stable canvas presentation
description: Render validated canvas data through an independently frozen client display contract.
tags: [architecture, tessiven, compatibility, native]
timestamp: 2026-10-12T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime projects current DSL into frozen data-only redeven.io/tessiven-presentation/v1; clients use bundled renderers. DSL releases do not change display format or require client updates. Preserve historical YAML, digest/revision and write authority. Unsupported source remains viewable/exportable without invented topology; integrity failure has no export. Never return executable code.

# Contract

## Read And Negotiation
Under `/_redeven_proxy/api/tessiven`, `GET /presentation-contract` returns `formats` and `capabilities`. Unknown well-formed capabilities are ignored rather than treated as authority.

The initial optional `group_layouts` capability enables authored group packing; without it automatic layout preserves the same memberships and relationships.

## Compatibility And Authority
The frozen schema is independent of the DSL registry. Existing display meanings must not change in place.

Resource requests continue to read the original version, check exact bindings and enforce current permissions.

# Boundaries

One normalized snapshot drives graph, object selection, compact summaries, details and Flower references. Native bridges receive display data and revision identity, never historical YAML, credentials or downloaded renderer code.

Removing a supported display format requires an explicit client compatibility-window decision; a DSL release cannot remove it incidentally.

# Evidence

- `spec/tessiven-presentation/v1.schema.json` - Frozen data-only display shape.

- `internal/tessiven/presentation.go` - Explicit projection and atomic source read.

- `internal/tessiven/dsl_version_test.go` - Historical identity and frozen-schema checks.
