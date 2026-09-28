---
type: Interaction Contract
title: Client input for host applications
description: Own composition once on the client, bind confirmed text and keys to painted application windows, and recover without replay.
tags: [applications, input, linux, macos, desktop]
timestamp: 2026-09-24T19:25:00Z
---
# Summary

Published Floe remote-input owns keyboard and composition events in every streamed
Host Application viewer. The client chooses its input method, preedit and candidates;
the host delivers confirmed Unicode or key transitions to the current application.
One user operation has one owner and one output. Binding loss cancels composition
and releases held keys; reconnect never replays input. Old input protocols require
saving, quitting and reopening the application, without automatically ending its process.
This contract does not change Flower, terminal widgets or editor input.

# Contract

## Client ownership

Redeven embeds `@floegence/floe-webapp-core/remote-input` and its stylesheet from the
published package. It supplies an immutable target token only after decoded pixels,
platform delivery callbacks, product copy and toolbar controls. It does not duplicate
composition state, DOM keyboard listeners or event-order deduplication.

The stable native textarea owns beforeinput, input, composition and key events.
Composition transactions consume confirmation, cancellation and candidate-navigation
keys locally. Final text is submitted once even when browsers order compositionend
and final input differently. Consecutive identical commits remain separate operations.
Ordinary physical input retains pressed/released transitions, repeat and modifiers;
soft deletion and line breaks work without physical keydown. Copy, cut and paste
have one handler per backend and cannot also produce an IME submission.

The textarea anchors near the latest content click, clamped by content bounds and
visualViewport. Before the first click it has a stable in-content default position.
It exposes local preedit only while composing and does not mirror the remote document.
Autocorrection, completion, capitalization and spellchecking are disabled; system
IME composition and candidate choice remain available. No input history or input-body
logging is introduced.

Touch content clicks position the remote caret without opening the system keyboard.
When returning from local toolbar controls, the Xpra viewer focuses its embedded
document before the shared textarea so Firefox can restore application typing.
The toolbar Keyboard action explicitly focuses the existing textarea. Subsequent
content touches keep an already visible keyboard usable. Viewport occlusion changes
local geometry, never connection identity or the input element. Toolbar focus, page
blur, window replacement, disposal and reconnect cancel pending composition. A late
browser commit cannot acquire the next window's token.

Pointer gestures have a separate [canonical contract](host-application-pointer.md).
Pointer cancellation releases only its buttons and wheel remainder, never keyboard
composition. Platform adapters flush pending pointer output before sending keys,
text or clipboard actions to preserve input order.

## Linux native delivery

The combined backend consumes the published helper protocol through an authenticated
Runtime stream. `remote-input` binds the exact connection/window/generation only
after a native PNG has painted. The protocol adapter maps physical keys to the
private seat keymap, preserves Command-to-Control shortcuts and native held-key
repeat, and submits confirmed characters when a client layout differs from that
keymap. It never registers another composition or gesture owner.

The upstream chooses one verified context adapter for a commit: native Wayland
text input with completion support, private GTK/Qt modules, XIM, or the package
IBus/portal interface. The one upstream scheduler orders confirmed text, ordinary
keys, pointer actions and clipboard publication. Socket flush is not application
consumption. Any failed transaction retires the attachment input and cancels
following operations; the viewer exposes explicit reconnect without replay.

Copy/cut initiates browser clipboard permission within the shortcut gesture and
resolves the selection when its native receipt arrives. Empty initial selections
never erase the client clipboard. Paste publishes the browser-provided text then
queues the native shortcut at the same ordering boundary; failed publication
cancels that shortcut. Text commits never use this clipboard path. System clipboard
normalization belongs to the browser/OS; confirmed Unicode remains byte-exact.

## Retained Xpra delivery

Released `floe-native-apps` owns the capability probe, private input environment,
commit-only xcb-imdkit XIM bridge, GTK3/GTK4/Qt5/Qt6 context adapters, prepared HTML client
and authenticated Xpra input scheduler. Redeven calls its public APIs before starting
a new application. The same implementation serves managed and supported system Xpra.
The exact Xpra Python interpreter is probed; the catalog's host GIO interpreter remains
independent. IBus/Fcitx configuration from the host desktop does not select input.

