---
type: Interaction Contract
title: Pointer gestures for host applications
description: Scroll, click and drag remote applications through one client gesture owner while retaining browser pinch zoom and local controls.
tags: [applications, pointer, mobile, linux, macos]
timestamp: 2026-09-24T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe remote-pointer owns Linux/Xpra/macOS viewer gestures: swipe scroll, tap click, long press drag/right-click. Bind each to one painted window/generation. Cancellation drops queued movement/scroll and releases owned buttons. Remote-input owns composition. Missing capability requires save/quit/reopen; viewer closure neither upgrades nor stops the app.

# Contract

## Gestures and event ownership
A touch begins pending, without a remote button press.

Both motion paths use the same target authority, microtask coalescing, explicit flush and cancellation; platform bindings must not install another raw-event listener.

Leaving the document does cancel.

## Scroll and lifecycle
A finger moving up or left reveals content below or to the right.

The Linux native adapter submits fractional CSS-pixel deltas directly; its gesture release callback has no remainder and never releases keyboard input.

Each viewer owns its controller, feedback and transient remainder independently.

## Acceptance boundary
[Validation](../operations/host-application-validation.md) distinguishes generated browser events from actual native application receipts and physical mobile devices. Device emulation cannot qualify a real soft keyboard or pinch.

# Boundaries

A gesture cannot cross painted-window or connection generations. Reopening a viewer cannot upgrade the still-running application's pointer protocol.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/viewer.js` and `macos.js`: thin platform binding, target and toolbar lifecycle.

- `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`: published controller embedding.

- `desktop/native/computer-host/Sources/RedevenComputerHost/Actions.swift`: native wheel encoding.
