---
type: UI Contract
title: Tessiven canvas navigation and rendering
description: Browse compact service topology with shared layouts and bounded route painting.
tags: [ui, tessiven, graph, performance]
timestamp: 2026-10-11T00:00:00Z
---
# Summary

Published Floe owns layout, routing, viewport interaction and route painting.
Tessiven supplies canonical topology projection, localized view controls and
palette. Folding, filtering and navigation never rewrite a saved document.
Complete paths remain inspectable while offscreen geometry cannot expand the
painted SVG layer. Invalid graph data or actual worker failures stay visible;
view changes retain the last valid scene until the next layout is ready.

# Layout and routing

Automatic layout and library thumbnails use the same published Floe layout
engine, direction, layers, and visibility projection. Documents may declare
ordered root layers for stable left-to-right, right-to-left, top-to-bottom, or
bottom-to-top structure; unassigned roots join the nearest related layer, and
disconnected components follow deterministically. Independent members remain
readable peers inside their dashed logical group. Saved positions guide ordering
within a layer and never override its rank. Folding and expanding compact only
the visible subgraph, retain a visible selection and its world-coordinate anchor,
and anchor its containing group when the selection becomes hidden. Subsequent
host selection stays compact for that mounted canvas. The viewport center stays
unchanged, and hidden members do not contribute to bounds. Browsing
never rewrites saved hints or creates document versions. Relations retain their
original endpoints and ports; grouping never invents a relationship. Invalid
graph data and actual worker/routing failures remain visible errors.
Published Floe jointly routes packed and positioned relationships orthogonally.
Free anchors can use the available spans of all four node and dashed-group
borders, favor nearby facing spans, and separate parallel paths into lanes.
Automatic anchors include corridors alongside obstacles; the published router
chooses their borders jointly so independent calls can reach unused group spans
without being forced across each other. Automatic endpoint lanes separate
shared segments without changing explicit port or self-loop constraints.
Routes avoid intervening cards and unrelated group frames. Explicit port sides,
relationship identities, and canonical endpoints remain unchanged. Dense
cross-layer topologies can still require crossings; hover and focus isolate
related routes without hiding relationships from the saved document.
Positioned objects without relationships still contribute their actual world
bounds, so fitting a newly mapped or isolated node keeps it inside the viewport.

# Controls and rendering

- Canvas controls expand or collapse all logical groups in one compact reflow.
  They preserve the selected visible object, or its enclosing group when hidden,
  and never create a document version. The default inventory remains all host
  services; an explicit canvas selector can show only the current group's exact
  instance membership. Ungrouped hosts retain all services. Local relationship
  rows whose service endpoints are filtered out are hidden in that view only;
  canonical references and external relationships remain unchanged. This scope
  is retained with the current canvas browse state, not persisted in its DSL.
- The interactive overview uses the exact current layout and viewport, including
  collapse and service filtering. Drag its viewport rectangle to pan, click the
  overview to center, or use arrow keys and Home. The overview shares the main
  canvas's four logical-group tones, host fill, and network/storage resource
  colors through the published node-style callback. Theme variables update both
  surfaces together, including attribute-only native dark themes. Equal styles
  share SVG paths, so overview DOM size depends on the palette rather than the
  number of hosts. Forced colors use system fills and outlines. Floe owns
  navigation and compact SVG rendering; Tessiven supplies its localized
  accessible name and product palette.
- Canvas controls form one compact, theme-aware bottom toolbar: fit, zoom,
  view options and canvas actions. The view menu owns expand/collapse all groups
  and the mutually exclusive host-service scope. It uses Floe's projected
  floating-layer placement and keyboard navigation; narrow canvases retain
  accessible icon controls and move the overview above the toolbar.
- Complete packing and routing run off the renderer thread. Nodes and routes
  outside the viewport are culled without discarding canonical graph records.
  Floe clips route painting to viewport bounds plus overscan while retaining
  complete world-space paths, so remote endpoints cannot enlarge the composited
  SVG layer. Pointer qualification measures actual drags at overview and detail
  zoom for 100, 500 and 1,000 physical hosts, with frame, long-task and
  pointer-following budgets; keyboard overview navigation alone is insufficient.
  Production qualification serves built assets and verifies the complete layout
  worker, child ELK worker and raw WASM resource closure. Large-graph
  qualification measures actual host counts, including groups of ten
  so a thousand-host fixture never silently measures only aggregate cards.

# Evidence

- `internal/tessiven_ui/src/TessivenGraph.tsx` - Controlled graph projection, view controls and browse state.
- `internal/tessiven_ui/src/projection.ts` - Canonical identities, visibility and layer mapping.
- `internal/tessiven_ui/src/TessivenThumbnail.tsx` - Shared library layout projection.
- `internal/envapp/ui_src/scripts/checkTessivenPan.mjs` - Actual pointer drags at overview and detail zoom with frame, long-task and coordinate-following budgets.
- `internal/envapp/ui_src/src/styles/tessiven-controls.browser.test.tsx` - Every theme, narrow/short surfaces and projected menu interaction.
- `internal/envapp/ui_src/src/styles/tessiven-scale.browser.test.tsx` - Complete 100, 500 and 1,000 physical host projection and worker qualification.
