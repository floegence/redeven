---
type: UI Contract
title: Ask Flower window boundaries
description: Keep contextual Ask Flower controls below host headers without maximizing the launcher.
tags: [ui, flower, floating-windows, desktop]
timestamp: 2026-09-16T00:00:00Z
---
# Summary

Redeven owns the Ask Flower launcher's placement policy in Activity, Workbench,
and Desktop Welcome. Its titlebar and composer remain reachable below the visible
Shell header and native Desktop chrome. The launcher supports dragging and manual
resizing, but neither a maximize button nor titlebar double-click may maximize it.
When available space shrinks, the published Floe geometry constrains the existing
window without replacing the composer or discarding its draft.

# Contract

## Host boundary

The host adapter measures the visible Shell header's client-space bottom edge and
takes the larger of that edge and the current Desktop titlebar safe area. Hidden
retained shells do not contribute. The adapter observes header resizing, rebinds
when Activity and Workbench switch, and subscribes to native chrome updates. Its
measurement listeners are released when the launcher closes or the owner unmounts.

The shared launcher adds a 12 CSS pixel viewport margin, reduced to 8 below a
640 CSS pixel viewport width. The host boundary and margin feed one published
`viewportInsets` geometry path for anchored opening, centered opening, dragging,
edge resizing, and viewport changes. Host insets are not duplicated inside an
alternate drag controller. The launcher is a Shell-level floating window even
when its request originates in a projected Workbench widget.

## Controls and constrained space

Ask Flower sets the published `FloatingWindow.maximizable` capability to false.
The upstream component owns both button visibility and double-click behavior;
manual resizing remains independent. Other product windows retain their existing
capabilities. The launcher titlebar retains its close control.

Default, minimum, maximum, and anchored geometry use the same available viewport.
When it cannot accommodate the preferred size, the window shrinks within that
viewport. Context scrolls inside its existing constrained region and the composer
stays docked at the bottom. Header changes and display-mode changes preserve the
current DOM, draft, and submission identity. Send, dismissal, and thread handoff
continue to follow the [Flower command contract](flower-turn-launcher.md) and
[Activity companion placement](flower-activity-companion.md).

The Activity/Workbench mode switcher participates in the launcher's existing
related-surface boundary. Clicking a mode tab changes the host without dismissing
the draft as an outside click. Other outside-click dismissal remains unchanged.

# Evidence

- `redeven:desktop/src/shared/askFlowerWindowViewport.tsx` - Host header measurement and native chrome subscription.
- `redeven:internal/flower_ui/src/FlowerTurnLauncherWindow.tsx` - Shared bounded geometry and disabled maximization.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerTurnLauncherWindow.tsx` - Env App host integration.
- `redeven:desktop/src/welcome/App.tsx` - Desktop Welcome host integration.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerTurnLauncherWindow.bounds.browser.test.tsx` - Real browser opening, drag, resize, compact viewport, header replacement, draft, and Workbench input checks.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - Real shell mode-tab pointer clicks preserve the launcher and its draft.
