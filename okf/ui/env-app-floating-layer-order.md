---
type: UI Contract
title: Env App floating layer order
description: One product-owned stacking contract orders movable windows, Flower, plugin surfaces, blocking modals, and command UI.
tags: [ui, floating-windows, flower, plugins, dialogs, focus]
timestamp: 2026-10-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Env App owns one global stacking contract for cross-surface UI. Movable product and plugin windows share a most-recently-used band from 1000 through 1099; the expanded Flower companion is 2000, its context previews use 2100 through 2199, the plugin launcher Panel is 3000, blocking product modals are 4000, and the command palette is 5000. No surface may escape its assigned band through an ad hoc `z-index`. A window interaction changes only the movable-window order, while higher product layers remain stable and operable.

Published Floe Webapp constrains dialogs and floating windows to the visible
viewport or owning projected surface. Toolbar and keyboard changes preserve
reachable window controls and local content scrolling; temporary bounds do not
replace the live preferred geometry.

# Contract

## Drag-region synchronization
Desktop's embedded host projects iframe-relative native drag regions. A settled snapshot must not schedule another animation frame by rebuilding itself.

Native pointer and floating geometry ownership remain upstream.

## Global bands
The command palette is always the top Env App surface at 5000.

Window-local menus, tooltips, and recovery panels must not cross a global band.

## Dialog placement
Mobile plugin and tools navigation is local to the released Shell content region, not a global launcher modal.

Clicking the backdrop closes only the Dialog; the first click never reaches the Activity content beneath it.

Interactive titlebar controls retain their existing no-drag exclusions.

## Visible viewport boundaries
Published Floe Webapp owns the visible viewport, safe areas, Safari fixed-origin conversion, and projected surface intersection for Dialog and FloatingWindow. Product CSS must not bypass this boundary with fixed panel positions, viewport-unit heights plus removed maximums, or forced transforms.

Temporary viewport constraints do not replace upstream's live preferred window size.

## Movable window order
One Shell-lifetime provider registers every open movable window under a stable identifier.

It never uses an unbounded incrementing counter, stays inside 1000–1099 for ordinary windows or 2100–2199 for Flower context previews, and keeps a multiply registered identifier until all owners unregister. The minimized Debug Console entry is a launcher control at the base of the window band rather than an open movable window.

## Flower dismissal
The Flower companion remains above ordinary movable windows while expanded; its owned context preview remains above it and below plugin Panels and product modals. It must not return focus to the retained composer because composer focus is an expansion intent. Activity plugin window interaction is also outside Flower: host pointer or focus input and trusted plugin bridge activation, focus, or action events collapse the companion without consuming the destination interaction, including when the event originates inside a cross-origin iframe and cannot bubble through the product document.

# Boundaries

This contract governs cross-surface Env App stacking and the Activity-versus-Workbench Dialog boundary. New global UI must select an existing band or update this contract and its browser hit-testing evidence; arbitrary escape values, document-level dismissal patches, per-Dialog placement branches, and component-specific global counters are forbidden.

# Evidence

- `redeven:desktop/src/preload/desktopEmbeddedDragHost.test.ts` - No self-triggered frame after overlay creation or clearing, stable region identity, frame replacement and externally removed overlay recovery.

- `redeven:internal/envapp/ui_src/src/ui/services/desktopEmbeddedDragRegions.test.ts` - No refresh for ordinary blocker content; retained resize, geometry, marker and membership updates.

- `redeven:internal/envapp/ui_src/scripts/checkMobileNavigation.mjs` - Replays native document panning, stale visual offsets, and transient keyboard heights while checking fixed header size, composer bounds, retained editor, and selection.
