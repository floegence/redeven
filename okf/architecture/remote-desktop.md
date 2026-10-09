---
type: Runtime Contract
title: Human remote desktop sessions
description: Share the host's current graphical desktop with an authenticated viewer, exclusive remote input, and bounded media.
tags: [runtime, desktop, applications, security, media]
timestamp: 2026-10-08T08:00:00Z
---
# Summary

Redeven owns remote desktop authorization, ephemeral sessions, window placement,
configuration and audit. Published `floe-native-apps` v0.22.32 owns current-desktop
selection, OS authorization, native input, capture, codecs, bounded playback and
Linux component acquisition and the privileged physical-desktop service.
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

Linux Desktop SSH uses the administrator-authorized system service described in
the [SSH deployment contract](remote-desktop-ssh-deployment.md). The service captures
the qualified physical seat through DRM/KMS and injects physical input through
uinput. The Runtime connects over its protected Unix socket; no target-side Portal
consent is required. Installed-but-stopped or failed services report unavailable
and do not silently select a user-session backend.

Without that service, the optional current-user chain prepares the published
host-desktop catalog through the upstream Manager and launches its helper with
separate control/media pipes and a private authorization directory. Its identity
resolver selects an authenticated current-user Wayland or X11 login. Wayland uses
RemoteDesktop/ScreenCast portals and PipeWire; X11 uses verified login credentials.
That chain does not provide SSH-only deployment or login-screen authority.
Neither chain selects an application-private desktop or installs host libraries.

When a Linux component archive is missing, `floe-native-apps` automatically probes
the catalog's reviewed HTTPS mirror candidates with representative archive
requests, measures their latency and resource availability, and downloads from
the fastest validated source. A complete local archive is reused without network
probing. The canonical official Alpine source remains the final fallback; every
download still checks the expected size and SHA-256 before atomic cache publication,
and a failed archive download can move to the next trusted source. Sources are
fixed by the published catalog: neither administrators nor users configure or
choose mirrors, and Redeven does not provide a mirror or download service.

The optional user chain's [persistent authorization contract](remote-desktop-authorization.md)
owns first approval, saved-grant recovery, per-connection consent and local
credential reset. Product sessions remain ephemeral even when system approval
is saved. Locking is an explicit operation. Locked, switched or uncapturable sessions cannot retain ordinary input, clipboard or audio authority. Where the authorized login-screen service is active, the attachment may forward lock-screen frames. The viewer must enter an explicit unlock mode before it can send physical key or pointer events; paste, clipboard, shortcuts and ordinary control remain disabled. Every unlock command carries the current generation and the frame that was painted, and successful unlock advances generation and requires a fresh active frame before normal control resumes. Disconnect, takeover, Runtime restart, user switching and service stop revoke the unlock lease immediately. Credentials are never sent as text, persisted, or written to audit or diagnostics. Disk unlock and a login without a supported graphical greeter remain outside this contract.

Desktop SSH presents one scope confirmation in Env App before setup. Administrator
credentials stay in that SSH transaction; the Runtime's service-management routes
cannot elevate privileges or receive credentials. Env App owns setup progress,
cancel, rollback results and explicit update/start/stop/uninstall controls.
Unsupported hardware or compositor reports a concrete reason without a button
asking the user to authorize sharing on the target desktop.

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
The current-user media chain uses low-latency H.264 and static PNG refinement;
system-output audio uses Opus. The privileged Linux physical-seat chain uses the
same ordered H.264 and settled PNG refinement path, with DRM cursor shape,
position and visibility transported independently from video. It supports
physical keyboard and pointer input but does not provide audio, clipboard or
client-composed text. The viewer disables controls for absent capabilities; this
chain's lock-screen qualification is not evidence of audio or clipboard acceptance.
The published browser player negotiates available
WebCodecs configurations, bounds encoded/decoded/audio queues, and confirms paint
after a rendering opportunity and its following task. Decoder preference is displayed as preference,
not proof of the physical decoder. Dependent H.264 frames cannot be dropped as
independent images; recovery requires a fresh keyframe boundary.

The [viewer interaction contract](remote-desktop-viewer.md) owns toolbar layout,
input modes, clipboard, local cursor presentation, fullscreen and disconnect
feedback. Native session and frame authority remain governed by this concept.

# Boundaries

There is no Windows host, virtual-desktop provisioning or implicit privilege
escalation,
microphone/camera/printer redirection, WebRTC negotiation or new public port.
Browser media requires WebCodecs and HTTPS or a trustworthy local origin. The
[acceptance record](../operations/remote-desktop-results.md) owns measured
quality claims; a connected picture is not a 60 FPS certification.

The [desktop media contract](remote-desktop-media.md) owns low-delay video,
encoder selection and Wayland capture/input scheduling.

# Evidence

- `internal/remotedesktop/manager.go`, `internal/remotedesktop/attachment.go` and `internal/remotedesktop/socket_test.go`: ownership, paired attachment credentials, current-frame input and socket retirement.
- `internal/codeapp/appserver/remote_desktop.go` and `internal/codeapp/appserver/remote_desktop_test.go`: API/full-permission boundary, owner checks and private viewer bootstrap.
- `internal/remotedesktop/native_linux.go` and `internal/remotedesktop/service_linux_test.go`: privileged attachment selection, read-only status and no Portal fallback for an installed service.
- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.tsx`: Env App scope confirmation, ephemeral credentials and locked-host admission.
- `internal/localui/localui.go` and `internal/localui/native_codespace.go`: Local UI access-session cancellation for desktop forwarding.
- `desktop/native/computer-host/Package.swift` and `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationHost.swift`: exact upstream package and shared native control owner.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: published player integration and browser interaction acceptance.
- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.tsx` and `desktop/src/main/hostApplicationWindow.ts`: product entry, preparation and exact-window native actions.
