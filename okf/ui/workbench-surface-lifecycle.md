---
type: UI Contract
title: Workbench surface lifecycle
description: Selection presentation, recovery ownership, lazy widgets, and shared floating surfaces.
tags: [ui, workbench, lifecycle, keep-alive]
timestamp: 2026-07-22T00:00:00Z
---
# Summary

Workbench keeps widget identity and state stable while visual selection, input routing, committed activation, lazy feature loading, and connection recovery follow explicit presentation ownership. A selected Terminal's declared local scroll viewport owns pointer wheel input without requiring terminal DOM focus, while unselected widgets remain under Canvas ownership. Recovery is mounted above the canvas and makes retained content inert instead of creating per-widget reconnect state. Pointer-anchored overlays use the shared surface layer, and lazy module delivery cannot replace permission, keep-alive, or lifecycle contracts.

# Contract

## Mechanism

Workbench widget selection follows the same presentation ordering without changing canvas ownership. The selected boundary and pointer ownership update immediately; committed activation, z-order persistence, viewport reveal or centering, fit, focus, and geometry measurement occur after the intent paint. Activity and Workbench page roots also remain mounted after first visit. Switching page mode changes visibility and activation sequence after paint, then restores Workbench geometry and focus; it does not rebuild the Workbench page or destroy the Activity Shell.

Shell preset changes may repaint widget boundaries, retained feature bodies, and floating surfaces, but they do not change input ownership. The selected widget remains the canvas wheel guard, declared reading surfaces retain browser text selection and copy, unselected widgets do not capture wheel input, and projected overlays continue through `SurfaceFloatingLayer`. When the pointer wheel path belongs to a selected Terminal's real local-scroll marker, that Terminal owns scrollback input even if its textarea does not currently hold DOM focus and even while Canvas movement is locked; routing the wheel must not move focus, change the active session, or grant an unselected or placeholder Terminal local ownership. Theme-derived colors must not be implemented by replacing or remounting those owners.

Unexpected connection recovery is owned above the Workbench canvas. `ConnectionRecoveryView` fills the Workbench content root while the mounted canvas remains the same KeepAlive instance underneath. During recovery the canvas container is `inert`, pointer-disabled, and hidden from assistive technology, so selected widgets, terminals, floating layers, keyboard handlers, and canvas gestures cannot act on stale Runtime state. The recovery view is ordinary shell content rather than a projected widget, nested card, or Workbench floating layer. When the shared recovery snapshot returns to idle after its success hold, the existing viewport, widget selection, canvas state, and mounted feature bodies resume without reconstruction.

A Desktop transport snapshot in `ready` phase must still belong to the exact registered bridge session whose stable loopback proxy remains alive. Desktop health consumers are read-only observers: they may expose `recovering` while the bridge is reconnecting or `unavailable` after a typed Local UI probe failure, but neither result may retire the bridge or strand the retained shell on a stale `ready` record. Only the bridge session may advance recovery phases or close automatically. When that same session returns to `ready`, Env App resumes protocol and secure-session recovery through the original loopback URL and mounted Workbench tree; terminal bridge failure keeps the tree inert until explicit Open creates a new Desktop session.

Workbench widget definitions may lazy-load their feature body, including Terminal, Files, Monitor, Codespaces, Ports, Flower, and Codex. The widget identity, persisted instance state, selected state, activation sequence, permission fallback, and viewport policy exist outside the feature module and must be forwarded unchanged when the chunk resolves. Lazy resolution may delay the first body mount, but it must not create a second widget instance, reset persisted state, bypass RWX permission notices, or convert activation into an implicit viewport-centering request. Tests that inspect lazy widget bodies wait for module resolution before asserting the live component contract.

Activity Flower placement is outside this lifecycle; [Flower Activity companion](flower-activity-companion.md) owns the companion state and focus-isolation contract. Workbench's product-specific invariant is that mode switching alone never creates or focuses its existing Flower Widget; only explicit Workbench activation or handoff may do so.

