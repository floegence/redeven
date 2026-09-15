---
type: UI Contract
title: Files context menus
description: Keep file operations reachable inside the complete Files workspace across Activity, floating windows, Workbench, and touch layouts.
tags: [ui, files, menus, mobile, workbench]
timestamp: 2026-09-15T00:00:00Z
---
# Summary

Published Floe Webapp owns file-menu placement, visible-viewport intersection,
measurement, scrolling, submenu navigation, gesture handling, and dismissal.
Redeven supplies the complete Files workspace boundary, product actions, and
localized labels. Menus stay at least 8 CSS px inside the usable intersection of
Files, the owning surface, and the visible viewport, with mobile Flower chrome
excluded. Invalid or unavailable explicit boundaries close the menu. Files does
not raise its global layer or duplicate Workbench coordinate conversion to make
an obscured action reachable.

# Contract

## Layout ownership

The directory tree and file content share the outer `BrowserWorkspaceShell`
boundary. Activity, Files floating windows, and Workbench keep their existing
shared portal ownership. The upstream layer measures actual menu content before
showing it, moves it left or up when necessary, and constrains width and height.
Long labels wrap; oversized menus scroll internally with their action order,
groups, and destructive styling intact.

[Flower Activity companion](flower-activity-companion.md) owns the mobile rail
placement. Shell exposes the client-coordinate top of its existing rail layout
through `EnvContext.activityContentBottomLimit`. Files clips its boundary to that
limit; it does not recalculate rail position, navigation height, keyboard height,
or safe-area insets. The shared Floe visible-viewport mechanism accounts for the
browser viewport and screen safe areas. Files measures its root on resize and
before input triggers so a later open uses current client geometry.

## Input and navigation

Desktop menus open near the pointer. Submenus prefer lateral placement and flip
when needed. Touch layouts and insufficient lateral space navigate the same
menu tree inside one panel with a localized Back action. Touch menu items and
Back are at least 44 CSS px high. Input capability and the configured mobile
layout query remain upstream decisions.

File rows, tiles, and the directory tree use the same upstream long-press
handlers. Movement, cancellation, and additional pointers cancel a pending long
press. The release click after a long press cannot navigate the tree or execute
a menu item. The menu is above the mobile tree drawer and scrim, and menu actions
do not close the drawer through click propagation.

Menu-local scroll remains open. The actual constrained menu viewport receives
the exported Redeven local-scroll props. [Workbench input ownership](workbench-input-ownership.md)
continues to decide whether a selected widget owns scrolling; unselected widgets
cannot acquire wheel ownership by displaying a menu.

Arrow keys, Home/End, Enter, Escape, and Tab retain shared menu semantics. Escape
in a submenu returns to its parent; root Escape and Tab restore trigger focus.
External pointer/focus/scroll, resize, visual-viewport changes, window blur, and
hidden or inactive owners dismiss the menu. Size and orientation changes close
the current menu; the next trigger starts a fresh placement.

# Boundaries

Existing context-event target snapshots, multi-selection, permissions, file
operations, and confirmation owners are unchanged. The menu does not add backend
APIs, perform mutations outside the existing callbacks, or replace deletion
confirmation. [Workbench surface lifecycle](workbench-surface-lifecycle.md) owns
the common projected host and local interaction contract.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - Supplies the complete workspace boundary and local-scroll props to published FileContextMenu.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Derives the Activity content bottom limit from the existing mobile Flower rail style.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserSidebarTree.tsx` - Reuses upstream long-press and release-click suppression for directory rows.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.contextMenu.browser.test.tsx` - Covers collision, final-action hit testing, narrow layouts, gestures, scrolling, and projected or floating hosts.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - Checks Files against the actual mobile rail and changed keyboard viewport.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.e2e.test.tsx` - Preserves target, selection, background, and Workbench interaction behavior.
- `redeven:internal/envapp/ui_src/package.json` - Pins the published Floe Webapp release that owns the shared menu behavior.
