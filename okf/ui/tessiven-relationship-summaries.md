---
type: UI Contract
title: Tessiven relationship summaries
description: Bound group relationship geometry while preserving complete exact relationships and evidence.
tags: [ui, tessiven, graph, performance]
timestamp: 2026-10-11T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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
