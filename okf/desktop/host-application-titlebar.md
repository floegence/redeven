---
type: Runtime Contract
title: Desktop host application titlebar
tags: [desktop, host-applications, ui]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Redeven bootstrap owns host application toolbar presentation; macOS capture and Xpra remain the command and session authorities. Desktop provides native window geometry through the restricted [application presentation boundary](web-service-browser-window.md). One compact titlebar exposes window selection, picture settings and normal close actions without another connection or startup wait. Disconnection disables unavailable actions while preserving the native window and retry path.

# Contract

## Layout
The first-party host-application bootstrap places its controls in one 40-pixel Desktop titlebar, alongside platform-owned traffic lights or caption buttons. Empty header space drags the window when no toolbar popover is open; buttons and popovers explicitly reject dragging.

The control is unavailable until its selected target has decoded pixels.

## Appearance and language
The bootstrap consumes published Floe `standalone.css`: primitive sizing and fonts, all 26 shell presets, shared floating material and input focus rules. Local CSS owns only viewer layout and maps control states to upstream semantic tokens; it must not maintain a second light/dark palette.

The inline assets add no request or connection wait.

## Backend commands
The shared toolbar and picture-preset presentation do not own backend state. macOS retains native menu, window-generation, frame credit and capture-quality semantics.

It never sends server shutdown or force-kills the application. macOS quit retains its existing application-wide confirmation. These distinct actions must not be collapsed into one destructive command.

# Boundaries

Toolbar presentation does not own the capture or Xpra session. Disconnection disables unavailable actions while preserving the window and existing retry path.

# Evidence

- `redeven:internal/codeapp/appserver/host_application_viewer/toolbar.js` and `viewer.js` - Shared control presentation and Xpra-owned action routing.

- `redeven:internal/envapp/ui_src/src/styles/hostApplicationSurfaces.browser.test.tsx` - Native safe areas, compact layouts, dark appearance and bounded popovers.
