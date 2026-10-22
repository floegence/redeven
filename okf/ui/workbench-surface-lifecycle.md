---
type: UI Contract
title: Workbench surface lifecycle
description: Selection presentation, recovery ownership, lazy widgets, and shared floating surfaces.
tags: [ui, workbench, lifecycle, keep-alive]
timestamp: 2026-09-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Workbench keeps widget identity and state stable while Dock navigation, visual selection, input routing, committed activation, lazy feature loading, and connection recovery follow explicit presentation ownership. Floe Webapp owns generic Dock focus cycling; Redeven selects that mode and persists no competing visibility state. A selected Terminal's declared local scroll viewport owns pointer wheel input without requiring terminal DOM focus, while unselected widgets remain under Canvas ownership. Recovery is mounted above the canvas and makes retained content inert instead of creating per-widget reconnect state. Pointer-anchored overlays use the shared surface layer, and lazy module delivery cannot replace permission, keep-alive, or lifecycle contracts.

# Contract

## Mechanism
[Page loading continuity](page-loading-continuity.md) owns initial presentation. Each lazy widget has its own Suspense boundary and uses the same page declaration as Activity; module delivery cannot suspend the surrounding canvas.

Its product target snapshot and terminal anchor opt-out are owned by that contract; the shared widget lifecycle remains unchanged.

# Boundaries

Lazy loading is a module-delivery boundary only. It must not pre-mount inactive Workbench features, eagerly initialize Flower providers, or weaken existing permission, state restoration, input ownership, and error recovery contracts.

Only the shell-level recovery snapshot may suspend the Workbench interaction tree, and a terminal failure does not grant the retained canvas any read or write interaction until a new Desktop session is opened.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.test.tsx:2806` - Tests cover reusing a singleton widget without implicit ensureWidget centering when focus is disabled.

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchInputRouting.ts:241` - Selected Terminal wheel routing delegates only an explicit local-scroll marker to the widget without a DOM-focus gate.

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.interaction.test.tsx:650` - Surface interaction tests cover selected Terminal wheel ownership outside terminal focus and while Canvas is locked.
