---
type: Interaction Contract
title: Host application display and window layout
description: Keep Xpra layout, native window state, pixel density and cursor coordinates consistent across viewport and quality changes.
tags: [applications, ui, desktop, display]
timestamp: 2026-09-27T00:00:00Z
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

The published compositor owns Wayland/Xwayland surface geometry, native resize
operations and window-family capture. A bounded PNG frame includes the current
application family and its popups. The canvas uses the actual frame dimensions
for coordinate mapping and preserves aspect ratio. The selected surface and
generation gate pointer/key delivery after paint. The shared released cursor
normalizer retains shape/hotspot and bounds logical size to 24 CSS pixels.
Unsupported macOS/Xpra picture controls are absent from this adapter.

## Xpra window geometry and closure

The adapter integrates the selected HTML5 v20/v21 client. It uses the published
`floeXpraViewer.getClient()` accessor in the privately prepared upstream document.
Installed upstream assets remain unchanged. Redeven declares `viewport`, `dialog` or native layout through the released SDK.
The SDK owns constraint, increment, density and decoration coordinate calculations.
Only changed viewport, density, policy or constraints request geometry; remote
receipts update accepted state without initiating another layout request. Identical
settings do not reset canvases; existing pixels survive normal resizing. Primary
normal windows fill the viewer;
Xpra decorations, wallpaper, toolbar, and loading UI are hidden. Native viewer
chrome owns primary-window movement and the authoritative maximize/minimize state.
Application controls request that state through Xpra metadata; native state changes
are reflected back to Xpra without confusing viewport filling with OS maximization.
Native restore also clears the remote iconified state. Dialog controls remain local
to their dialog. The application still owns
its own client-side header and controls. Transient dialogs retain their stacking, close controls, and input behavior;
dialogs negotiate bounded sizes while respecting native size constraints.
Menus and popups keep their ordinary window geometry. No pixel
stretching or cropping substitutes for application resize. Fixed-size or minimum-size
applications can still constrain their own layout. The
[client input contract](host-application-input.md) owns keyboard/composition and
painted-window binding; Xpra retains pointer and clipboard transport. This path does not create a native OS window per X11 child window.

The released `remote-pointer` controller owns every event in remote pixels. It
maps a touch tap to a click, a CSS-pixel drag beyond its fixed threshold to
vertical/horizontal/diagonal scroll, and a long press to right click or a later
left-button drag. It batches scroll deltas per animation frame and locks each
sequence to a connection-generation/window token. Pointer capture loss,
`pointercancel`, focus or viewport changes, canvas replacement, disconnect and
window destruction reset the controller and release only its held buttons.
Pinch zoom remains a browser gesture; toolbar, window lists and the keyboard
control remain local owners. The Xpra adapter receives only normalized pointer,
button and wheel commands and never runs a second touch recognizer.

Xpra's confirmed destruction of its final application window uses the same
terminal close policy above. The adapter does not infer closure from a missing
paint, a close request or a transport failure.

## Density and decoding

Clarity first requests native display density through the published SDK. On a
high-density viewer, applications render additional pixels with matching private
display DPI and toolkit scale; logical geometry, pointer targets and dialog
controls remain unchanged. The SDK bounds integral density by DPR and the server's
maximum display dimensions, and handles viewport and monitor changes. Redeven
does not implement a second scaling path. Automatic, Smoother motion and Less data
use logical density. Switching modes preserves the connection and application.
Clarity retains adaptive encoding speed and quality 95; mode changes request a
quality-100 refresh so a stationary view can recover exact pixels. Neither high
quality encoding nor HTTPS alone can restore detail absent from the source raster.
Extra pixels consume bandwidth and encoding time, so the picture panel explains
that motion can slow. Application support for live DPI changes remains authoritative.

The picture panel observes the SDK's resolved display notifications and shows its
configured render resolution. This value is not a measured remote frame size or
proof that an application honored live DPI changes. A reduced native density
shows a localized explanation: host display limits suggest making the viewer
smaller; the SDK density ceiling has its own message. Resize and monitor changes
update the same view without polling, quality commands, or refresh requests.
Disconnect revokes the subscription and clears its presentation. Display protocol 2
updates dimensions, legacy screen sizes, workarea, DPI and toolkit scale together.
Older backends remain at logical density, with an explicit resolution limitation.

Saved picture preferences and decoder availability are applied once the client
connects, including when document load precedes the handshake. Selecting the
already selected mode is a no-op. Theme and language updates preserve selection
and focus without sending controls. Limit notices stay inside the scrollable
picture panel and remain readable in narrow or short viewports.

The picture panel reports video decoding availability from the actual client
encoding list. HTTPS alone does not prove decoder support or a received video
frame. Automatic retains Xpra's adaptive quality/speed semantics. An insecure
browser context explains how to enable HTTPS through Redeven Desktop's environment
access settings, trust the identity on the viewing device and reopen the app.
The [certificate contract](../security/local-ui-certificates.md) owns identity and
trust; the viewer never creates certificates, installs trust, changes the saved
protocol, restarts a Runtime, or silently downgrades TLS.

# Boundaries

The [viewer resource contract](host-application-viewer-resources.md) owns current
snapshots, cache authorization and independent viewer/backend upgrades. Viewer
preparation failures permit retry. Unsupported input preserves pictures and local
controls; only confirmed incompatible loaded modules show save/quit/reopen guidance.

## Remote cursor geometry

Published `floe-native-apps` prepares the only Linux cursor owner. Remote PNG
shapes, alpha and complete bounds are retained; their longest edge is at most
24 CSS pixels and smaller images are never enlarged. The hotspot uses the same
scale, is rounded once and remains inside the image. Integral backing density
declared through CSS `image-set()` affects resolution only. DPR and viewport
changes render from the original decoded image, never from an already scaled copy.
CSS cursors and the existing remote pointer use the same normalized result.

One connection owns its current image and decode generation. A newer packet,
reset or disconnect invalidates pending decodes; destroyed windows receive no
late updates, and new windows inherit the current result. Transparent images
remain invisible. Invalid metadata or failed decoding clears the old cursor and
restores the system default without interrupting input. Redeven adds no cursor
size setting, CSS override, mouse listener or second image-processing path.

New sharing connections use current cursor resources while preserving application
identity. macOS native applications retain the client's existing cursor.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/viewer.js`: SDK layout declarations, native state mapping and quality deduplication.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: declared geometry policies, late receipts, capability restrictions and repeated mode selection.
- `internal/envapp/ui_src/src/styles/hostApplicationDisplay.browser.test.tsx`: responsive density feedback, localization and keyboard dismissal.
- `scripts/check_host_application_input.mjs` and `internal/hostapps/client_input_test.go`: actual pixels, cursor hotspots and toolkit input receipts.
