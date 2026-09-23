---
type: Runtime Contract
title: Desktop host application titlebar
description: Place host application controls alongside native window buttons without adding connection latency.
tags: [desktop, host-applications, ui]
timestamp: 2026-09-23T08:00:00Z
---
# Summary

The Redeven bootstrap owns host application toolbar presentation; macOS capture and Xpra remain the command and session authorities. Desktop provides native window geometry through the restricted [application presentation boundary](web-service-browser-window.md#host-application-presentation). One compact titlebar exposes window selection, picture settings and normal close actions without another connection or startup wait. Disconnection disables unavailable actions while preserving the native window and retry path.

# Layout

The first-party host-application bootstrap places its controls in one 40-pixel
Desktop titlebar, alongside platform-owned traffic lights or caption buttons.
It uses the existing Desktop chrome contract for left/right safe areas and
fullscreen transitions. Empty header space drags the window when no toolbar
popover is open; buttons and popovers explicitly reject dragging. While a popover
is open, the header temporarily receives pointer input so an outside click can
dismiss it instead of being consumed by native window dragging. Dismissal restores
native dragging immediately. Capture pixels begin below this row and are never
covered by it. Browser popups retain their browser frame and use a 46-pixel
in-page application toolbar.

The row presents application identity, current window and count, Keyboard, picture settings,
close-current-window and confirmed quit. Destructive controls use compact icons
with explicit accessible names and tooltips. Labels collapse at narrow widths;
window titles truncate without consuming space reserved for OS controls. Menus
stay inside the viewport and support keyboard navigation. Escape dismisses the
popover and restores focus to its trigger. Only the open popover and its own
trigger belong to its interaction boundary, never the entire header. Clicking
header padding, gaps, separators, a noninteractive application identity or
application content dismisses any open toolbar popover without cancelling,
replaying or redirecting the click,
or restoring toolbar focus. This applies both to macOS capture content and the
same-origin Xpra document, including after reconnection. Content input handlers
that stop event propagation must not prevent dismissal; moving keyboard focus
outside the popover and its trigger also dismisses it. Clicking the active trigger
closes it once; clicking a different trigger replaces it with that trigger's
popover. Interacting inside a popover retains its normal control behavior.
Loading, disconnected and completed Desktop documents
retain the titlebar with unavailable controls disabled. Preparation and local
connection-failure documents retain a scriptless draggable title.

The [client input contract](../architecture/host-application-input.md) owns the
Keyboard action, touch focus and candidate placement. The control is unavailable
until its selected target has decoded pixels.

# Appearance and language

The bootstrap consumes published Floe `standalone.css`: primitive sizing and
fonts, all 26 shell presets, shared floating material and input focus rules. It
uses the same `soft-neumorphic` material as Env App. Local CSS owns only viewer
layout and maps control states to upstream semantic tokens; it must not maintain
a second light/dark palette. Forced colors retain visible selection and focus.

The launch presentation supplies the current Env App preset and localized copy.
Desktop then projects its authoritative theme id and resolved locale through the
existing restricted native-window channel, after snapshot validation. No semantic
palette, arbitrary CSS, application capability or extra startup handshake crosses
this boundary. The same theme and language change notifications refresh open
application windows without navigation or reconnection.

One typed key mapping owns launch copy and the generated ten-locale bootstrap
catalog. Generation requires every explicit translation and consumes the released
Floe package; builds reject stale artifacts. Visible text, tooltips, accessibility
names, error feedback and confirmation copy update in place. Host-provided app,
window and native menu names remain host content. Picture selections, active
window, keyboard focus and transport ownership survive presentation changes.
The inline assets add no request or connection wait.

# Backend commands

The shared toolbar and picture-preset presentation do not own backend state.
macOS retains native menu, window-generation, frame credit and capture-quality
semantics. Linux uses the pinned Xpra client's window inventory, focus/stacking,
metadata and destruction events; it does not poll or create a second window
manager. Selecting a window respects upstream modal focus. Picture presets issue
Xpra's existing quality/speed commands on the current connection. Defaults add no
handshake or startup wait; reconnect reapplies a saved non-default preset.

Closing the current application window uses its normal backend close request.
Linux labels the confirmed operation Close all windows and asks top-level windows to close normally;
application save dialogs remain operable and cancellation keeps the viewer open.
It never sends server shutdown or force-kills the application. macOS quit retains
its existing application-wide confirmation. The native outer close button still
closes only the viewer and preserves the session. These distinct actions must not
be collapsed into one destructive command.

# Evidence

- `redeven:internal/codeapp/appserver/host_application_viewer/toolbar.js` and `viewer.js` - Shared control presentation and Xpra-owned action routing.
- `redeven:internal/envapp/ui_src/src/styles/hostApplicationSurfaces.browser.test.tsx` - Native safe areas, compact layouts, dark appearance and bounded popovers.
- `redeven:desktop/scripts/check-host-application-titlebar.mjs` - Opt-in real Electron titlebar, isolated preload, actions and fullscreen acceptance with a disposable transport fixture.
- `redeven:internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts` and `macHostApplicationViewer.test.ts` - Outside-input dismissal, focus semantics and preserved application input across both viewer backends.

- `redeven:internal/envapp/ui_src/src/styles/hostApplicationAppearance.browser.test.tsx` - All published palettes, floating materials, locale updates, compact layouts and forced-color focus.
- `redeven:internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs` - Reproducible published styles and complete explicit viewer catalogs.
