---
type: Interaction Contract
title: Host application keyboard, pointer and composition
tags: [applications, input, linux, macos, desktop]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Published Floe controllers own keyboard, composition and pointer gestures; product adapters bind them to painted window generations. Clients own IME and hosts deliver confirmed keys/Unicode. Cancellation releases held input without replay, while qualification distinguishes generated events from real applications/devices.

# Contract

## Keyboard and composition
- Embed published remote-input/CSS. Each backend has one copy/cut/paste handler, excluding duplicate IME submission. Flush pending pointer output before keys/text/clipboard.
- Native Linux uses authenticated published helper transport without another gesture/composition owner. Browser/OS owns clipboard normalization; confirmed Unicode stays byte-exact.
- Upstream owns retained Xpra capability, private environment, commit-only XIM, toolkit adapters, prepared client and scheduler. Historical preparation version alone cannot reject a viewer, replace modules or kill processes.
- macOS advertises `input_version: 1` and never switches global input source. Same-window recapture may retain focus but rejects input until decoded replacement pixels.

## Pointer gestures
### Gestures and event ownership
A touch begins pending, without a remote button press.

Both motion paths use the same target authority, microtask coalescing, explicit flush and cancellation; platform bindings must not install another raw-event listener.

Leaving the document does cancel.

### Scroll and lifecycle
A finger moving up or left reveals content below or to the right.

The Linux native adapter submits fractional CSS-pixel deltas directly; its gesture release callback has no remainder and never releases keyboard input.

Each viewer owns its controller, feedback and transient remainder independently.

### Acceptance boundary
[Validation](../operations/host-application-validation.md#historical-distributioninput) distinguishes generated browser events from actual native application receipts and physical mobile devices. Device emulation cannot qualify a real soft keyboard or pinch.

# Boundaries

[Validation](../operations/host-application-validation.md#input-cursor-and-lifecycle-acceptance) distinguishes simulated events, app receipts, OS IME and physical mobile evidence. Sent packets, emulated viewports and synthetic composition alone do not certify system input acceptance.

A gesture cannot cross painted-window or connection generations. Reopening a viewer cannot upgrade the still-running application's pointer protocol.

# Evidence

- `go.mod` and `internal/envapp/ui_src/package-lock.json`: released upstream versions.
- `internal/hostapps/setup.go` and `linux.go`: capability, launch preparation and surviving-process boundaries.
- `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`: published controller and CSS embedding.

- `internal/codeapp/appserver/host_application_viewer/viewer.js` and `macos.js`: thin platform binding, target and toolbar lifecycle.
- `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`: published controller embedding.
- `desktop/native/computer-host/Sources/RedevenComputerHost/Actions.swift`: native wheel encoding.
