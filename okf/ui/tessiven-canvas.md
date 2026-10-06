---
type: UI Contract
title: Tessiven canvas
description: Render progressively detailed service topology and exact object context.
tags: [ui, tessiven, graph]
timestamp: 2026-10-06T00:00:00Z
---
# Summary

Tessiven presents one progressively detailed canvas for understanding where
business services run. Solid Runtime node cards sit inside tinted dashed visual
groups; external dependencies use a separate card treatment. Edges are muted
until a related group or object is focused. Wheel zoom and drag pan belong to
the canvas, while object details and the read-only document remain normal selectable
text. Flower is the editing surface; the canvas has no manual content editor.

# Contract

- The library shows canvas previews, search, and active/archive filters. New
  canvas immediately creates and opens an empty saved canvas without a form.
- A persistent Flower entry includes the current canvas/version context. Empty
  canvases offer code and connected-service prompts through the same launcher.
  These shortcuts prepare a draft and do not send it. The owning surface supplies
  a localized opening question through the shared launcher intent; it is
  presentation copy and never becomes execution authority.
- The built-in example is identified in its library preview and open canvas.
  It demonstrates topology without claiming actual connections or health.
- Flower saves update a canvas being viewed as current. Explicit historical
  views remain pinned; the user can choose to open the latest version.
- The document viewer and export are read-only. Content changes, including
  renaming and restoring earlier content, are made through Flower.

- Up to 15 Runtime nodes in a group are shown individually. Larger groups use
  a name or ordinal selector and render only the selected node's details.
- Clicking opens object details. Hover tracks related edges without opening
  explanatory UI; right-click, keyboard context menu, and touch context entry
  open Ask Flower with the exact immutable canvas/version selection.
- Layout hints are read from the saved document and applied only to visible
  graph objects; hidden members retain their hints for later expansion.
- Theme tokens, high contrast, product locale, and accessible names are used
  for every card, edge, menu, and action.

# Boundaries

The released Floe graph component owns pan, zoom, routing, layout, focus, and
floating-layer mechanics. Redeven owns the Tessiven projection and business
data. The graph renders the [saved version document](../architecture/tessiven-canvas-contract.md)
without introducing independent topology state. Selecting a node, group, or
historical version cannot change its management permissions. Ask Flower opens
the existing input launcher and never sends a message automatically.

# Evidence

- `internal/tessiven_ui/src/TessivenPage.tsx`
- `internal/tessiven_ui/src/TessivenLibraryCard.tsx`
- `internal/tessiven_ui/src/TessivenGraph.tsx`
- `internal/tessiven_ui/src/projection.ts`
- `internal/tessiven_ui/src/tessiven.css`
- `internal/envapp/ui_src/src/styles/tessiven.browser.test.tsx`
- `internal/envapp/ui_src/src/styles/tessiven-library.browser.test.tsx`
