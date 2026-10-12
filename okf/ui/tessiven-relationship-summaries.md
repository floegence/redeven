---
type: UI Contract
title: Tessiven relationship summaries
description: Bound group relationship geometry while preserving complete exact relationships and evidence.
tags: [ui, tessiven, graph, performance]
timestamp: 2026-10-11T00:00:00Z
---
# Summary

The shared Tessiven presentation projection owns group relationship summaries.
Collapsed groups show at most four call patterns, not every instance call.
Expanded group headers expose one pool-wide overview. Physical node cards keep
exact relationship rows. All original endpoints, relationship IDs and evidence
remain authoritative; summaries never edit documents or manufacture observations.
Full details remain available through search, node filters and bounded pagination.
Missing visible endpoints suppress previews rather than connecting substitute rows.

# Contract

## Group summaries

Patterns use ordered canonical endpoint identities, endpoint granularity,
relationship kind, exact protocol and locality. Instance endpoints normalize to
their service identities. Equal labels never identify equal services; reverse
calls, different protocols, instance-level observations and logical declarations
remain separate. Non-service endpoints retain their original identities.

Exact host or instance endpoints distinguish local from cross-node relationships.
Service-level declarations remain logical even when their deployments share hosts.
Counts measure distinct authored relationship IDs; co-location does not multiply
a logical declaration. Coverage deduplicates canonical nodes inside the pool, and
every original relationship retains its own evidence.

Collapsed groups preview four patterns and provide an all-patterns action when
needed. Expanded groups show a compact pool overview, while visible physical
cards show their exact rows. The pool overview is independent of expansion and
selected-member state, including the existing selector for pools over 15 nodes.
Shared host appearances cannot multiply counts. The inventory scope filter still
controls whether endpoints outside the selected group's services are included.

Geometry budgets the displayed preview rows and the optional all-patterns action.
Expanded group headers use a fixed budget. Main graph and thumbnail share this
projection; raw relationship volume never expands every group's top padding.

## Interaction and details

Hover and keyboard focus never open a popup. A local summary may draw one service
pattern preview only when both real inventory rows are visible. Logical and
cross-node summaries emphasize visible endpoints without drawing a local route.
Exact physical-card previews continue to follow the original relationship.

Clicking a pattern opens its exact members inside the existing surface-aware
details popup. The complete browser supports node and endpoint search, a node
filter, 50-item pages, back navigation and result counts. Returning from an exact
detail preserves its prior query and page. Every last-page relationship and its
evidence remains reachable; the generic 30-object popup limit is not a substitute
for this browser. Source and target locate actions use canonical endpoints.

Summary-level Ask Flower references the owning group and canonical endpoints;
the all-patterns view references the group. Exact details reference the original
relationship ID. Synthetic summary keys are display identities only, never DSL
objects or Flower references. No list is silently truncated to 100 references.

# Boundaries

Native hosts use the same summary browser and retain the existing single-object
selection callback when an exact relationship is selected.
The native renderer loads the published Floe foundation stylesheet as well as
graph styles; shared floating layers must retain their positioning utilities.

The shared floating layer owns positioning. An open popup measures only its own
dimensions so clamping follows pagination and detail height changes. Closed
details allocate no list DOM. Service-row geometry is observed only during an
active preview. Canonical endpoint indexes and Set-based deduplication bound
repeated-call aggregation without a second persisted graph or local router.

# Evidence

- `internal/tessiven_ui/src/relations.ts` - Canonical endpoint identity, exact counts and summary geometry.
- `internal/tessiven_ui/src/projection.ts` - Whole-pool summaries and exact physical-card projection.
- `internal/tessiven_ui/src/TessivenServiceRelations.tsx` - Bounded patterns and locality-aware previews.
- `internal/tessiven_ui/src/TessivenRelationDetails.tsx` - Complete search, filtering and paged drilldown.
- `internal/tessiven_ui/src/TessivenGraph.tsx` - Shared popup, native selection and exact Flower context.
- `internal/envapp/ui_src/src/styles/tessiven-relation-summary.test.ts` - Canonical semantics and 4–1,000-node geometry regression.
- `internal/envapp/ui_src/src/styles/tessiven-relation-summary.browser.test.tsx` - Last-page access, themes, small windows and native selection.
- `internal/envapp/ui_src/src/styles/tessiven-relation-summary.scale.browser.test.tsx` - Measured projection, layout and pan budgets for 100–1,000-node pools.
- `internal/envapp/ui_src/scripts/checkCanvasRelationRuntime.mjs` - Isolated Runtime and standalone Electron acceptance with immutable stored versions.
- `scripts/check_native_service_canvas.mjs` - Custom-scheme WebKit shared-summary acceptance and exact selection readback.
