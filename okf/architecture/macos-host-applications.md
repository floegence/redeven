---
type: Runtime Contract
title: Native macOS host applications
description: Real application discovery, direct local launch, owned remote window capture and human input on macOS.
tags: [runtime, desktop, applications, macos, security]
timestamp: 2026-09-23T08:00:00Z
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
Network loss preserves the app; reconnection attaches to the same process. Explicit
quit is independent of sharing and binds to the selected OS process generations.

# Catalog and local launch

AppKit discovers applications in standard system/user application directories,
running application bundle paths, and explicit custom absolute `.app` paths.
Canonical bundle paths define identity; localized bundle metadata and system icons
define presentation. Unknown descriptions and categories remain empty. Arbitrary
executable arguments, invented product categories and renamed custom entries are
not part of this macOS catalog. Explicit custom paths are stored privately by
Redeven and do not change the system application menu. Launch resolution validates
current installed bundles and describes only the requested application, avoiding
full-catalog icon rendering. The streaming helper receives the validated application
ID and private custom-path inventory directly; it does not repeat a catalog export.

Only a trusted Desktop session marked `local_environment` / `local_host` selects
direct native launch automatically. `NSWorkspace` opens or activates the actual
installed application. No streaming session, viewer, or forward is created. Local
launch requires a graphical login but no capture/input permission. Browser and
remote Desktop targets use the streaming route.

The [application management contract](macos-application-management.md) owns live
OS inventory, explicit quit confirmation, process-generation validation and the
distinction between quitting an app and stopping its sharing session.

# Remote window ownership and transport

The [native capture owner](macos-application-capture-owner.md) uses one Swift process
and host-application protocol 2, separate from Computer Use. AppKit opens or activates the
selected catalog bundle. The helper verifies the returned canonical bundle path
and binds its process, so single-instance applications reuse their existing
windows. The session records whether that process existed before the request.
Window IDs and menu handles must belong to this bound process. The browser cannot
supply an arbitrary PID, application path or capture source.

ScreenCaptureKit captures a selected application window on macOS 13 or newer.
Child-window inclusion uses the macOS 14.2 API when available. A counted window selector in the [application toolbar](../desktop/host-application-titlebar.md) shows the current host window
title and is enabled whenever shareable windows are available. It opens a scrollable list of literal host window
titles with the current selection marked, independently of picture settings.
Untitled windows use the app name and inventory position; the viewer never invents
application-specific names. Selecting a window keeps the list open, dims retained
pixels and disables input until a frame from the new binding is decoded. Window
renames and inventory reordering preserve keyboard focus; removing the focused
window returns focus to the window button. Escape returns focus to the opener.
The list follows only the bound process's shareable AX windows, including floating
tool panels rather than only WindowServer layer zero. Proven window IDs remain
lifecycle evidence while their WindowServer surfaces exist, even if AX briefly
omits them. Unrelated menu and status-bar surfaces do not become application windows.
Passive system capture
chrome is excluded only when AX confirms no main-window activation, focus, modal
state or native window controls, and its activation point lies outside its bounds.
Missing metadata cannot exclude a window; hidden and minimized windows are retained.
This uses native interaction evidence, never application names or window titles.
A newly opened focused window
is selected automatically; inventory refresh does not override an explicit choice
among existing windows. Rapid explicit selections supersede in-flight capture
requests; retired callbacks cannot restore an earlier choice. Closing that window returns to a remaining owned window. The [picture and transport contract](macos-application-picture.md) defines Retina
sampling, live quality controls, hardware video, lossless still refresh and bounded
delivery. A new capture generation invalidates previous pixels and input coordinates.
The viewer reveals only decoded pixels, preserves aspect ratio, and requests real
AX window resizing. macOS and application minimum/maximum sizes can constrain the
result.

