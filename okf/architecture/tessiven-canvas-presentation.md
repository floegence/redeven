---
type: Architecture Contract
title: Tessiven stable canvas presentation
description: Render validated canvas data through an independently frozen client display contract.
tags: [architecture, tessiven, compatibility, native]
timestamp: 2026-10-12T00:00:00Z
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

Under `/_redeven_proxy/api/tessiven`, `GET /presentation-contract` returns
`formats` and `capabilities`. `GET /canvases/{id}/versions/{latest|number}/presentation`
requires an exact `format` and accepts a comma-separated `capabilities` list.
Both are authenticated read routes. Capability names are unique lowercase
letters, digits and underscores, at most 64 characters each and 16 entries.
Unknown well-formed capabilities are ignored rather than treated as authority.
Unknown display formats return `TESSIVEN_PRESENTATION_UNSUPPORTED`.

The response contains `canvas` and `version` from one database read snapshot.
The version retains original `document_yaml`, `digest`, creation metadata,
DSL/migration metadata and the exact canvas revision. Its `view` contains
`format`, `model`, negotiated `capabilities` and `compatibility`. The original
digest never denotes the display projection. The existing revision route keeps
its canonical current `document` and its original failure semantics.

`model` has no DSL identity. It explicitly maps the seven existing object
collections, accurate references, observations, bindings and layout hints.
`objects` provides fixed generic cards with a title, kind, optional description,
plain label/value facts and exact business `objectRefs`. These fields never
carry HTML, code, expressions, styles or platform action definitions.
The initial optional `group_layouts` capability enables authored group packing;
without it automatic layout preserves the same memberships and relationships.

## Compatibility And Authority

The frozen schema is independent of the DSL registry. Existing display meanings
must not change in place. Every new DSL vocabulary requires an explicit reviewed
mapping to the oldest supported display contract. A new optional display
capability may be omitted only when factual meaning remains accurate. Major
display changes retain the supported old format until an explicit client
compatibility-window decision removes it.

`compatibility.status` is `complete`, `limited` or `unavailable`.
`limitations` identifies a code, affected object references and an optional
feature. The stable interaction names are `flower` and `resource_actions`;
these are distinct from optional display capabilities. A limitation without a
feature restricts every operation on its affected objects. Clients offer only
known, bundled interactions: an unknown feature name never introduces an action.
Limited mappings preserve accurate browsing and restrict affected interactions.
Unavailable mappings must not render a misleading relationship graph. Native clients keep source, history and navigation recovery available.
The current Runtime's unreadable-source response is `unavailable` with
`source_unreadable`; it contains only verified source and safe title metadata.

Selections refer to actual business identities; renderer-only duplicate host
identities do not become operation targets. Presentation mappings and generic
cards grant no resource authority. Resource requests continue to read the
original version, check exact bindings and enforce current permissions.

# Boundaries

One normalized snapshot drives graph, object selection, compact summaries,
details and Flower references. Graph projection, layout and touch behavior use
the shared renderer. Native manifests declare display formats, optional
capabilities and a finite legacy DSL adapter list alongside hashes, licenses
and source provenance. Native bridges receive display data and revision
identity, never historical YAML, credentials or downloaded renderer code.

Only an explicit not-found response for the contract route permits a legacy
adapter. Authentication, rate limits, network failures, missing canvases,
corruption and failed presentation reads never trigger legacy fallback.
The adapter accepts only reviewed frozen old formats and feeds the same
display pipeline. Remove it as one unit when the minimum supported Env
version is explicitly raised; do not extend it for future DSL versions.

Each DSL release verifies its mapping against the frozen oldest supported
display schema and a fixed client artifact. Native acceptance records the
Runtime commit, App commit, renderer provenance and negotiated format, so
an older Runtime cannot accidentally qualify a newer compatibility claim.

# Evidence

- `spec/tessiven-presentation/v1.schema.json` - Frozen data-only display shape.
- `internal/tessiven/presentation.go` - Explicit projection and atomic source read.
- `internal/tessiven/dsl_version_test.go` - Historical identity and frozen-schema checks.
- `internal/codeapp/appserver/tessiven.go` - Read authorization and negotiation.
- `internal/tessiven_ui/src/presentation.ts` - Shared rendering boundary.
- `internal/tessiven_ui/src/native/entry.tsx` - Bundled native display input.
