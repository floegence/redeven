---
type: Runtime Contract
title: Native macOS host applications
description: Real application discovery, direct local launch, owned remote window capture and human input on macOS.
tags: [runtime, desktop, applications, macos, security]
timestamp: 2026-09-21T03:00:00Z
---
# Summary

Redeven's macOS adapter owns native host application discovery and human-operated
window sessions. Application identity comes from installed bundles. A trusted
Desktop local-environment route launches the real app directly; remote access
captures the selected application's actual window, including an already running
single-instance app. Apps run as the Runtime user,
without containers, virtual machines, X11 or an independent desktop. The existing
[host application authorization](host-applications.md) applies to every operation
and stream. Missing permissions or graphical login block streaming explicitly.
Network loss preserves the app; reconnection attaches to the same process.

# Catalog and local launch

AppKit discovers applications in standard system/user application directories,
running application bundle paths, and explicit custom absolute `.app` paths.
Canonical bundle paths define identity; localized bundle metadata and system icons
define presentation. Unknown descriptions and categories remain empty. Arbitrary
executable arguments, invented product categories and renamed custom entries are
not part of this macOS catalog. Explicit custom paths are stored privately by
Redeven and do not change the system application menu.

Only a trusted Desktop session marked `local_environment` / `local_host` selects
direct native launch automatically. `NSWorkspace` opens or activates the actual
installed application. No streaming session, viewer, or forward is created. Local
launch requires a graphical login but no capture/input permission. Browser and
remote Desktop targets use the streaming route.

# Remote window ownership and transport

The packaged Swift helper exposes explicit host-application protocol version 1,
separate from its unchanged Computer Use protocol. AppKit opens or activates the
selected catalog bundle. The helper verifies the returned canonical bundle path
and binds its process, so single-instance applications reuse their existing
windows. The session records whether that process existed before the request.
Window IDs and menu handles must belong to this bound process. The browser cannot
supply an arbitrary PID, application path or capture source.

ScreenCaptureKit captures a selected application window on macOS 13 or newer.
Child-window inclusion uses the macOS 14.2 API when available. A native window list
allows selection among the bound process's windows. The current transport sends
JPEG frames over the authenticated WebSocket, at up to 20 frames/second and a
maximum 2560-pixel dimension; it is not an audio or hardware video stream. A latest
frame slot bounds buffering for slow/disconnected clients. A new capture generation
invalidates previous pixels and input coordinates. The viewer reveals only decoded
pixels, preserves aspect ratio, and requests real AX window resizing. macOS and
application minimum/maximum sizes can constrain the result.

An ephemeral loopback listener requires an unpredictable per-session credential
via WebSocket subprotocol, independently of the existing owner/full-permission
forward guard. Credentials never enter URLs. One connection owns input; replacement
revokes the old connection and releases held buttons before the new connection can
send input. Heartbeats detect lost peers. Reconnect refreshes capture without
launching another process. Capture/permission failure exposes explicit recovery;
old frames and callback generations cannot reactivate a disconnected view.

# Human control and lifecycle

Remote input shares the host's real graphical session and foreground. Screen
recording and accessibility grants are required. Explicit input activates and
raises the bound window; foreground identity, focused AX window and pointer hit
ownership must be verified before injection. A covered window fails the operation
instead of sending pointer input into another application. A process-scoped event
tap acknowledges only Redeven-marked input; the next event waits for that receipt,
without inspecting unmarked key contents or monitoring other applications. A
missing receipt fails without replaying the action. The viewer supports
mouse, wheel, native key chords and composed Unicode text. This is human control,
not a Flower automation or model-observation path. Password/privileged system
dialogs and OS-reserved shortcuts remain subject to macOS policy.

Application menus come from that app's actual accessibility menu tree; returned
opaque handles invoke the same enabled menu item. Closing a window presses its
real close action, preserving ordinary save/cancel dialogs. Ending from the library
requests graceful application termination only for a process newly launched by
that session and never force-kills it. For a previously running process, the
library presents **Stop sharing**: it disconnects without quitting the app or
closing its windows. Confirmed loss of the final window closes the physical
Redeven viewer; a network failure or close request by itself does not. Closing only the viewer preserves the app.
An unreadable accessibility inventory cannot confirm closure. The helper checks
both accessibility and visible WindowServer inventories and allows a one-second window
replacement interval before ending a previously visible session. A disappearing
ScreenCaptureKit source enters window-waiting state; it is not a capture fault.
Window matching prefers a unique visible surface over retired offscreen surfaces
with identical bounds. A proven window retains its opaque identity across inventory
refreshes and resize; input generations change only when capture is rebound.
Single-operation failures retain the connection and current pixels with a localized
nonblocking notice. Genuine capture failure offers an explicit reconnect action;
reconnection captures the same bound process and invalidates stale input.

Runtime shutdown releases capture, route and input ownership but preserves native
applications and unsaved data; the next Runtime does not silently reclaim them.

The integration does not provide a separate logged-out/headless AppKit session,
audio, remote file transfer, clipboard synchronization or secure desktop control.
Protected content, inaccessible custom controls, separate-process dialogs, and apps
with unusual window ownership require application-specific validation. macOS
13 API compatibility is a build contract, not a claim of testing every OS version,
Intel host or third-party application.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplications.swift`: bundle discovery, owned capture and input, menu and graceful window lifecycle.
- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationWindows.swift` and `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationTests.swift`: authoritative inventory and transient window lifecycle.
- `internal/hostapps/macos.go` and `macos_test.go`: helper resolution, stream credentials, connection ownership, native launch and cleanup.
- `internal/codeapp/appserver/host_application_viewer/macos.js` and `internal/envapp/ui_src/src/ui/services/macHostApplicationViewer.test.ts`: first frame, generation, IME, recovery and physical viewer closure.
- `scripts/check_macos_host_applications.py` and `scripts/fixtures/nativeHostApplication.swift`: disposable real-app pixel/input/menu/lifecycle acceptance.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.test.tsx`: trusted local launch and remote permission presentation.
