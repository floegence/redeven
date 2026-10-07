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
- The canonical Flower composer stays at the bottom of the canvas. There is no
  editor drawer or additional status bar. Its context chip identifies the visible
  canvas/version and any selected objects.
- Replies, tool activity, questions, approvals and errors use the same Flower
  surface runtime. Its conversation is placed in an upper-left floating window;
  Floe owns dragging, resizing, clamping, maximize/restore and local interaction
  ownership. The composer is excluded from the window's safe boundary.
- Hiding replies leaves the composer and conversation alive. A small restore
  control returns the window; sending reopens it. Hidden replies never acknowledge
  unread output. Narrow layouts fit the available boundary.
- Empty-canvas suggestions and every Ask Flower action focus the composer with
  exact canvas/version/object context. Opening never sends automatically.
- Each canvas retains its draft and selected conversation within the mounted
  surface. The connection's canonical ComposerDraftStore owns text, references
  and attachments; ThreadCache and TransportOutbox retain their existing roles.
  There is no separate editor admission controller or provider state machine.
- Sends freeze the visible selection before asynchronous preparation. Unknown
  delivery retries retain that payload and request identity. Switching objects
  or canvases cannot retarget an in-flight request or its eventual response.
- Settings, permissions, model selection, attachments, stop, approval and retry
  use the native Flower controls. Opening the full conversation is optional.
  Env App readiness keeps the canvas visible and confines recovery controls to
  a bottom card; its wrapper never paints an opaque full-canvas background.
- The visible version supplies the context for subsequent messages, including
  explicit history. Saved-version events update current views only; they do not
  infer completion of a Flower turn.
- The built-in example is identified in its library preview and open canvas.
  It demonstrates topology without claiming actual connections or health.
- Flower saves update a canvas being viewed as current. Explicit historical
  views remain pinned; the user can choose to open the latest version.
- The document viewer and export are read-only. Content changes, including
  renaming and restoring earlier content, are made through Flower.

- Env App exposes Service Canvas as the last Activity entry. Activity navigation
  keeps the regular shell and sidebar mounted; the header has no duplicate
  canvas shortcut. In Workbench, the Service Canvas Dock item follows pinned
  plugin applications and opens a separate Activity window instead of creating
  a Workbench widget.

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
historical version cannot change its management permissions. Ask Flower focuses
the canvas composer and never sends a message automatically.

# Evidence

- `internal/tessiven_ui/src/TessivenPage.tsx`
- `internal/tessiven_ui/src/TessivenLibraryCard.tsx`
- `internal/tessiven_ui/src/TessivenFlowerPanel.tsx`
- `internal/flower_ui/src/FlowerSurface.tsx`
- `internal/tessiven_ui/src/TessivenGraph.tsx`
- `internal/tessiven_ui/src/projection.ts`
- `internal/tessiven_ui/src/tessiven.css`
- `internal/envapp/ui_src/src/styles/tessiven.browser.test.tsx`
- `internal/envapp/ui_src/src/styles/tessiven-library.browser.test.tsx`
- `internal/envapp/ui_src/src/styles/tessiven-flower.browser.test.tsx`
- `internal/envapp/ui_src/src/ui/EnvAppShell.tsx`
- `internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx`
- `internal/envapp/ui_src/src/ui/envSidebarVisibilityMotion.ts`
