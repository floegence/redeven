---
type: Runtime Contract
title: Desktop host application titlebar
description: Place host application controls alongside native window buttons without adding connection latency.
tags: [desktop, host-applications, ui]
timestamp: 2026-09-22T02:30:00Z
---
# Summary

The Redeven bootstrap owns host application toolbar presentation; macOS capture and Xpra remain the command and session authorities. Desktop provides native window geometry through the restricted [application presentation boundary](web-service-browser-window.md#host-application-presentation). One compact titlebar exposes window selection, picture settings and normal close actions without another connection or startup wait. Disconnection disables unavailable actions while preserving the native window and retry path.

# Layout

The first-party host-application bootstrap places its controls in one 40-pixel
Desktop titlebar, alongside platform-owned traffic lights or caption buttons.
It uses the existing Desktop chrome contract for left/right safe areas and
fullscreen transitions. Empty header space drags the window; buttons and popovers
explicitly reject dragging. Capture pixels begin below this row and are never
covered by it. Browser popups retain their browser frame and use a 46-pixel
in-page application toolbar.

The row presents application identity, current window and count, picture settings,
close-current-window and confirmed quit. Destructive controls use compact icons
with explicit accessible names and tooltips. Labels collapse at narrow widths;
window titles truncate without consuming space reserved for OS controls. Menus
stay inside the viewport, support keyboard navigation and Escape, and restore
focus to their trigger. Loading, disconnected and completed Desktop documents
retain the titlebar with unavailable controls disabled. Preparation and local
connection-failure documents retain a scriptless draggable title.

# Backend commands

The shared toolbar and picture-preset presentation do not own backend state.
macOS retains native menu, window-generation, frame credit and capture-quality
semantics. Linux uses the pinned Xpra client's window inventory, focus/stacking,
metadata and destruction events; it does not poll or create a second window
manager. Selecting a window respects upstream modal focus. Picture presets issue
Xpra's existing quality/speed commands on the current connection. Defaults add no
handshake or startup wait; reconnect reapplies a saved non-default preset.

Closing the current application window uses its normal backend close request.
Confirmed Linux quit asks the session's top-level windows to close normally;
application save dialogs remain operable and cancellation keeps the viewer open.
It never sends server shutdown or force-kills the application. macOS quit retains
its existing application-wide confirmation. The native outer close button still
closes only the viewer and preserves the session. These distinct actions must not
be collapsed into one destructive command.

# Evidence

- `redeven:internal/codeapp/appserver/host_application_viewer/toolbar.js` and `viewer.js` - Shared control presentation and Xpra-owned action routing.
- `redeven:internal/envapp/ui_src/src/styles/hostApplicationSurfaces.browser.test.tsx` - Native safe areas, compact layouts, dark appearance and bounded popovers.
- `redeven:desktop/scripts/check-host-application-titlebar.mjs` - Opt-in real Electron titlebar, isolated preload, actions and fullscreen acceptance with a disposable transport fixture.
