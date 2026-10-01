---
type: Runtime Contract
title: Human remote desktop sessions
description: Share the host's current graphical desktop with an authenticated viewer, exclusive remote input, and bounded media.
tags: [runtime, desktop, applications, security, media]
timestamp: 2026-10-01T17:30:00Z
---
# Summary

Redeven owns remote desktop authorization, ephemeral sessions, window placement,
configuration and audit. Published `floe-native-apps` v0.22.2 owns current-desktop
selection, OS authorization, native input, capture, codecs and bounded playback.
A desktop session shares the existing signed-in macOS or Linux desktop. It never
creates an application-private desktop, changes system security policy or grants
access to a lower-permission user. Disconnect releases remote input and media;
host applications and unsaved work survive. Platform unavailability revokes
input and requires a fresh active frame before recovery.

# Contract

## Admission and ownership

`/_redeven_proxy/api/remote-desktop` is independent from application launch.
Read permission allows capability and component-status queries. Session creation,
settings, setup mutations, session reads, control, media and viewer assets require
read, write and execute permission together. View-only is an input mode, not a
permission exception. Every session and forward belongs to the authenticated
user; renderer-supplied identity never authorizes a route.

The Runtime holds at most eight ephemeral desktop sessions. It registers an
owned port forward per session and requires a separate 90-second attachment
secret on both WebSocket subprotocols. A secret does not appear in a URL, page
source or audit. A new ticket waits for the old native attachment to release its
input and authorization lease. Each ticket admits one
control socket and one media socket; both must attach before native work starts.
Unattached and disconnected sessions expire after two minutes. Runtime restart
invalidates every session and secret; reconnect starts a new product session.

One physical desktop has one remote control owner. A second desktop requires
explicit takeover. The old attachment releases held input before its successor
is admitted and reconnects view-only. On macOS, the shared helper also arbitrates
between application and desktop channels. Application capture retains its owned
process, window generation and foreground checks. Ordinary window events cannot
restore a revoked controller. The host's local keyboard and pointer remain usable.

Native authorization-in-progress is not a viewer mode change. Only an active
native state may update the requested view/control mode. Server input additionally
requires the current product controller, active generation and acknowledgement of
a frame actually offered on that attachment. Display changes, capture recovery,
mode changes, disconnect and stale generations revoke painted authority. Queued
input never transfers to a successor attachment. Local UI logout cancels live
desktop proxy requests; a product permission-policy update removes sessions whose
owners no longer have full permission for both the environment and its forward.
The same policy fences new admission under the manager lock, so an HTTP request
authorized before revocation cannot recreate the removed desktop.

## Platform boundary

macOS uses the exact remote Swift package in the existing Runtime helper. Catalog,
application and desktop channels share one capture process. The application
picture adapter exposes only application settings, preventing app requests from
enabling desktop audio, native-pixel or pipeline flags. Desktop binary media uses
an inherited pipe distinct from control. Media backpressure retires its channel.
See [capture ownership](macos-application-capture-owner.md) for process lifecycle.

Linux prepares and verifies the published host-desktop component catalog through
the upstream Manager. It launches the published helper with separate control and
media pipes and a private authorization directory. The upstream identity resolver
chooses one authenticated current-user Wayland or X11 login. Wayland uses system
RemoteDesktop/ScreenCast portals and PipeWire; X11 uses verified login credentials.
Failure never selects an application-private display or silently changes backend.
Preparation does not install system packages, modify drivers or use a container.

`remote_desktop.unattended` defaults to false in existing configuration. Enabling
it permits reuse of completed OS grants and does not grant permission. Disabling
it closes current attachments. The Runtime must remain running; this feature does
not install a system service. Locking is an explicit operation. Locked, switched
or uncapturable sessions cannot retain input, clipboard or audio authority. Remote
unlock is supported only where the actual OS permits it; disk unlock and a login
without a graphical user session are outside this contract.

If the initial native connection is rejected because the host is locked, the
viewer shows the locked state and an explicit reconnect action after local
unlock. There is no active capture observer on that rejected connection. A new
attachment must paint a fresh frame before input is enabled. A previously active
connection suspended by locking follows the native observer's recovery events.

`remote_desktop.last_display_id` stores the last active selection in the existing
host configuration. The launcher and viewer select that display when it still
exists, otherwise the primary display. This preference is shared by authorized
users of the host; it contains no connection credential.

## Media and office interaction

Control and media travel through separately authenticated WebSockets bound to the
same product attachment. Video uses low-latency H.264 and static PNG refinement;
system-output audio uses Opus. The published browser player negotiates available
WebCodecs configurations, bounds encoded/decoded/audio queues, and confirms paint
on a subsequent animation frame. Decoder preference is displayed as preference,
not proof of the physical decoder. Dependent H.264 frames cannot be dropped as
independent images; recovery requires a fresh keyframe boundary.

The published Floe input and pointer controllers own client composition, physical
keys, pointer gestures and release. The viewer defaults to the host input method,
using physical keys from a direct-input client keyboard. Client-composed text is
sent only after explicitly selecting Paste client text. That operation replaces
the host text clipboard and uses the published native paste command on both
platforms. The settings describe this effect and require users to finish or cancel
host composition before switching. Changing the mode cancels the client's pending
composition; no text is replayed and no Escape/Enter is guessed on the host.
Advertised accessibility insertion does not guarantee Electron text insertion,
and simultaneous unfinished host/client composition is outside this input path.
This does not claim arbitrary Unicode can be represented as synthetic key presses.
Clipboard access
is text-only and tied to the active controller. A manual text panel remains
available when browser clipboard permission is unavailable. Clipboard contents,
keys, passwords and pixels never enter audit records.

The Host Applications page and Workbench launcher expose an independent remote
desktop entry. Desktop opens an isolated owned window; browsers open a separate
viewer. Each window presents one selected display. Fit and original-pixel modes
change local rendering/capture settings without resizing the host desktop.
Fullscreen offers a hideable, pinnable toolbar and an explicit exit. Desktop
uses the exact owning native window and waits for its fullscreen event before
accepting the next toggle; browsers use the document fullscreen API. Files opens
the existing environment file surface through the owning window/shell bridge.
Window closure and Disconnect end sharing only. New copy is explicit in every
shipped locale, and standalone controls consume released Floe appearance/input
assets.

# Boundaries

There is no Windows host, virtual-desktop provisioning, pre-login service,
microphone/camera/printer redirection, WebRTC negotiation or new public port.
Browser media requires WebCodecs and HTTPS or a trustworthy local origin. The
[acceptance record](../operations/remote-desktop-validation.md) owns measured
quality claims; a connected picture is not a 60 FPS certification.

# Evidence

- `internal/remotedesktop/manager.go`, `internal/remotedesktop/attachment.go` and `internal/remotedesktop/socket_test.go`: ownership, paired attachment credentials, current-frame input and socket retirement.
- `internal/codeapp/appserver/remote_desktop.go` and `internal/codeapp/appserver/remote_desktop_test.go`: API/full-permission boundary, owner checks and private viewer bootstrap.
- `internal/localui/localui.go` and `internal/localui/native_codespace.go`: Local UI access-session cancellation for desktop forwarding.
- `desktop/native/computer-host/Package.swift` and `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationHost.swift`: exact upstream package and shared native control owner.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: published player integration and browser interaction acceptance.
- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.tsx` and `desktop/src/main/hostApplicationWindow.ts`: product entry, preparation and exact-window native actions.