The current `PreparedViewer` has one SDK capability result for display, input and
pointer support. Linux never rejects the whole viewer because an application's
historical preparation version differs. Text and pointer protocols remain version
1 and unsupported input stays disabled. GTK4 modules use a private GTK_PATH
separate from the GTK3 cache; no generic GIO module path or host setting changes.

The prepared HTML v20/v21 client exposes `floeXpraViewer.getClient()`, `floeInput`
and versioned `floePointer`. The pointer adapter reuses Xpra's existing pointer,
button and fine/discrete wheel transport, owns per-connection scroll remainder,
and clears it on cancellation or target change. Canvas, screen, touch, wheel,
tablet, intermediate window mousedown and virtual-keyboard listeners from the old path are absent. Xpra retains
graphics, window stacking and clipboard transport. The published adapter consumes
the controller's pointer, keys, clipboard gestures and commits; no global listener
suppresses a competing input owner. Redeven binds only a painted, live,
focused window and invalidates that token on destruction or reconnection.

Version 1 confirmed text travels over the existing authenticated Xpra connection.
The upstream scheduler preserves ordering between text commits, subsequent
keystrokes, focus changes, pointer events and clipboard claims. One commit is nonempty, NUL-free Unicode of at most 16,000 UTF-8
bytes; it is never split, truncated, retried or injected through the clipboard.
Missing/stale input contexts return an explicit failure. Failed delivery revokes the
attachment input and presents reconnection guidance; pending text is discarded.
No browser port or second reconnection path is added.

Recovery retains the backend, component identity and loaded modules. Current
viewer resources have the independent [share snapshot lifetime](host-application-viewer-resources.md).
The SDK reports `restart-required` only for an authenticated incompatible loaded
module registration. Unknown input protocols disable affected input while retaining
pictures and local controls. Missing focus/context, transport failure and ordinary
reconnection never imply a module upgrade; existing recovery discards pending text
and never replays it. No loaded module is replaced and no process is killed.

## macOS delivery

Native window snapshots advertise `input_version: 1`. Each input packet uses that
version. Confirmed text uses the existing scoped Unicode injection; keys carry one
browser transition with explicit pressed, repeat and modifier fields. Direct printable
keys include their Unicode value, independent of the host's current input source.
Committed line breaks retain their Unicode payload and native Return identity so
browser text controls do not discard them as ordinary character-key events.
The helper tracks native key identities and releases them on ownership loss together
with held mouse buttons. Production code never switches the host's global input source.

The [native macOS owner](macos-host-applications.md) retains foreground/window/permission
checks and event delivery receipts. The same `remote-pointer` controller feeds the
existing `down`/`up`/`move`/`scroll` packets, so macOS has no independent touch or
wheel gesture recognizer. A recoverable operation failure clears composition,
pointer state and held keys, keeps the stream and pixels, and permits a new deliberate action.
It never retries the failed action. Same-window recapture can retain local focus but
rejects input until the replacement frame is decoded.

## Verification boundary

The [validation record](../operations/host-application-input-validation.md) distinguishes
controller event simulation, real app text receipts, real OS IME input and actual
mobile-device evidence. A sent packet, mobile viewport emulation or synthetic
composition event alone does not establish system input-method acceptance.

# Boundaries

Binding loss cancels composition and releases held keys without replay. The macOS helper protocol retains its existing save/restart compatibility boundary; Linux uses the SDK capability decisions above. This input boundary does not change Flower, terminal or editor input.

# Evidence

- `go.mod` and `internal/envapp/ui_src/package-lock.json`: released upstream versions.
- `internal/hostapps/setup.go` and `linux.go`: capability, launch preparation and surviving-process boundaries.
- `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`: published controller and CSS embedding.
- `internal/codeapp/appserver/host_application_viewer/macos.js` and `viewer.js`: platform bindings and lifecycle.
- `desktop/native/computer-host/Sources/RedevenComputerHost/Actions.swift` and `HostApplications.swift`: native transition validation and scoped delivery.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts` and `macHostApplicationViewer.test.ts`: first-pixel, composition, toolbar, touch and stale-target regressions.
- `internal/hostapps/client_input_test.go` and `scripts/check_host_application_input.mjs`: isolated real launch, browser transport and exact application text receipts.
