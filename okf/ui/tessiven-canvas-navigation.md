---
type: UI Contract
title: Tessiven canvas navigation and rendering
tags: [ui, tessiven, graph, performance]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floe owns layout, routing and viewport painting; Tessiven provides topology, controls and palette. Folding/filtering never rewrites documents. Canonical relationships remain inspectable while only the selected scope paints. Worker/data failures stay visible, retaining the last valid scene during ordinary view changes.

# Contract

## Layout and routing
Automatic layout and library thumbnails use the same published Floe layout engine, direction, layers, and visibility projection. Saved positions guide ordering within a layer and never override its rank. Positioned objects without relationships still contribute their actual world bounds, so fitting a newly mapped or isolated node keeps it inside the viewport.

## Connection scopes
Default browsing shows one directed overview connector per root endpoint pair. Group-internal relationships remain in the canonical pool overview and never create a group self-loop.

The interactive overview and library thumbnails always paint the root overview, even while the main canvas shows a focused host's detailed paths.

## Controls and rendering
- Canvas controls expand or collapse all logical groups in one compact reflow. They preserve the selected visible object, or its enclosing group when hidden,   and never create a document version. Large-graph   qualification measures actual host counts, including groups of ten   so a thousand-host fixture never silently measures only aggregate cards.

# Boundaries

The saved canvas contract owns topology and versions; these browsing controls change only the visible scene. Tessiven does not replace worker failures with guessed routes or use viewport culling to alter the complete inspectable model.

# Evidence

- `internal/tessiven_ui/src/TessivenGraph.tsx` - Source.

- `internal/tessiven_ui/src/connections.ts` - Source.

- `internal/tessiven_ui/src/projection.ts` - Source.
