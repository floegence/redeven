---
type: Runtime Contract
title: Desktop host application titlebar
tags: [desktop, host-applications, ui]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven owns the compact host toolbar; macOS capture/Xpra own commands and sessions, Desktop supplies native geometry. It never sends server shutdown or force-kills the application. macOS quit retains its existing application-wide confirmation. The control is unavailable until its selected target has decoded pixels.

# Contract

## Layout
The first-party host-application bootstrap places its controls in one 40-pixel Desktop titlebar, alongside platform-owned traffic lights or caption buttons. Empty header space drags the window when no toolbar popover is open; buttons and popovers explicitly reject dragging.

## Appearance and language
The bootstrap consumes published Floe `standalone.css`: primitive sizing and fonts, all 26 shell presets, shared floating material and input focus rules. Local CSS owns only viewer layout and maps control states to upstream semantic tokens; it must not maintain a second light/dark palette.

The inline assets add no request or connection wait.

## Backend commands
The shared toolbar and picture-preset presentation do not own backend state. macOS retains native menu, window-generation, frame credit and capture-quality semantics.

These distinct actions must not be collapsed into one destructive command.

# Boundaries

Toolbar presentation does not own the capture or Xpra session. Disconnection disables unavailable actions while preserving the window and existing retry path.

# Evidence

- `redeven:internal/codeapp/appserver/host_application_viewer/toolbar.js` and `viewer.js`

- `redeven:internal/envapp/ui_src/src/styles/hostApplicationSurfaces.browser.test.tsx` - Tests.
