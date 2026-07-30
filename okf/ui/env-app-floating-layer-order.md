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

The product layer constants are the only authority for these bands. Published floe-webapp `CommandPalette.zIndex` and `Dialog.globalZIndex` configure global roots without CSS guessing or DOM discovery. Env App's modal wrapper supplies 4000 by default. Floe surface-scoped dialogs ignore that global value and remain locally layered inside their owning window stacking context. Window-local menus, tooltips, recovery panels, and confirmations must not cross a global band.

## Movable window order

One Shell-lifetime provider registers every open movable window under a stable identifier. Registration order establishes the initial order. Captured pointer input, focus entering the surface, and plugin bridge activation, focus, or action events move the interacted window to the top of the movable band. Product and plugin windows participate in the same order; the plugin window controller retains only its nine-window capacity and LRU eviction responsibility.

The stack recomputes consecutive layers after every registration, activation, or unregistration. It never uses an unbounded incrementing counter, never exceeds 1099, and keeps a multiply registered identifier until all owners unregister. Closing or unmounting a window removes its registration and compacts the remaining order. The minimized Debug Console entry is a launcher control at the base of the window band rather than an open movable window.

## Flower dismissal

The Flower companion remains above all movable windows while expanded. Its explicit close control first transfers focus to the neutral Activity content anchor, then collapses with an explicit non-focus-restoring path. It must not return focus to the retained composer because composer focus is an expansion intent. Outside pointer and Escape dismissal retain their published companion ownership and focus rules.

# Boundaries

This contract governs cross-surface Env App stacking only. Workbench projected overlays and menus remain surface-local, and reusable floe-webapp or Flower components do not own Redeven's numeric product policy. New global UI must select an existing band or update this contract and its browser hit-testing evidence; arbitrary escape values and component-specific global counters are forbidden.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/utils/envAppLayers.ts` - Defines the five product bands.
- `redeven:internal/envapp/ui_src/src/ui/utils/envAppFloatingWindowStack.ts` - Maintains compact shared movable-window ordering.
- `redeven:internal/envapp/ui_src/src/ui/widgets/PersistentFloatingWindow.tsx` - Registers product windows and activates them from pointer and focus input.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceWindow.tsx` - Projects plugin bridge interaction into the shared window stack.
- `redeven:internal/envapp/ui_src/src/ui/primitives/EnvAppModal.tsx` - Applies the product modal band to global dialogs while preserving surface-local behavior upstream.
- `redeven:internal/envapp/ui_src/src/ui/envAppFloatingLayers.browser.test.tsx` - Uses actual overlapping DOM hit results to verify window MRU and every global band.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - Verifies explicit close, focus handoff, persistent collapse, and outside dismissal.
