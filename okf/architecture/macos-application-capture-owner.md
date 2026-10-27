---
type: Runtime Contract
title: macOS application capture process ownership
description: Share one native capture process while preserving independent application channels, frame credit and lifecycle.
tags: [runtime, applications, macos, capture, security]
timestamp: 2026-09-22T01:30:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

One Manager-owned lazy Swift helper serves catalog, application and remote-desktop sessions for a Runtime. Suspend only the selected capture; identity, permissions, input, credit and cleanup stay independent. Helper failure ends sharing, not apps; explicit reopen may restart it. The native session contract owns OS permission and process/window validation.

# Contract

## Process and channel ownership
The Runtime must not start a separate persistent capture helper for each application.

Empty channel inventory leaves the helper idle until the Runtime closes, so the next application uses the same ScreenCaptureKit process identity.

## Physical desktop integration
The exact released `FloeNativeDesktop` package owns reusable capture and native desktop input. Desktop media uses a separate binary pipe and bounded per-channel queues so pictures do not serialize behind control messages.

## Failure and shutdown
Each response channel has a bounded 128-message queue, preserving the supported operation-result burst.

Native applications and their unsaved work survive this shutdown.

# Boundaries

Sharing sessions retain separate authorization, input and frame credit despite using one helper. Suspending one session cannot stop another capture. Helper failure ends its sharing sessions without quitting applications; only a later explicit open starts recovery.

# Evidence

- `internal/hostapps/macos_host.go` and `macos_host_test.go`: shared process ownership, routing, backpressure, closed-channel fencing and process reaping.

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationHost.swift` and `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationHostTests.swift`: protocol admission and independent native channel lifecycle.

- `scripts/check_macos_host_application_concurrency.py`: real suspend-then-open reproduction, alternating reconnects, independent frame credit, and detach while another application remains active.
