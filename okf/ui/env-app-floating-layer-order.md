---
type: UI Contract
title: Env App floating layer order
description: One product-owned stacking contract orders movable windows, Flower, plugin surfaces, blocking modals, and command UI.
tags: [ui, floating-windows, flower, plugins, dialogs, focus]
timestamp: 2026-07-30T00:00:00Z
---
# Summary

Env App owns one global stacking contract for cross-surface UI. Movable product and plugin windows share a compact most-recently-used band from 1000 through 1099; the expanded Flower companion is 2000, the plugin launcher Panel is 3000, blocking product modals are 4000, and the command palette is 5000. No surface may escape its assigned band through an ad hoc `z-index`. A window interaction changes only the movable-window order, while higher product layers remain stable and operable.

# Contract

## Global bands

The command palette is always the top Env App surface at 5000. Blocking authorization, confirmation, recovery, and inspection modals use 4000 so required decisions remain above the plugin Panel and Flower but below command UI. The Activity plugin launcher Panel uses 3000. The expanded or transitioning Flower companion uses 2000. Every movable window, including Files, preview, Git, Debug Console, Flower launcher and context windows, and Activity plugin surfaces, uses the shared 1000 through 1099 band.

The product layer constants are the only authority for these bands. Published floe-webapp `CommandPalette.zIndex`, `Dialog.globalZIndex`, and `DialogPlacementProvider` configure global roots without CSS guessing or DOM discovery. Env App's modal wrapper supplies 4000 by default. Window-local menus, tooltips, and recovery panels must not cross a global band.

## Dialog placement

Activity owns one global modal boundary. The Activity Shell, Activity movable windows, and the retained Flower product while placed in Activity select global Dialog placement at layer 4000. Clicking the backdrop closes only the Dialog; the first click never reaches the Activity content beneath it. Escape, focus trapping, focus restoration, and exit presence use the same published global Dialog path.

Workbench selects automatic placement. A Dialog opened from a widget or projected Flower surface remains inside that owning surface: clicking the canvas or another widget neither closes nor captures the destination interaction, while clicking the surface-local backdrop closes the Dialog. Moving the retained Flower product between Activity and Workbench changes this single placement input reactively; it does not install another listener or duplicate Dialog state. Dropdowns, tooltips, and `SurfaceFloatingLayer` keep their existing surface-coordinate ownership.

Desktop drawers retain the global Dialog backdrop and focus boundary, but their interactive panel begins below the native titlebar safe area. The panel is a no-drag region; the full-window overlay must not become one, so the unobstructed titlebar remains available for native window movement while the backdrop still owns outside-click dismissal. Interactive titlebar controls retain their existing no-drag exclusions.

## Movable window order

One Shell-lifetime provider registers every open movable window under a stable identifier. Registration order establishes the initial order. Captured pointer input, focus entering the surface, and plugin bridge activation, focus, or action events move the interacted window to the top of the movable band. Product and plugin windows participate in the same order; the plugin window controller retains only its nine-window capacity and LRU eviction responsibility.

The stack recomputes consecutive layers after every registration, activation, or unregistration. It never uses an unbounded incrementing counter, never exceeds 1099, and keeps a multiply registered identifier until all owners unregister. Closing or unmounting a window removes its registration and compacts the remaining order. The minimized Debug Console entry is a launcher control at the base of the window band rather than an open movable window.

## Flower dismissal

The Flower companion remains above all movable windows while expanded. Its explicit close control first transfers focus to the neutral Activity content anchor, then collapses with an explicit non-focus-restoring path. It must not return focus to the retained composer because composer focus is an expansion intent. Outside pointer and Escape dismissal retain their published companion ownership and focus rules. Activity plugin window interaction is also outside Flower: host pointer or focus input and trusted plugin bridge activation, focus, or action events collapse the companion without consuming the destination interaction, including when the event originates inside a cross-origin iframe and cannot bubble through the product document.

# Boundaries

This contract governs cross-surface Env App stacking and the Activity-versus-Workbench Dialog boundary. Workbench projected overlays and menus remain surface-local, and reusable floe-webapp or Flower components do not own Redeven's numeric product policy or display-mode decision. New global UI must select an existing band or update this contract and its browser hit-testing evidence; arbitrary escape values, document-level dismissal patches, per-Dialog placement branches, and component-specific global counters are forbidden.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/utils/envAppLayers.ts` - Defines the five product bands.
- `redeven:internal/envapp/ui_src/src/ui/utils/envAppFloatingWindowStack.ts` - Maintains compact shared movable-window ordering.
- `redeven:internal/envapp/ui_src/src/ui/widgets/PersistentFloatingWindow.tsx` - Registers product windows, activates them from pointer and focus input, and supplies their global Dialog placement.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Selects global Activity placement and automatic Workbench placement for the retained Flower product.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceWindow.tsx` - Projects plugin bridge interaction into the shared window stack.
- `redeven:internal/envapp/ui_src/src/ui/primitives/EnvAppModal.tsx` - Applies the product modal band to explicitly global product dialogs.
- `redeven:internal/envapp/ui_src/src/ui/primitives/EnvAppDrawer.tsx` - Keeps drawer interaction below the Desktop titlebar while preserving global Dialog dismissal and focus ownership.
- `redeven:internal/envapp/ui_src/src/ui/primitives/EnvAppDrawer.browser.test.tsx` - Verifies the panel remains no-drag without turning the full-window overlay into a titlebar blocker.
- `redeven:internal/envapp/ui_src/src/ui/envAppFloatingLayers.browser.test.tsx` - Uses actual overlapping DOM hit results to verify window MRU and every global band.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - Verifies explicit close, focus handoff, persistent collapse, and outside dismissal.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Verifies trusted plugin window interaction dismisses the expanded companion across the iframe boundary.
