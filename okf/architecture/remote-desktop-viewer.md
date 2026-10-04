---
type: Interaction Contract
title: Remote desktop viewer interaction
description: Operate the remote desktop toolbar, input modes and ended-session recovery consistently in browsers and Desktop.
tags: [desktop, viewer, interaction, input]
timestamp: 2026-10-04T13:20:00Z
---
# Summary

The Redeven viewer owns product controls and local feedback over published Floe
input and native playback. The [remote desktop session contract](remote-desktop.md)
owns authorization, capture generations and native authority. Only current painted
control permits input. Control mode displays the client system pointer immediately,
independently of remote frame arrival; local controls remain usable during recovery. Disconnect
stops local input and playback immediately, then confirms server removal or offers
an explicit retry. It never presents a frozen desktop as a live connection.

# Contract

## Input and clipboard

The published Floe input and pointer controllers own client composition, physical
keys, pointer gestures and release. Mouse and drag movement coalesces within the
current JavaScript task and flushes before local paint without another animation-
frame wait. Scroll remains accumulated per frame. Explicit pointer flushes
preserve ordering before keys or composed text; reset invalidates pending moves. The viewer defaults to the host input method,
using physical keys from a direct-input client keyboard. Client-composed text is
sent only after explicitly selecting Paste client text. That operation replaces
the host text clipboard and uses the published native paste command on both
platforms. The settings describe this effect and require users to finish or cancel
host composition before switching. Changing the mode cancels the client's pending
composition; no text is replayed and no Escape/Enter is guessed on the host.
Advertised accessibility insertion does not guarantee Electron text insertion,
and simultaneous unfinished host/client composition is outside this input path.
This does not claim arbitrary Unicode can be represented as synthetic key presses.
Clipboard access
is text-only and tied to the active controller. A manual text panel remains
available when browser clipboard permission is unavailable. Clipboard contents,
keys, passwords and pixels never enter audit records.

Control mode displays the local system pointer without waiting for remote pixels.
On Linux X11, published native playback receives the host cursor image and hotspot
separately and applies them to that local pointer; video excludes the host cursor,
and cursor-only movement produces no video frame. Transparent cursor shapes remain
transparent. Retired generations cannot change the current pointer. macOS and
Wayland retain embedded capture cursors and the local default pointer until their
platforms provide the same independent shape contract. Local movement does not
imply the host has processed input.
View-only mode hides the local pointer only over a current painted desktop and
shows the captured host cursor. Revoking painted authority hides the retired picture
and restores the local pointer, including disconnect, lock, display replacement
and reconnect awaiting a fresh frame. Cursor presentation never grants input
authority. Toolbar and dialog cursors remain local. This desktop-only policy does
not apply to host application windows, which use their own upstream cursor contract.

## Toolbar and window

Desktop opens an isolated owned window; browsers open a separate
viewer. Desktop's toolbar is its native titlebar: one 40px row at ordinary widths,
with window-control insets owned by the existing chrome snapshot. Fullscreen
updates those insets. The host name is the visible identity; there is no duplicate
close button below the native controls. Narrow windows may wrap whole controls
without covering native buttons or remote content. Interactive controls remain
outside native drag regions. Display selection and fit/original-pixel controls share the Display panel. The
main toolbar groups Display/control mode, clipboard/shortcuts/files, presentation,
and Disconnect. Primary actions use icon plus text; secondary icons have localized
accessible names and tooltips. Clipboard remains inspectable in view-only mode,
but all remote clipboard actions and shortcuts require current painted control.
Files is available only with an owning Desktop or browser opener bridge.
Each window presents one selected display. Fit and original-pixel modes
change local rendering/capture settings without resizing the host desktop.
Fullscreen offers a hideable, pinnable toolbar and an explicit exit. Moving over
remote content does not continually reopen the toolbar; the top edge reveals it.
Pinning, keyboard focus and open dialogs keep controls reachable. Modal panels
retain keyboard focus, close with Escape and restore their originating trigger. Desktop
uses the exact owning native window and waits for its fullscreen event before
accepting the next toggle; browsers use the document fullscreen API. Files opens
the existing environment file surface through the owning window/shell bridge.
Window closure and Disconnect end sharing only. Explicit Disconnect immediately
revokes input, hides and erases the old picture, closes playback/audio and sockets,
cancels reconnect, clears clipboard state and disables remote actions. Its request
uses the existing authenticated carrier. Only confirmed removal (or an already
absent session) disposes that carrier; an unconfirmed request leaves an explicit
Disconnect retry while input and capture stay stopped. Ended sessions explain how
to start a new connection from the launcher and never expose an ineffective
Reconnect action. Other sessions and host applications remain intact. New copy is explicit in every
shipped locale, and standalone controls consume released Floe appearance/input
assets.

Lock host replaces the settings content inside the same modal and focuses
Cancel. Only explicit confirmation sends the lock command; Cancel and Escape
send nothing. Closing the confirmation restores focus to the settings trigger.
A queued settings-close event must never dismiss or resolve its replacement.
Lock is available only after the current control generation has painted. Its
confirmation belongs to that attachment and generation; losing authority disables
it permanently, even if a successor becomes active. The user can cancel and open
a fresh confirmation after recovery.
Sound initialization also fences competing settings and control actions before
its asynchronous browser work begins. Only the same active attachment may apply
the result; successful reconfiguration still waits for a fresh painted frame.
Transport reconnect resets the existing window's player and retires old-generation
media while preserving its user-enabled audio device and sound preference. Fresh
audio must use the successor generation. Explicit Disconnect closes that device;
an enabled sound toggle must never hide a closed audio context after reconnect.

# Boundaries

The [connection launcher](remote-desktop-launcher.md) owns target identity,
readiness, preparation, grant-reuse settings and launch feedback. The
[session contract](remote-desktop.md) owns authorization, capture generations and
native authority; viewer controls cannot substitute for painted control authority.

# Evidence

- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/codeapp/appserver/remote_desktop_viewer/viewer.html`: control state, input mapping, modal focus and disconnect lifecycle.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.css`: responsive grouped toolbar, visible action states, hidden retired pictures and native chrome insets.
- `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`: published Floe icons and input controllers, explicit locale catalogs.
- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: browser/Electron interaction, theme/width screenshots, authorization loss, fullscreen and failed/successful disconnect.
- `internal/localui/window_transport_e2e_test.go`: authenticated viewer disconnect confirmation and exact-session removal.
