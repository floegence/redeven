---
type: Architecture Contract
title: Tessiven stable canvas presentation
tags: [architecture, tessiven, compatibility, native]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime projects DSL into frozen data-only presentation/v1 for bundled renderers. DSL releases require no display-format/client changes. Preserve YAML/digest/revision/write authority; unsupported source remains viewable/exportable without guessed topology, but integrity failure cannot export.

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

- `internal/tessiven/presentation.go` - Source.

- `internal/tessiven/dsl_version_test.go` - Tests.
