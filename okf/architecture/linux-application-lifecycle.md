---
type: Runtime Contract
title: Linux application instances and independent sharing
description: Preserve owned Linux graphical applications across viewer and Runtime lifetimes, with verified recovery and explicit process termination.
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
display, a host reboot or external cgroup cleanup cannot preserve an application dependent on that display.

# Contract

## Instance and sharing ownership

One instance has an opaque ID, authorized owner, application metadata, kernel
boot/PID/start identity, component identity, backend and versioned private record.
Version 3 discriminates Xpra's loopback address from the native helper's private
authenticated endpoint. The endpoint binds the same instance and private socket;
a reusable window ID or persisted PID alone never grants authority. One store lock
serializes admission/recovery. Unknown, ambiguous and future records are read-only
failures. The backend is immutable for the instance's lifetime.

Supported version 1 records identify their installed component from live kernel
evidence, then advance through version 2 to version 3 Xpra records. Version 2 also
advances to version 3. Each recovered record is atomically replaced only after
original-component and private-backend validation. Xpra verifies its session name;
native recovery validates a bounded helper receipt against PID/start/instance.
No record is rewritten to the current recommended backend. Unverifiable records
never authorize terminating the surviving process. Old components remain owned
by those instances; [preparation](host-application-preparation.md) is independent.

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

The published supervisor owns GIO launch, descendant/sandbox identity, launcher
exit status and application lifetime. Preparation, actual launcher failure,
application exit, window presence and first pixels are separate observations.
There is no first-window or unconfirmed-startup termination timeout. Explicit
launcher failures retain stage, code and observed exit status; capture failure,
a disconnected viewer or an HTTP error cannot manufacture application exit.

Native sharing waits for the helper's prepared receipt. One authenticated local
attachment carries bounded window/state, negotiated image frame, cursor, input and clipboard
messages. Exactly one reader multiplexes browser and product-control replies.
A new viewer takes over the old attachment; cleanup checks the exact owner so an
old connection cannot revoke its successor. Passive status reads inspect the
bounded atomic receipt and never attach. Product controls reuse an active
attachment, or create a short-lived attachment only when no viewer owns it.

The viewer acknowledges frames only after decoding/painting; no transport receipt
pretends to be pixels or application text consumption. Missing windows and capture
remain recoverable. Runtime shutdown or viewer closure revokes only the share,
not the helper. Recovery keeps the same application and modules, creates new
credentials/generations and never replays pending input. Xpra retains its published
readiness, final-window and audio-disable contracts.

## Browser profile ownership

Redeven supplies one stable private browser-profile directory per authorized
owner and catalog application under its canonical state root. Only the released
planner decides which native/deb/rpm Chrome, Chromium or Firefox launcher supports
that profile. Explicit application profile arguments remain authoritative, and
sandboxed package launch contracts are unchanged. The upstream launcher validates
private ownership, permissions and path integrity before use.

This prevents a browser's existing personal-desktop singleton from absorbing a
remote launch. Personal profiles and their singleton locks are never read, copied,
unlocked or terminated. The remote profile persists across viewer detach and app
restart. Failure to prepare it is a localized storage/permissions error. An
observed process-tree exit before its first window is an explicit no-window launch
failure even when the exit status is zero; a still-live process can continue waiting.

## Normal close and explicit force quit

The Linux ordinary operation is named Close all windows because these Linux backends have no
universal application-level graceful quit API. Both the viewer and library request
normal closure of current top-level windows, excluding transients, modal save
dialogs, trays and override-redirect surfaces. Save prompts and cancellation remain
application-owned. A background process may survive after every window closes.

A separate library Force quit action requires a second explicit confirmation
warning about unsaved work. It validates the caller, application and exact current
instance, checks the live private backend identity, then requests the selected upstream supervisor to terminate the owned instance.
The monitored launcher terminates only its owned descendants using pidfds and
verified parent relationships. This path never follows ordinary close, disconnect,
save cancellation or an uncertain response automatically. Stale or foreign
instances are rejected. An accepted request is not proof of process exit; running
snapshots remove the row only when the kernel confirms termination.

# Boundaries

Recovery requires the original private state and host OS user. A host reboot,
external process cleanup or destroyed compositor/X server cannot be repaired by reconnecting.
The Runtime never adopts unrelated desktop processes or recreates them from a
stale record. Ordinary closure always preserves native save/cancel decisions.

# Evidence

- `internal/hostapps/linux.go`: records, kernel/endpoint validation, admission, readiness and explicit controls.
- `internal/hostapps/application_proxy.go`: connection revocation including WebSocket hijacks.
- `internal/hostapps/desktop_transport.go` and `desktop_transport_linux_test.go`: authenticated native attachment, bounded correlation and takeover.
- `internal/hostapps/desktop_installed_test.go`: real input/save and same-helper Runtime recovery.
- `internal/hostapps/linux_lifecycle_test.go`: delayed window, save cancellation, credential rotation, shutdown admission, real Runtime process exit, restoration and owned descendant termination.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: waiting, new-window paint, last-window closure and reconnect behavior.
- `internal/hostapps/component_update_test.go`: component binding, v1 record migration, same-process recovery and new-instance selection after an Xpra-to-combined recommendation update.
- [Floe Native Apps v0.4.0](https://github.com/floegence/floe-native-apps/releases/tag/v0.4.0): released lifetime, exact installation resolution and process identification.
