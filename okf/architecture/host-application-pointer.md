---
type: Interaction Contract
title: Pointer gestures for host applications
tags: [applications, pointer, mobile, linux, macos]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe owns swipe/tap/long-press gestures bound to painted window/generation. Cancel drops queued motion and releases buttons; remote-input owns composition. Missing capability requires explicit save/quit/reopen; closing viewer neither upgrades nor stops the application.

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
