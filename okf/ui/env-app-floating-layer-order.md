---
type: UI Contract
title: Env App floating layer order
description: One product-owned stacking contract orders movable windows, Flower, plugin surfaces, blocking modals, and command UI.
tags: [ui, floating-windows, flower, plugins, dialogs, focus]
timestamp: 2026-10-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Env App assigns global layers to movable windows, Flower, plugin surfaces, blocking modals and command UI. Interaction reorders only its window band. Published Floe owns visible-viewport constraints and drag geometry; Redeven persists settled geometry and preserves reachable controls, local scrolling and destination interaction.

# Contract

## Drag-region synchronization
Desktop projects iframe-relative native drag regions. A settled snapshot must not schedule another frame by rebuilding itself; native pointer/geometry ownership remains upstream.

## Global bands
Ordinary windows use 1000–1099; expanded Flower 2000; its context previews 2100–2199; plugin Panel 3000 and plugin context menu 3100; product modals 4000; command palette 5000. Local menus, tooltips and recovery UI stay within their surface's global band.

## Dialog placement
Mobile plugin/tools navigation belongs to Shell content, not a global Launcher. Backdrop clicks close only the Dialog without reaching Activity beneath it; titlebar controls remain no-drag.

## Visible viewport boundaries
Published Floe owns visible viewport/safe areas, Safari fixed-origin conversion and projected-surface intersection. Do not bypass it with fixed positions, uncapped viewport heights or transforms. Temporary constraints preserve preferred size.

Upstream elastic dragging resists boundary overflow, retains a reachable header and returns the window inside safe bounds on release/interruption. Dragging a maximized header restores preferred size at the grab point and continues the gesture; controls, double-click and mounted body remain independent. Redeven supplies safe-area insets and persists only settled geometry.

## Movable window order
A Shell-lifetime provider registers stable IDs, retains multiply registered IDs until all owners unregister, and assigns bounded MRU order within each window band. Minimized Debug Console is a base-band launcher, not an open window.

## Flower dismissal
Expanded Flower sits above ordinary windows; owned previews sit above Flower and below plugin Panels. Dismissal never restores composer focus, which would expand it again. Host pointer/focus and trusted plugin bridge activation/focus/action events collapse Flower without consuming destination interaction, including cross-origin iframe interaction.

# Boundaries

This contract governs cross-surface Env App stacking and the Activity-versus-Workbench Dialog boundary. New global UI must select an existing band or update this contract and its browser hit-testing evidence; arbitrary escape values, document-level dismissal patches, per-Dialog placement branches, and component-specific global counters are forbidden.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/PersistentFloatingWindow.browser.test.tsx` - Published elastic drag, reachable header, settled persistence, maximize drag restore, and retained draft.

- `redeven:desktop/src/preload/desktopEmbeddedDragHost.test.ts` - No self-triggered frame after overlay creation or clearing, stable region identity, frame replacement and externally removed overlay recovery.

- `redeven:internal/envapp/ui_src/src/ui/services/desktopEmbeddedDragRegions.test.ts` - No refresh for ordinary blocker content; retained resize, geometry, marker and membership updates.

- `redeven:internal/envapp/ui_src/scripts/checkMobileNavigation.mjs` - Replays native document panning, stale visual offsets, and transient keyboard heights while checking fixed header size, composer bounds, retained editor, and selection.
