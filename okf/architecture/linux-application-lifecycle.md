---
type: Runtime Contract
title: Linux application instances and independent sharing
description: Preserve owned X11 applications across viewer and Runtime lifetimes, with verified recovery and explicit process termination.
tags: [runtime, applications, linux, lifecycle, security]
timestamp: 2026-09-22T05:00:00Z
---
# Summary

Redeven owns Linux application instances, caller authorization and ephemeral
sharing; the published Floe Native Apps module owns GIO launch and process-tree
observation. A live application outlives its viewers and window count. Closing a
viewer, stopping sharing or exiting Runtime never requests application termination.
After Runtime restart, the same host user and private state can recover a surviving
backend only after matching its kernel process generation and private endpoint
identity. No persisted PID alone authorizes signaling. Destroying the virtual
display, a host reboot or external cgroup cleanup cannot preserve an X11 app.

# Contract

## Instance and sharing ownership

One instance has an opaque ID, authorized caller owner, application metadata,
loopback address, kernel boot/PID/start identity, component identity, creation time and versioned private
record. It owns one isolated Xpra/Xvfb display and D-Bus session. A private store
lock permits one manager to admit or recover instances at a time. Unknown,
ambiguous or incomplete records fail closed without being rewritten. Dead process
generations cannot be reattached. Recovery resolves the instance's original tools
and also verifies Xpra's session name over the private control socket.

Version 2 records bind either the upstream component digest or a complete system
installation. Updating managed components affects only newly created instances;
control commands, environment and resumed sharing retain the original binding.
Version 1 records migrate atomically after upstream process-to-installation
identification and private backend verification. Recovery never substitutes the
current recommendation. Unknown or unverifiable bindings fail explicitly without
terminating the surviving process. Old component directories remain available;
the [preparation contract](host-application-preparation.md) owns their selection.

A share has its own ID, route, credential and connection-tracking proxy. Stopping
sharing closes HTTP and hijacked WebSocket connections immediately; deleting a
route alone is insufficient. A new share atomically rotates the backend credential
and reconnects the same application instance. Startup never silently re-executes
a surviving windowless app. The twelve-instance limit includes detached apps.
Running snapshots expose only instances owned by the authorized caller, including
those with no viewer or no windows. Linux cannot adopt arbitrary applications
already attached to another display.

The backend starts in an independent POSIX session without a Runtime-bound command
context. Orderly shutdown and a Runtime process exit release its proxy and store
lock while preserving that backend. Recovery creates a fresh sharing route; old
viewer URLs are not durable. OS service managers may still terminate a whole
cgroup, and host policy remains authoritative. Redeven never changes that policy.

## Launch and readiness

The upstream monitored GIO launcher becomes a child subreaper before launching and
reaps both direct and adopted descendants. Its lifetime, rather than the first
window or viewer, drives Xpra's child-exit policy. Viewer/client and last-window
exit policies remain disabled. Explicit launcher termination requires Linux
pidfds (kernel 5.3 or later and a compatible Python interpreter) and fails before
launch when unavailable. Applications delegating to unrelated existing services
are outside this owned child-tree contract.

A running receipt and responsive HTML endpoint admit sharing without an expensive
window-inventory probe. They do not prove pixels. An unconfirmed infrastructure
startup fails sharing after forty seconds while preserving the application; this
deadline never applies to a connected viewer waiting for its first window. After the authenticated Xpra
startup event, an empty inventory presents Waiting for a window indefinitely;
an actual new window starts the bounded first-paint check. Closing the final
established window dismisses the viewer while the application may keep running.
A later opening reconnects the same process and waits if it has no window.
Only the application can decide how to create another window; Linux has no
universal AppKit-style reopen action.

Silent sessions still use upstream's audio-disable policy. Application launch
logs measure backend readiness, not first decoded pixels. A confirmed application
exit ends sharing normally. A backend failure retains failed sharing state and
recovery guidance rather than claiming a normal application exit.

## Normal close and explicit force quit

The Linux ordinary operation is named Close all windows because X11 has no
universal application-level graceful quit API. Both the viewer and library request
normal closure of current top-level windows, excluding transients, modal save
dialogs, trays and override-redirect surfaces. Save prompts and cancellation remain
application-owned. A background process may survive after every window closes.

A separate library Force quit action requires a second explicit confirmation
warning about unsaved work. It validates the caller, application and exact current
instance, checks the live private backend identity, then requests Xpra shutdown.
The monitored launcher terminates only its owned descendants using pidfds and
verified parent relationships. This path never follows ordinary close, disconnect,
save cancellation or an uncertain response automatically. Stale or foreign
instances are rejected. An accepted request is not proof of process exit; running
snapshots remove the row only when the kernel confirms termination.

# Boundaries

Recovery requires the original private state and host OS user. A host reboot,
external process cleanup or destroyed X server cannot be repaired by reconnecting.
The Runtime never adopts unrelated desktop processes or recreates them from a
stale record. Ordinary closure always preserves native save/cancel decisions.

# Evidence

- `internal/hostapps/linux.go`: records, kernel/endpoint validation, admission, readiness and explicit controls.
- `internal/hostapps/application_proxy.go`: connection revocation including WebSocket hijacks.
- `internal/hostapps/linux_lifecycle_test.go`: delayed window, save cancellation, credential rotation, shutdown admission, real Runtime process exit, restoration and owned descendant termination.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: waiting, new-window paint, last-window closure and reconnect behavior.
- `internal/hostapps/component_update_test.go`: component binding, v1 record migration, same-process recovery and new-instance selection after r1-to-r2 update.
- [Floe Native Apps v0.4.0](https://github.com/floegence/floe-native-apps/releases/tag/v0.4.0): released lifetime, exact installation resolution and process identification.
