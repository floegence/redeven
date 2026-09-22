---
type: Runtime Contract
title: macOS application capture process ownership
description: Share one native capture process while preserving independent application channels, frame credit and lifecycle.
tags: [runtime, applications, macos, capture, security]
timestamp: 2026-09-22T01:30:00Z
---
# Summary

The host application Manager owns one lazily started Swift helper for its Runtime
lifetime. All catalog requests and human-operated application sessions use that
process. Suspending one application must not interrupt another application's
capture. Application identity, viewer authorization, input, frame credit and
cleanup remain independent. A helper crash fails its current sharing sessions
without quitting native applications; a later explicit open may start a new
helper. The [native application contract](macos-host-applications.md) owns OS
permissions and process/window validation.

# Process and channel ownership

The Runtime must not start a separate persistent capture helper for each
application. On the tested macOS host, leaving one process alive after stopping
its stream and then starting capture in another process reproduced `SC_-3805`
and repeated replayd connection interruptions. Recreating applications, adding
startup sleeps or repeatedly retrying the same conflicting processes does not
resolve the ownership problem.

One Runtime-owned process handles host-application protocol version 2. Each request
and response carries an opaque `session_id` assigned by the Runtime's channel
owner. The Runtime overwrites any supplied routing field before sending a request;
the renderer never chooses a native channel. The helper dispatches control on its
main run loop and routes asynchronous pictures and events back to their exact
channel. This private protocol requires a matching Runtime/helper bundle. It does
not change the browser WebSocket or Computer Use protocols.

Each application channel retains its own bound OS process, window generation,
capture/encoder, menu handles, held input and single-frame acknowledgement credit.
Closing a viewer suspends only its application's capture and input delivery.
Ending sharing detaches only that channel and releases its resources; neither
operation exits the shared helper or quits the native application. Normal startup
keeps the existing immediate picture negotiation and low-latency first-frame path.

Catalog, validation, native-open and permission requests use short-lived channels
on the same process. They do not create additional AppKit helper processes. Empty
channel inventory leaves the helper idle until the Runtime closes, so the next
application uses the same ScreenCaptureKit process identity.

# Failure and shutdown

Each response channel has a bounded 128-message queue, preserving the supported
operation-result burst. A stalled consumer closes only its own channel and cannot
block another application's pictures or controls. Late messages for detached
channels are ignored. Closing a channel prevents further commands from recreating
its binding. Existing per-viewer authorization and response bounds still apply.

Malformed native routing or helper exit closes all channels from that helper.
Current sessions fail explicitly; the Runtime does not silently replay launches
or input. A later new channel can acquire a fresh helper after the failed process
has been reaped. Runtime shutdown first cancels session/viewer ownership, then
closes the helper input, allows bounded cleanup, and reaps that exact process.
Overlapping detach and host shutdown both receive completion after the native
capture stops. Native applications and their unsaved work survive this shutdown.

# Evidence

- `internal/hostapps/macos_host.go` and `macos_host_test.go`: shared process ownership, routing, backpressure, closed-channel fencing and process reaping.
- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationHost.swift` and `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationHostTests.swift`: protocol admission and independent native channel lifecycle.
- `scripts/check_macos_host_application_concurrency.py`: real suspend-then-open reproduction, alternating reconnects, independent frame credit, and detach while another application remains active.
- `scripts/check_macos_host_application_startup.py`: unchanged single-application startup, negotiation and reconnect latency checks.
