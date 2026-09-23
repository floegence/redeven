---
type: Interaction Contract
title: Client input for host applications
description: Own composition once on the client, bind confirmed text and keys to painted application windows, and recover without replay.
tags: [applications, input, linux, macos, desktop]
timestamp: 2026-09-23T08:00:00Z
---
# Summary

Published Floe remote-input owns keyboard and composition events in every streamed
Host Application viewer. The client chooses its input method, preedit and candidates;
the host delivers confirmed Unicode or key transitions to the current application.
One user operation has one owner and one output. Binding loss cancels composition
and releases held keys; reconnect never replays input. Old input protocols require
saving and reopening the application, without automatically ending its process.
This contract does not change Flower, terminal widgets or editor input.

# Client ownership

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
The toolbar Keyboard action explicitly focuses the existing textarea. Subsequent
content touches keep an already visible keyboard usable. Viewport occlusion changes
local geometry, never connection identity or the input element. Toolbar focus, page
blur, window replacement, disposal and reconnect cancel pending composition. A late
browser commit cannot acquire the next window's token.

# Linux delivery

Released `floe-native-apps` owns the capability probe, private input environment,
commit-only xcb-imdkit XIM bridge, GTK3/Qt5/Qt6 context adapters, prepared HTML client
and authenticated Xpra input scheduler. Redeven calls its public APIs before starting
a new application. The same implementation serves managed and supported system Xpra.
The exact Xpra Python interpreter is probed; the catalog's host GIO interpreter remains
independent. IBus/Fcitx configuration from the host desktop does not select input.

The prepared HTML v20/v21 client exposes `floeXpraInput.getClient()` and `floeInput`.
Original keyboard, tablet, virtual-keyboard and clipboard-focus listeners are absent.
Xpra retains graphics, window stacking, pointer and clipboard transport. The published
adapter consumes the controller's keys, clipboard gestures and commits; no global
listener suppresses a competing input owner. Redeven binds only a painted, live,
focused window and invalidates that token on destruction or reconnection.

Version 1 confirmed text travels over the existing authenticated Xpra connection.
The upstream scheduler preserves ordering between text commits, subsequent
keystrokes, focus changes, pointer events and clipboard claims. One commit is nonempty, NUL-free Unicode of at most 16,000 UTF-8
bytes; it is never split, truncated, retried or injected through the clipboard.
Missing/stale input contexts return an explicit failure. Failed delivery revokes the
attachment input and presents reconnection guidance; pending text is discarded.
No browser port or second reconnection path is added.

Recovery retains existing backend/component identity. A session predating version 1
cannot enter this input path; the viewer explains how to save and reopen it. Recovery
does not migrate a live input session or kill a process containing unsaved work.

# macOS delivery

Native window snapshots advertise `input_version: 1`. Each input packet uses that
version. Confirmed text uses the existing scoped Unicode injection; keys carry one
browser transition with explicit pressed, repeat and modifier fields. Direct printable
keys include their Unicode value, independent of the host's current input source.
The helper tracks native key identities and releases them on ownership loss together
with held mouse buttons. Production code never switches the host's global input source.

The [native macOS owner](macos-host-applications.md) retains foreground/window/permission
checks and event delivery receipts. A recoverable operation failure clears composition
and held keys, keeps the stream and pixels, and permits a new deliberate action.
It never retries the failed action. Same-window recapture can retain local focus but
rejects input until the replacement frame is decoded.

# Verification boundary

The [validation record](../operations/host-application-validation.md) distinguishes
controller event simulation, real app text receipts, real OS IME input and actual
mobile-device evidence. A sent packet, mobile viewport emulation or synthetic
composition event alone does not establish system input-method acceptance.

# Evidence

- `go.mod` and `internal/envapp/ui_src/package-lock.json`: released upstream versions.
- `internal/hostapps/setup.go` and `linux.go`: capability, launch preparation and surviving-process boundaries.
- `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`: published controller and CSS embedding.
- `internal/codeapp/appserver/host_application_viewer/macos.js` and `viewer.js`: platform bindings and lifecycle.
- `desktop/native/computer-host/Sources/RedevenComputerHost/Actions.swift` and `HostApplications.swift`: native transition validation and scoped delivery.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts` and `macHostApplicationViewer.test.ts`: first-pixel, composition, toolbar, touch and stale-target regressions.
- `internal/hostapps/client_input_test.go` and `scripts/check_host_application_input.mjs`: isolated real launch, browser transport and exact application text receipts.
