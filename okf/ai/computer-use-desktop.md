---
type: Desktop Integration Contract
title: Semantic desktop operations and explicit control
description: Use macOS window Accessibility and private Linux AT-SPI before image input while preserving user control.
tags: [ai, computer-use, accessibility, desktop]
timestamp: 2026-09-17T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

`ComputerUseRuntime` owns desktop target execution. macOS targets an explicit
application window; Linux owns a private Xvfb and D-Bus session. Semantic actions
use native accessibility first. A foreground operation requires current task
authorization and respects explicit Stop and takeover. Platform permissions do not prove
that every application or action can run unobtrusively in the background.

# Contract

## macOS windows
The Swift helper inventories regular and accessory application windows, reads AX roles, labels, non-sensitive values, supported actions and bounds, and exposes bounded subtree queries.

Secret fields enter the existing private takeover channel rather than model observations.

## Linux private desktop
The Xvfb owner starts a private session D-Bus and AT-SPI bus. The executor rejects socket or environment paths leading outside that private desktop; it never discovers or attaches to another logged-in user's session.

Product target preferences and canonical historical results follow their existing owners.

# Boundaries

Swift unit tests and real GTK/AT-SPI/Xvfb fixtures provide separate adapter proofs. Lock-screen operation remains outside the supported scope.

# Evidence

- `redeven:desktop/native/computer-host/Sources/RedevenComputerHost/Accessibility.swift` - window identity, AX observation and semantic actions.

- `redeven:desktop/native/computer-host/Sources/RedevenComputerHost/ForegroundInput.swift` - foreground authorization, delivery acknowledgements and conditional restoration.

- `redeven:desktop/native/computer-host/Sources/RedevenComputerHost/ScreenCapture.swift` - bounded window capture and exclusions.