Projected Workbench surfaces must delegate pointer-anchored overlays to the shared surface floating layer. Menus opened from right-click, menu buttons, or keyboard anchors should pass client or anchor coordinates to `SurfaceFloatingLayer`, which owns surface-local projection, clamping, z-index, and local interaction markers. Context menus, dropdowns, popovers, hover cards, tooltips, autocomplete panels, command palettes, color pickers, date pickers, and equivalent floating UI must not treat Workbench as ordinary document flow. Their panel content may own role, focus, keyboard navigation, item layout, and visual styling, but must not own `position: fixed`, inline viewport `left` / `top`, `window.innerWidth` / `window.innerHeight` clamping, body portals, or component-local viewport-to-surface coordinate conversion inside a transformed projected surface.

Git entity menus use this shared projection for workspace sections and rows, branches, branch status entries, graph and history commits, compare files, and stashes. Mouse right-click and `ContextMenu` or `Shift+F10` open the same menu; the first action receives focus, Arrow keys plus Home and End navigate, Enter or Space activates, and Escape or Tab closes and restores focus to the trigger. Disabled actions remain focusable with `aria-disabled` and a reason. The controller snapshots the entity and repository or worktree root at open time so selection changes, refreshes, or later navigation cannot retarget an already-open action. Dangerous branch, stash, and discard actions still enter their existing review or confirmation owner rather than calling mutation RPCs from the menu.

# Boundaries

Lazy loading is a module-delivery boundary only. It must not pre-mount inactive Workbench features, eagerly initialize Flower or Codex providers, or weaken existing permission, state restoration, input ownership, and error recovery contracts.

Connection recovery must not be implemented independently inside Workbench widgets or feature bodies. Per-widget curtains, fallback controls, and local reconnect state would create conflicting interaction owners and allow stale controls to remain reachable. Only the shell-level recovery snapshot may suspend the Workbench interaction tree, and a terminal failure does not grant the retained canvas any read or write interaction until a new Desktop session is opened.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.test.tsx:2806` - Tests cover reusing a singleton widget without implicit ensureWidget centering when focus is disabled.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchInputRouting.ts:241` - Selected Terminal wheel routing delegates only an explicit local-scroll marker to the widget without a DOM-focus gate.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.interaction.test.tsx:650` - Surface interaction tests cover selected Terminal wheel ownership outside terminal focus and while Canvas is locked.
- `redeven:internal/flower_ui/src/threads/FlowerThreadList.tsx:287` - Flower thread context menus render through the shared surface floating layer.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.threads.test.tsx:1730` - Tests assert the thread context menu is hosted by a local interaction floating layer.
- `redeven:AGENTS.md:651` - Repository rules define Workbench floating UI and coordinate ownership.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx:20` - Workbench feature bodies use independent lazy imports while widget definitions remain stable.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:3480` - Workbench connection recovery is composed above the kept-alive page root.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/ConnectionRecoveryView.browser.test.tsx:157` - Chromium fixtures cover recovery states across themes, desktop and mobile viewports, long locales, and reduced motion.
- `redeven:desktop/src/main/runtimePlacementBridgeObservation.ts:25` - Desktop health observation preserves the exact bridge during recovery and typed probe failure.
- `redeven:desktop/src/main/main.ts:3495` - Welcome consumes structured recovery observations without replacing or retiring the Env App transport.
- `redeven:internal/flower_ui/src/styles/flower.css:5153` - The thread context menu panel keeps visual styling without owning fixed positioning.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FloatingContextMenu.tsx:49` - The shared Git menu panel owns menu focus and keyboard interaction while delegating placement to the surface layer.
- `redeven:internal/envapp/ui_src/src/ui/widgets/GitEntityContextMenu.tsx:56` - Git menu controllers snapshot targets, close on outside interaction, scroll, or blur, and restore trigger focus for keyboard dismissal.
