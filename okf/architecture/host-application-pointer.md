---
type: Interaction Contract
title: Pointer gestures for host applications
description: Scroll, click and drag remote applications through one client gesture owner while retaining browser pinch zoom and local controls.
tags: [applications, pointer, mobile, linux, macos]
timestamp: 2026-09-24T00:00:00Z
---
# Summary

Published Floe remote-pointer owns content pointer events in Linux native/Xpra and macOS
viewers. Touch swipes scroll; taps click; long presses provide drag or right click.
A gesture stays bound to one painted window instance and connection generation.
Cancellation drops queued movement and scroll and releases only its own buttons.
Keyboard composition stays with [remote-input](host-application-input.md). Missing
pointer capability requires saving, quitting and reopening the application; closing
only its viewer does not upgrade or terminate the application process.

# Contract

## Gestures and event ownership

A touch begins pending, without a remote button press. Movement beyond 8 CSS pixels
starts scrolling. After 450 ms without that movement, a local hold indicator appears:
moving then starts a left drag at the original point; releasing without movement
sends one right click. A tap sends an immediate click. Two taps on the same target
within 350 ms and 16 CSS pixels produce the second click's double-click count.

The shared controller also owns direct mouse/pen actions, hardware wheel units and
compatibility mouse suppression. Platform bindings map coordinates and encode
protocols; they do not recognize gestures. Xpra retains rendering, stacking,
clipboard and window decoration operations. Its old content mouse, wheel and touch
handlers are absent. A decoration operation explicitly cancels the content gesture.

The touch policy marks only remote pixel canvases. Local toolbar controls, window
lists and the native editable input retain their own browser behavior. Touch scrolling
does not move the input-method anchor or open the soft keyboard. Tap/drag activation
coordinates content focus; the toolbar Keyboard button explicitly opens the keyboard.
Focusing the child input is internal to the Xpra viewer, so the parent window's
corresponding blur must not cancel that activation. Leaving the document does cancel.

## Scroll and lifecycle

A finger moving up or left reveals content below or to the right. Both axes use CSS
pixels independent of DPR and captured-image density. Per-frame accumulation keeps
the whole distance, and scrolling stays locked to its initial window and hit position,
including across nested areas. Normal release flushes the final queued delta and
stops; cancellation drops it. There is no inertia or persistent gesture setting.

The Linux native adapter submits fractional CSS-pixel deltas directly; its gesture
release callback has no remainder and never releases keyboard input.
Xpra owns fine/discrete wheel quantization and its target-local remainder. The macOS
binding accumulates fractions before encoding integer CoreGraphics pixel wheels;
its release callback clears that remainder without sending keyboard release. The
native event constructor converts horizontal and vertical signs for WindowServer
once, retaining the host's natural-scrolling compensation.

A second touch cancels the current gesture and releases held buttons. All touches
must leave before another single-finger gesture can start. Browser pinch zoom stays
available. Pointer cancellation, capture loss, hidden pages, document blur, toolbar
activation, disconnect, disposal, target replacement and geometry changes cancel
old work. Late animation frames and timers cannot bind a new window or connection.
Viewport changes never rebuild the connection or input element. Each viewer owns
its controller, feedback and transient remainder independently.

## Acceptance boundary

[Validation](../operations/host-application-validation.md) distinguishes generated
browser events from actual native application receipts and physical mobile devices.
Application scroll offsets, click counts and slider values prove delivery; sent
packets alone do not. Device emulation cannot qualify a real soft keyboard or pinch.

# Boundaries

A gesture cannot cross painted-window or connection generations. Cancellation discards queued moves and scroll and releases only its own buttons. Reopening a viewer cannot upgrade the still-running application's pointer protocol.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/viewer.js` and `macos.js`: thin platform binding, target and toolbar lifecycle.
- `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`: published controller embedding.
- `desktop/native/computer-host/Sources/RedevenComputerHost/Actions.swift`: native wheel encoding.
- `internal/envapp/ui_src/src/styles/hostApplicationPointer.browser.test.tsx`: real browser mouse input, synthetic touch routing and composition isolation.
- `desktop/scripts/fixtures/host-application-titlebar.ts`: Electron adapter receipts before and after reconnect.
- `internal/hostapps/client_input_test.go`, `internal/hostapps/client_macos_pointer_test.go` and `scripts/host_application_pointer_acceptance.mjs`: task-owned native controls and application receipts.
