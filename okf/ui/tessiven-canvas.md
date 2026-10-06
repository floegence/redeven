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

- The library uses one toolbar with search, direct creation, and a secondary
  menu for archived canvases. It has no extra heading, archive tab, or status
  bar. New canvas immediately creates and opens an empty saved canvas.
- Flower opens a dedicated canvas editor beside the graph, without a bottom
  dock or a generic launcher window. It shows the selected object and version,
  a draft input, and a link to the accepted conversation. At narrow widths it
  temporarily occupies the content area; closing restores the canvas and focus.
- Empty-canvas suggestions and every Ask Flower action prepare this editor with
  exact canvas/version/object context. Opening never sends automatically.
- Sending stays on the canvas. Further messages use the accepted thread identity.
  Saved-version events show the actual version summary and a change-comparison
  link. They do not infer a completed Flower turn. Complete replies and approvals remain in the canonical Flower conversation;
  an acceptance receipt never implies that canvas changes have completed.
- Drafts and unknown-delivery requests survive closing the editor and switching
  canvases within the mounted surface. The shared Flower launcher controller
  owns request identity, IME handling, and unknown-delivery retry. Unknown
  requests keep their original prompt and selection even when another object
  is selected. There is no second thread lifecycle or operation state machine.
- The editor follows the visible version for subsequent messages, including
  explicit history. A send already in flight or awaiting delivery confirmation
  retains its original context until resolved.
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
the canvas editor and never sends a message automatically.

# Evidence

- `internal/tessiven_ui/src/TessivenPage.tsx`
- `internal/tessiven_ui/src/TessivenLibraryCard.tsx`
- `internal/tessiven_ui/src/TessivenFlowerPanel.tsx`
- `internal/flower_ui/src/FlowerTurnLauncherWindow.tsx`
- `internal/tessiven_ui/src/TessivenGraph.tsx`
- `internal/tessiven_ui/src/projection.ts`
- `internal/tessiven_ui/src/tessiven.css`
- `internal/envapp/ui_src/src/styles/tessiven.browser.test.tsx`
- `internal/envapp/ui_src/src/styles/tessiven-library.browser.test.tsx`

- `internal/envapp/ui_src/src/styles/tessiven-flower.browser.test.tsx`
