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

The Runtime interprets the current Tessiven DSL and projects a frozen,
data-only `redeven.io/tessiven-presentation/v1` display model. Native clients
render that model using bundled code. A DSL release does not by itself change
the display format or require a client release. Historical YAML, its digest,
revision identity, write validation and operation authority stay unchanged.
An unsupported source retains verified source for viewing and export but does
not invent topology. Integrity failure returns an error without an exportable
source. No response supplies executable renderer code.

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
