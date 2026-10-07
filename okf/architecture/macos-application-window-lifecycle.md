---
type: Runtime Contract
title: macOS application window lifecycle
description: Preserve shared applications through uncertain window inventories and end viewers only on confirmed native closure.
tags: [applications, macos, runtime, lifecycle]
timestamp: 2026-09-24T14:00:00Z
---
# Summary

Redeven's native helper owns macOS application-window lifetime. Its registry binds
exact AX windows to the selected process instance; capture surfaces do not define
window lifetime. Only confirmed destruction can start the last-window grace.
Uncertain inventory, unavailable capture and transport loss retain the session and
its recovery entrypoint while revoking stale input. Runtime preserves the helper's
explicit end reason; the shared viewer owns whether an established page can close.

# Contract

## Waiting and process lifetime

A running process without its first shareable window remains attached indefinitely;
there is no first-window termination deadline. Releasing the current client lease
during this wait ends that sharing lease normally; missing pixels do not turn a
lease release into a launch failure. The helper-launch deadline ends when
the bound process is reported, independently of pixel readiness. The viewer cancels
its connection deadline on a waiting event, shows explicit waiting guidance and
reconnect, and starts a separate bounded pixel deadline when a window appears.
Every new viewer receives the current waiting state. An unexpected helper exit
is a failed sharing session, not evidence that the host application ended.

## Window evidence

The window registry distinguishes present, unknown and confirmed-empty inventories.
It retains exact AX window identities when an inventory omits them, including
known offscreen WindowServer surfaces. Visibility helps select a capture source;
it never proves a known window has closed. An exact window-destruction notification
retires that window, including any cached surface. Retired surface identifiers are
kept only while present in the complete inventory; a newly bound AX instance
reclaims a reused identifier. A stale AX listing cannot resurrect a confirmed
destroyed window. Without that notification,
closure requires an explicitly invalid AX object and absence of its surface from
a complete WindowServer inventory. Child-control destruction, AX timeouts and
permission failures cannot prove closure. Unknown inventories reset the replacement
grace; only confirmed emptiness after a previously known window starts the existing
one-second grace. A replacement cancels it. No first-window deadline is introduced.

## Capture and recovery

Capture availability is independent of lifetime. Missing capture sources suspend
input and offer recovery without ending the application session. Window matching
prefers a unique visible surface over retired offscreen surfaces with identical
bounds. AX identity survives a capture-surface replacement while the input generation
is renewed; retired callbacks cannot update the replacement. Lifecycle diagnostics
record process identity, window tokens and state transitions without window contents
or input text.
Explicit reconnect restores a hidden or minimized application through AppKit/AX,
then resolves its current WindowServer source rather than validating a retired
pre-minimization surface. Single-operation failures retain the connection and current pixels with a localized
nonblocking notice. A capture failure preserves the control connection so another owned window or
native menu can still be selected; reconnect rebuilds capture and input delivery
for the same process. Locked/non-console sessions and revoked permissions invalidate
input, menus and capture once per transition and present distinct recovery guidance.
A confirmed process exit ends sharing normally even before the first window.
Failure to launch and unexpected helper loss remain failures; missing pixels do
not change a confirmed process exit into a failed launch.

## Terminal state

Terminal state retains the native end reason: `application_exited` confirms the
bound process exited, `windows_closed` confirms its last shared window closed,
and `sharing_stopped` confirms detachment. Closing windows and stopping sharing
never claim the process has quit. An unknown reason stays a generic ended session.
The helper is the authority; a quit request itself never supplies the end reason.
The [shared viewer recovery contract](host-application-viewer.md) owns terminal page
reload, status reconciliation, access failures and physical viewer closure.
The [lifecycle validation matrix](../operations/host-application-lifecycle.md)
separates automated recovery evidence from OS/application compatibility limits.

# Boundaries

Runtime shutdown releases capture, route and input ownership but preserves native
applications and unsaved data. A new Runtime lists them from the OS, but sharing
requires another explicit open action.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationWindows.swift`: registry reconciliation and monotonic replacement grace.
- `desktop/native/computer-host/Sources/RedevenComputerHost/Accessibility.swift`: exact AX destruction identity.
- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplications.swift`: single refresh owner, capture/input revocation and recovery.
- `internal/hostapps/macos.go`: helper termination mapping and transition-only diagnostics.
- `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationTests.swift`: omission, offscreen retention, restoration, destruction, residual surfaces, ID reuse and uncertainty.
- `scripts/check_host_application_lifecycle.mjs`: real browser popup close events with controlled transport and production assets.
- `scripts/check_macos_host_application_waiting.py`: disposable AppKit waiting, restoration and window replacement acceptance.

## September 24 verification limits

The changed helper passed 30 Swift tests. Chromium, Firefox and WebKit passed 21
controlled-stream lifecycle cases, recording decoded-frame acknowledgments,
status responses, the `dismissEnded` call stack and actual popup closure. A native
AppKit stop-before-window fixture confirmed that detachment preserves its process.
These results do not certify native pixels or desktop-space recovery.

Visible native AppKit and Electron acceptance could not pass in the available Mac
session: newly created test windows remained offscreen, AX enumerated no windows,
and Electron reported a hidden document with suspended animation frames. The
unchanged helper also failed to acquire its first frame in this environment.
Ghostty, real browser host windows, hiding/minimizing, fullscreen/Space transitions,
save cancellation and normal last-window closure remain unpassed for this change.
The earlier five Ghostty sessions ended with `windows_closed`; their original
browser close stack and triggering desktop action were not captured. Controlled
browser reproduction does not retroactively establish those missing facts.
