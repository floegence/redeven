---
type: UI Contract
title: Tessiven relationship summaries
tags: [ui, tessiven, graph, performance]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Shared Tessiven projection summarizes group relationships: at most four collapsed patterns, one expanded pool overview and exact physical-node rows. Canonical endpoints, IDs and evidence remain unchanged. Search, filters and paging expose detail; missing visible endpoints suppress previews without substitutes.

# Contract

## Group summaries
Patterns use ordered canonical endpoint identities, endpoint granularity, relationship kind, exact protocol and locality.

Main graph and thumbnail share this projection; raw relationship volume never expands every group's top padding.

## Interaction and details
Hover and keyboard focus never open a popup.

No list is silently truncated to 100 references.

# Boundaries

Native hosts use the same summary browser and retain the existing single-object selection callback when an exact relationship is selected. The native renderer loads the published Floe foundation stylesheet as well as graph styles; shared floating layers must retain their positioning utilities.

Canonical endpoint indexes and Set-based deduplication bound repeated-call aggregation without a second persisted graph or local router.

# Evidence

- `internal/tessiven_ui/src/relations.ts` - Canonical endpoint identity, exact counts and summary geometry.

- `internal/tessiven_ui/src/projection.ts` - Whole-pool summaries and exact physical-card projection.

- `internal/tessiven_ui/src/TessivenServiceRelations.tsx` - Bounded patterns and locality-aware previews.
