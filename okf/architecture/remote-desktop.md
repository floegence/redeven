---
type: Runtime Contract
title: Human remote desktop sessions
description: Share the host's current graphical desktop with an authenticated viewer, exclusive remote input, and bounded media.
tags: [runtime, desktop, applications, security, media]
timestamp: 2026-10-04T13:20:00Z
---
# Summary

Redeven owns remote desktop authorization, ephemeral sessions, window placement,
configuration and audit. Published `floe-native-apps` v0.22.10 owns current-desktop
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
owned port forward per session. The returned `target_url` is its canonical
loopback origin, also used for target ownership; the viewer path stays separate
under the [launcher contract](remote-desktop-launcher.md). Each session requires a separate 90-second attachment
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

The [persistent authorization contract](remote-desktop-authorization.md) owns
first approval, saved-grant recovery, explicit per-connection consent, and local
credential reset. Product sessions remain ephemeral even when system approval
is saved. Locking is an explicit operation. Locked, switched or uncapturable
sessions cannot retain input, clipboard or audio authority. Remote unlock is
supported only where the actual OS permits it; disk unlock and a login without
a graphical user session are outside this contract.

An authorized macOS connection created while locked remains suspended with its
native observer running. It captures no video or audio and accepts no input until
normal local unlock produces a fresh frame. If a backend rejects the initial
connection as `LOCKED`, the viewer exposes explicit reconnect after local unlock;
that rejected connection has no capture observer. Previously active connections
follow the native observer's recovery events. Every recovered attachment must
paint a fresh current-generation frame before input is enabled.

When a Wayland display configuration retires the authorized PipeWire node,
`DISPLAY_STREAM_LOST` revokes held input and old frame authority and requires
a replacement RemoteDesktop portal attachment. The viewer reconnects using the existing product session
and its completed OS grant where supported. Retired pipeline errors cannot
invalidate a successor. Codec or audio failures retain their separate suspended
failure boundary; they do not select another desktop.

`remote_desktop.last_display_id` stores the last active selection in the existing
host configuration. The launcher and viewer select that display when it still
exists, otherwise the primary display. This preference is shared by authorized
users of the host; it contains no connection credential.
Capability normalization also applies to a retried connection after accepting or
declining takeover, so a removed display cannot return through the stored request.

## Media and office interaction

Control and media travel through separate Flowersec native proxy streams bound
to the same product attachment. The [graphical window transport](graphical-window-transport.md)
contract owns direct/tunnel composition, resource authority and raw-route rejection.
Video uses low-latency H.264 and static PNG refinement;
system-output audio uses Opus. The published browser player negotiates available
WebCodecs configurations, bounds encoded/decoded/audio queues, and confirms paint
after a rendering opportunity and its following task. Decoder preference is displayed as preference,
not proof of the physical decoder. Dependent H.264 frames cannot be dropped as
independent images; recovery requires a fresh keyframe boundary.

The [viewer interaction contract](remote-desktop-viewer.md) owns toolbar layout,
input modes, clipboard, local cursor presentation, fullscreen and disconnect
feedback. Native session and frame authority remain governed by this concept.

# Boundaries

There is no Windows host, virtual-desktop provisioning, pre-login service,
microphone/camera/printer redirection, WebRTC negotiation or new public port.
Browser media requires WebCodecs and HTTPS or a trustworthy local origin. The
[acceptance record](../operations/remote-desktop-results.md) owns measured
quality claims; a connected picture is not a 60 FPS certification.

## Low-delay media

The published player draws every current decoded picture immediately. A cumulative
paint receipt names only the latest picture unchanged across a rendering opportunity
and its following task. Replaced pictures do not receive individual paint receipts;
reset cancels retired authority. PNG refinement decoding cannot serialize later
H.264 decoding. Encoded reference dependencies remain ordered and bounded.

Linux NVIDIA encoding uses the published component's verified glibc 2.31 worker
and the installed NVIDIA driver, independently of its musl capture/media stack.
A synthetic encode probe selects the backend; actual dimensions must then encode
successfully. No system package, host FFmpeg, privileged operation or library-path
injection is required. The worker uses private bounded pipes, one outstanding
picture, zero B frames/lookahead and explicit zero-reorder H.264 SPS restrictions.
An active encoder failure suspends media; it cannot silently replace a reference
chain. The portable software encoder remains the explicit capability fallback.
X11 readback, scaling, IPC and GPU upload still copy pixels. This does not claim
zero-copy capture or certify hardware decode from a browser preference string.

# Evidence

- `internal/remotedesktop/manager.go`, `internal/remotedesktop/attachment.go` and `internal/remotedesktop/socket_test.go`: ownership, paired attachment credentials, current-frame input and socket retirement.
- `internal/codeapp/appserver/remote_desktop.go` and `internal/codeapp/appserver/remote_desktop_test.go`: API/full-permission boundary, owner checks and private viewer bootstrap.
- `internal/localui/localui.go` and `internal/localui/native_codespace.go`: Local UI access-session cancellation for desktop forwarding.
- `desktop/native/computer-host/Package.swift` and `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationHost.swift`: exact upstream package and shared native control owner.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: published player integration and browser interaction acceptance.
- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.tsx` and `desktop/src/main/hostApplicationWindow.ts`: product entry, preparation and exact-window native actions.
