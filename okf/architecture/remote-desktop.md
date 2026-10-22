---
type: Runtime Contract
title: Human remote desktop sessions
description: Share the host's current graphical desktop with an authenticated viewer, exclusive remote input, and bounded media.
tags: [runtime, desktop, applications, security, media]
timestamp: 2026-10-13T02:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns remote desktop authorization, ephemeral sessions, window placement,
configuration and audit. Published `floe-native-apps` owns current-desktop
selection, OS authorization, native input, capture, codecs, bounded playback and
Linux component acquisition and the privileged physical-desktop service.
A desktop session shares the existing signed-in macOS or Linux desktop. It never
creates an application-private desktop, changes system security policy or grants
access to a lower-permission user. Disconnect releases remote input and media;
host applications and unsaved work survive. Platform unavailability revokes
input and requires a fresh active frame before recovery.

# Contract

## Admission and ownership
`/_redeven_proxy/api/remote-desktop` is independent from application launch. Every session and forward belongs to the authenticated user; renderer-supplied identity never authorizes a route.

The same policy fences new admission under the manager lock, so an HTTP request authorized before revocation cannot recreate the removed desktop.

## Platform boundary
macOS uses the exact remote Swift package in the existing Runtime helper.

The canonical official Alpine source remains the final fallback; every download still checks the expected size and SHA-256 before atomic cache publication, and a failed archive download can move to the next trusted source.

Capability normalization also applies to a retried connection after accepting or declining takeover, so a removed display cannot return through the stored request.

## Media and office interaction
Control and media travel through separate Flowersec native proxy streams bound to the same product attachment. Cancellation retires the selection and releases held keys; lock-screen input cannot use that text path.

Native session and frame authority remain governed by this concept.

# Boundaries

There is no Windows host, virtual-desktop provisioning or implicit privilege escalation, microphone/camera/printer redirection, WebRTC negotiation or new public port.

The [desktop media contract](remote-desktop-media.md) owns low-delay video, encoder selection and Wayland capture/input scheduling.

# Evidence

- `internal/remotedesktop/manager.go`, `internal/remotedesktop/attachment.go` and `internal/remotedesktop/socket_test.go`: ownership, paired attachment credentials, current-frame input and socket retirement.

- `internal/codeapp/appserver/remote_desktop.go` and `internal/codeapp/appserver/remote_desktop_test.go`: API/full-permission boundary, owner checks and private viewer bootstrap.

- `internal/remotedesktop/native_linux.go` and `internal/remotedesktop/service_linux_test.go`: privileged attachment selection, read-only status and no Portal fallback for an installed service.
