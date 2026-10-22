---
type: Interaction Contract
title: Host application display and window layout
description: Keep Xpra layout, native window state, pixel density and cursor coordinates consistent across viewport and quality changes.
tags: [applications, ui, desktop, display]
timestamp: 2026-09-29T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Released `floe-native-apps` is the single owner of Linux display configuration,
window constraints and cursor coordinates. Redeven declares layout and quality
policy; Desktop owns actual maximize/minimize state. Remote geometry receipts must
not trigger resize feedback. Unchanged configurations preserve canvases and send
no layout commands. Old display backends remain usable at logical density and
explicitly restrict high resolution; no application is automatically restarted.

# Contract

## Native Linux window families
The published compositor owns Wayland/Xwayland surface geometry, native resize operations and window-family capture. Bounded image regions include the current application family and its popups. The [native stream contract](host-application-native-stream.md) owns picture modes, region composition, measured statistics and retained PNG-session compatibility.

## Xpra window geometry and closure
The adapter integrates the selected HTML5 v20/v21 client. Native viewer chrome owns primary-window movement and the authoritative maximize/minimize state.

The adapter does not infer closure from a missing paint, a close request or a transport failure.

## Xpra density and decoding
Clarity first requests native display density through the published SDK. Encoding quality and HTTPS cannot restore absent source detail.

The [certificate contract](../security/local-ui-certificates.md) owns identity and trust; the viewer never creates certificates, installs trust, changes the saved protocol, restarts a Runtime, or silently downgrades TLS.

# Boundaries

The [viewer resource contract](host-application-viewer-resources.md) owns current snapshots, cache authorization and independent viewer/backend upgrades. Unsupported input preserves viewing; confirmed incompatible modules require save/quit/reopen.

## Remote cursor geometry
The [native stream contract](host-application-native-stream.md) owns the shared Linux cursor's complete bounds, hotspot, density and decode lifetime. Native and Xpra adapters use the released normalizer; macOS retains its local system cursor.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/viewer.js`: SDK layout declarations, native state mapping and quality deduplication.

- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: declared geometry policies, late receipts, capability restrictions and repeated mode selection.

- `internal/envapp/ui_src/src/styles/hostApplicationDisplay.browser.test.tsx`: responsive density feedback, localization and keyboard dismissal.