An ephemeral loopback listener requires an unpredictable per-session credential
via WebSocket subprotocol, independently of the existing owner/full-permission
forward guard. Credentials never enter URLs. One connection owns input; replacement
revokes the old connection and releases held keys and buttons before the new connection can
send input. The viewer first sends one `resume` request carrying its initial
picture/viewport settings. The adapter orders it after helper launch and rejects
control before negotiation or repeated negotiation on the same connection.
Heartbeats detect lost peers. Reconnect refreshes capture without
launching another process. Capture/permission failure exposes explicit recovery;
old frames and callback generations cannot reactivate a disconnected view.
Retired image decoders cannot delay a new connection, and pending pointer movement,
composition text and menus are discarded when their capture binding changes.
The [shared client input contract](host-application-input.md) owns composition,
keyboard transitions, candidate placement and soft-keyboard interaction. Local
focus during same-window recapture grants no remote input authority; composition
begun before decoded pixels cannot acquire permission by waiting for a frame.

# Human control and lifecycle

Remote input shares the host's real graphical session and foreground. Screen
recording and accessibility grants are required. Explicit input activates and
raises the bound window; foreground identity, focused AX window and pointer hit
ownership must be verified before injection. A covered window fails the operation
instead of sending pointer input into another application. A process-scoped event
tap acknowledges only Redeven-marked input; the next event waits for that receipt,
without inspecting unmarked key contents or monitoring other applications. A
missing receipt fails without replaying the action. The viewer supports
mouse, wheel, versioned key transitions and confirmed Unicode text. This is human control,
not a Flower automation or model-observation path. Password/privileged system
dialogs and OS-reserved shortcuts remain subject to macOS policy.

The [native application menu contract](macos-application-menus.md) owns scoped
menu export, live execution validation and toolbar navigation. Windowless viewers
retain application-menu access; system-wide Apple actions are never exported.
Window closure, sharing detachment and application quit follow the
[application management contract](macos-application-management.md): ordinary
closure preserves save/cancel dialogs, and only confirmed final-window loss
closes the viewer. Closing the viewer itself preserves the application.
A running process without its first shareable window remains attached indefinitely;
there is no first-window termination deadline. Explicitly stopping sharing during
this wait ends normally; missing pixels do not turn a user-requested stop into a
launch failure. The helper-launch deadline ends when
the bound process is reported, independently of pixel readiness. The viewer cancels
its connection deadline on a waiting event, shows explicit waiting guidance and
reconnect, and starts a separate bounded pixel deadline when a window appears.
Every new viewer receives the current waiting state. An unexpected helper exit
is a failed sharing session, not evidence that the host application ended.

An unreadable accessibility inventory cannot confirm closure. The helper checks
both accessibility and visible WindowServer inventories and allows a one-second window
replacement interval before ending a previously visible session. A disappearing
ScreenCaptureKit source enters window-waiting state; it is not a capture fault.
Window matching prefers a unique visible surface over retired offscreen surfaces
with identical bounds. A proven window retains its opaque identity across inventory
refreshes and resize; input generations change only when capture is rebound.
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

Terminal state retains the native end reason: `application_exited` confirms the
bound process exited, `windows_closed` confirms its last shared window closed,
and `sharing_stopped` confirms detachment. Closing windows and stopping sharing
never claim the process has quit. An unknown reason stays a generic ended session.
The helper is the authority; a quit request itself never supplies the end reason.
The [shared viewer recovery contract](host-applications.md) owns terminal page
reload, status reconciliation, access failures and physical viewer closure.
The [lifecycle validation matrix](../operations/host-application-lifecycle.md)
separates automated recovery evidence from OS/application compatibility limits.

Runtime shutdown releases capture, route and input ownership but preserves native
applications and unsaved data. A new Runtime lists them from the OS, but sharing
requires another explicit open action.

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
- `scripts/check_macos_host_applications.py`, `scripts/check_macos_host_application_waiting.py`, `scripts/check_macos_host_application_quit.py`, `scripts/check_macos_host_application_termination.py` and `scripts/fixtures/nativeHostApplication.swift`: disposable real-app pixel/input/menu/lifecycle acceptance.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.test.tsx`: trusted local launch and remote permission presentation.
