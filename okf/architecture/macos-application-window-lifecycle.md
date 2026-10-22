---
type: Runtime Contract
title: macOS application window lifecycle
description: Preserve shared applications through uncertain window inventories and end viewers only on confirmed native closure.
tags: [applications, macos, runtime, lifecycle]
timestamp: 2026-09-24T14:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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
A running process without its first shareable window remains attached indefinitely; there is no first-window termination deadline. Releasing the current client lease during this wait ends that sharing lease normally; missing pixels do not turn a lease release into a launch failure. An unexpected helper exit is a failed sharing session, not evidence that the host application ended.

## Window evidence
The window registry distinguishes present, unknown and confirmed-empty inventories. No first-window deadline is introduced.

## Capture and recovery
Capture availability is independent of lifetime. AX identity survives a capture-surface replacement while the input generation is renewed; retired callbacks cannot update the replacement. Failure to launch and unexpected helper loss remain failures; missing pixels do not change a confirmed process exit into a failed launch.

## Terminal state
Terminal state retains the native end reason: `application_exited` confirms the bound process exited, `windows_closed` confirms its last shared window closed, and `sharing_stopped` confirms detachment. Closing windows and stopping sharing never claim the process has quit. The [lifecycle validation matrix](../operations/host-application-lifecycle.md) separates automated recovery evidence from OS/application compatibility limits.

# Boundaries

Runtime shutdown releases capture, route and input ownership but preserves native applications and unsaved data. A new Runtime lists them from the OS, but sharing requires another explicit open action.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationWindows.swift`: registry reconciliation and monotonic replacement grace.

- `desktop/native/computer-host/Sources/RedevenComputerHost/Accessibility.swift`: exact AX destruction identity.

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplications.swift`: single refresh owner, capture/input revocation and recovery.
