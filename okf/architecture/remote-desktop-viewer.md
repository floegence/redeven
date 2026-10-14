---
type: Interaction Contract
title: Remote desktop viewer interaction
description: Operate the remote desktop toolbar, input modes and ended-session recovery consistently in browsers and Desktop.
tags: [desktop, viewer, interaction, input]
timestamp: 2026-10-13T21:00:00Z
---
# Summary

The Redeven viewer owns product controls and local feedback over published Floe
input and native playback. The [remote desktop session contract](remote-desktop.md)
owns authorization, capture generations and native authority. Only current painted
control permits input. Separate-cursor control frames enable immediate client
pointer movement independently of later frame arrival; embedded-cursor frames
hide the local pointer. Local controls remain usable during recovery. Disconnect
stops local input and playback immediately, then confirms server removal or offers
an explicit retry. It never presents a frozen desktop as a live connection.

# Contract

## Input and clipboard

The published Floe input and pointer controllers own client composition, physical
keys, pointer gestures and release. Mouse and drag movement retains only the
latest pending position, bounded to 120 submissions per second. The first idle
move flushes within its JavaScript task; clicks, keys and release flush pending
movement immediately in order. Raw pointer and ordinary pointer events share
that owner, so browser event cadence cannot grow an input queue. Scroll remains
accumulated per frame. Reset invalidates pending moves.

The viewer defaults to the host input method through the published
`physical-only` mode. Its non-editable desktop sends hardware key codes on
keydown, including IME-labelled keys, without waiting for local text events or
key release. The local composition editor stays disabled and empty. Explicitly
choosing Use local input method sends both
ordinary characters and locally confirmed composition through one ordered text
path. Physical navigation and shortcuts retain their key semantics; pending
modifiers never leak into a text paste. Mode changes cancel composition and
release held keys. Lock-screen input uses the published `physical-only` mode:
the non-editable desktop receives hardware key codes immediately, including
IME-labelled keys, while the local editor stays disabled and empty. Composition
and delayed text events cannot create or transmit credentials. Unlocking restores
the chosen mode only after a successor active frame is painted.

Client text is available when either `text_input` or the existing clipboard
capability is present. DRM service text does not enable clipboard synchronization.
In local input mode, Ctrl+V and Command+V read the local text clipboard and submit
one bounded operation through that same native text path, even when host
clipboard synchronization is unavailable. A delayed read is discarded after an
input-mode change or authority change; denied local clipboard access reports a
failure without changing host synchronization.
Its fixed unprivileged selection helper replaces the host text clipboard; the
root attachment alone validates authority and injects the paste chord. Settings
explain that mutation and require finishing or canceling host composition before
switching. No text is replayed and no Escape/Enter is guessed on the host.
Advertised accessibility insertion does not guarantee Electron text insertion,
and simultaneous unfinished host/client composition is outside this input path.
This does not claim arbitrary Unicode can be represented as synthetic key presses.
Clipboard access
is text-only and tied to the active controller. A manual text panel remains
available when browser clipboard permission is unavailable. Clipboard contents,
keys, passwords and pixels never enter audit records.

Each current frame declares whether the host cursor is embedded in its pixels or
supplied separately. The native player applies `data-floe-desktop-cursor` only
after drawing that frame. The viewer shows the local system pointer only for
separate control frames, applying the host shape and hotspot through
`--floe-desktop-cursor`. Embedded and unlabelled frames hide the local pointer so
there is exactly one cursor source. Cursor packets alone cannot change pixel
ownership. Retired generations cannot change the current pointer.

The viewer response policy permits the published player's `blob:` and `data:`
cursor images while restricting scripts, connections and framing to the session
boundary. Browser qualification uses this production policy and verifies cursor
image decoding, not just the overlay's visibility.

X11 supports separate shapes. Wayland can select portal cursor metadata when
advertised, keeping control pixels cursor-free and compositing remote cursor
position for view-only capture. Embedded-only Wayland and macOS display capture
retain a single captured pointer; those paths do not promise immediate local
movement. Transparent shapes remain transparent. Local movement does not imply
the host has processed input. Platform capability is not qualification evidence;
release and real-host validation must establish the selected capture path.
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

When a separate cursor packet is available, view-only mode renders its host
shape and position in a pointer-events-none layer over the fitted picture.
Control mode uses an immediate standard arrow until the hotspot is trusted, then
uses the host shape. An explicit hide packet and every generation transition
remove the old layer. Cursor geometry uses the same fitted-picture transform as
pointer input, including scrolling and fullscreen, while toolbar and dialog
controls retain the local pointer.

If locked media decoding fails, the viewer revokes unlock input, requests a new
keyframe and waits for a new generation plus painted frame before offering
Start unlock again. Initial ticket acquisition, nonresponsive control channels
and frame recovery share a ten-second deadline that exposes Reconnect and Disconnect;
it never replays queued key or pointer events. Explicit OS authorization keeps
its existing user-driven lifecycle; it is not cut short by the picture deadline.
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
