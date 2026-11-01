---
type: UI Contract
title: Workbench surface lifecycle
tags: [ui, workbench, lifecycle, keep-alive]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Workbench preserves widget identity across selection, activation, loading and recovery. Floe owns generic Dock focus; Redeven adds no visibility store. Selected Terminal local viewports own wheel input without DOM focus; unselected widgets remain Canvas-owned. Shell recovery makes retained content inert above the canvas, with overlays in the shared surface layer.

# Contract

## Mechanism
[Page loading](page-loading-continuity.md) supplies per-widget Suspense/initial presentation without suspending the canvas. [Input ownership](workbench-input-ownership.md) controls local gestures; [Activity companion](flower-activity-companion.md) owns retained Flower placement. Lazy delivery creates no second lifecycle or eager feature initialization.

# Boundaries

Lazy loading is a module-delivery boundary only. It must not pre-mount inactive Workbench features, eagerly initialize Flower providers, or weaken existing permission, state restoration, input ownership, and error recovery contracts.

Only the shell-level recovery snapshot may suspend the Workbench interaction tree, and a terminal failure does not grant the retained canvas any read or write interaction until a new Desktop session is opened.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.test.tsx:2806` - Singleton reuse without implicit centering when focus is disabled.

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchInputRouting.ts:241` - Terminal local-scroll wheel delegation without DOM-focus requirement.
