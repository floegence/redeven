---
type: Runtime Contract
title: Linux application instances and independent sharing
description: Preserve owned Linux graphical applications across viewer and Runtime lifetimes, with verified recovery and explicit process termination.
tags: [runtime, applications, linux, lifecycle, security]
timestamp: 2026-09-22T05:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns Linux application instances, caller authorization and ephemeral
sharing; the published Floe Native Apps module owns GIO launch and process-tree
observation. A live application outlives its viewers and window count. Closing a
viewer, releasing a share lease or exiting Runtime never requests application termination.
After Runtime restart, the same host user and private state can recover a surviving
backend only after matching its kernel process generation and private endpoint
identity. No persisted PID alone authorizes signaling. Destroying the virtual
display, a host reboot or external cgroup cleanup cannot preserve an application dependent on that display.

# Contract

## Instance and sharing ownership
One instance has an opaque ID, authorized owner, application metadata, kernel boot/PID/start identity, component identity, backend and versioned private record. The endpoint binds the same instance and private socket; a reusable window ID or persisted PID alone never grants authority.

Redeven never changes that policy.

## Launch and readiness
The published supervisor owns GIO launch, descendant/sandbox identity, launcher exit status and application lifetime. Preparation, actual launcher failure, application exit, window presence and first pixels are separate observations.

Xpra retains its published readiness, final-window and audio-disable contracts.

## Browser profile ownership
Redeven supplies one stable private browser-profile directory per authorized owner and catalog application under its canonical state root.

An observed process-tree exit before its first window is an explicit no-window launch failure even when the exit status is zero; a still-live process can continue waiting.

## Normal close and explicit force quit
The Linux ordinary operation is named Close all windows because these Linux backends have no universal application-level graceful quit API.

This path never follows ordinary close, disconnect, save cancellation or an uncertain response automatically. An accepted request is not proof of process exit; running snapshots remove the row only when the kernel confirms termination.

# Boundaries

Recovery requires the original private state and host OS user. A host reboot, external process cleanup or destroyed compositor/X server cannot be repaired by reconnecting. Ordinary closure always preserves native save/cancel decisions.

# Evidence

- `internal/hostapps/linux.go`: records, kernel/endpoint validation, admission, readiness and explicit controls.

- `internal/hostapps/application_proxy.go`: connection revocation including WebSocket hijacks.

- `internal/hostapps/desktop_transport.go` and `desktop_transport_linux_test.go`: authenticated native attachment, bounded correlation and takeover.
