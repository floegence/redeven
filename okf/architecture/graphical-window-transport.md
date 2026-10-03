---
type: Architecture Contract
title: Flowersec transport for graphical windows
description: Bind every remote desktop and host application data channel to one resource-scoped native Flowersec session in direct and tunnel modes.
tags: [applications, desktop, transport, security]
timestamp: 2026-10-02T00:00:00Z
---
# Summary

Flowersec owns encryption, carrier selection, multiplexing, proxy framing and
backpressure for remote desktop and host application windows. Redeven owns the
resource, user authorization and route mapping. All graphical data, including
state, attachment tickets, input, clipboard, audio, pixels and explicit disconnect,
uses the published native session proxy. Static program bootstrap and acquisition
remain on the authenticated browser entry. Missing authority fails closed; no
viewer backend may silently open a raw graphical HTTP or WebSocket connection.

# Contract

Env App resource-management requests, including the forward touch immediately
before opening a graphical window, use its active Flowersec session HTTP carrier.
Window creation must not reintroduce a raw HTTP step between session admission
and the resource-scoped viewer connection. Missing session transport fails closed.

## One session boundary for every backend

The viewer's `WindowTransport` maps product paths into the published
`flowersec-proxy/http1` and `flowersec-proxy/ws` stream APIs. Remote desktop keeps
separate control and media streams inside that same session. Native macOS, native
Linux and retained Xpra host application viewers use the same transport owner.
Runtime-to-helper pipes and Runtime-to-backend loopback sockets remain internal
adapters; they are not independently exposed client transports.

The product's native application attachment keeps a bounded event queue. A burst
of input acknowledgements waits for the viewer to drain that queue; fullness
alone must not disconnect an otherwise healthy attachment. Socket write deadlines
bound a stalled viewer, and attachment shutdown releases a blocked event reader.

Direct windows acquire a resource-bound session through
`/pf/<forward_id>/_redeven_window/connect` and `/spend`. Public HTTP, public HTTPS
and Desktop's numeric-loopback private bridge each use their matching published
Flowersec profile. Desktop graphical windows retain `/pf/<forward_id>` on the
numeric bridge authority. Ordinary Web Service virtual hosts keep their separate
[browser-session contract](web-service-browser-sessions.md).

Tunnel windows use the existing controller/app-window bridge. The owning
controller supplies the native session and the exact-origin capability. The
viewer never acquires a direct endpoint or creates its own relay protocol.
Flowersec's byte-stream bridge must honor partial writes in both directions;
application media frames larger than a bridge chunk retain exact contents without
raising its bounded outstanding-buffer limits. The proxy frame limit is 32 MiB.
The minimum released bridge implementation is Flowersec 5.7.1; Redeven's Go and
browser consumers use that same release. Oversized sends close their stream
without forwarding the payload; callers must not depend on a synchronous throw.

The prepared Xpra document opts into the upstream required-host-transport mode
from floe-native-apps 0.22.8 before its client starts. Only the same-origin
`application` iframe can inherit
its parent's constructor. Xpra's protocol runs in that document realm, while its
graphics decoder workers remain enabled. A missing injected constructor stops
connection setup. Generic Code App injection must not install a second transport
on these marked graphical documents.

# Boundaries

## Resource authority

Acquisition requires read, write and execute permissions and an active resource
owned by the authenticated user. Its exact spend target identifies the window
kind, environment, port-forward application and forward ID; launcher, Runtime and
application origins must all match. Credentials are short-lived and private and
do not enter URLs. A window receives no Env RPC or plugin-management credential.

After Flowersec admission, the Runtime waits for the existing product activation
signal before forwarding requests. Cancellation releases this wait. The signal
only orders activation: normal channel, resource and owner authorization still
runs, including after failed activation or resource removal. The trusted internal
session header is reconstructed by the access proxy and never accepted as browser
authority.

Raw Local UI graphical state, ticket, control, media and disconnect routes return
403. Bootstrap documents and static code may load through the authenticated entry;
those bytes do not authorize a data channel. Every request inside the native
session remains bound to its own forward, including when the public address uses
the numeric Local UI origin. A view-only session keeps the full access requirement.

## Recovery and browser capability

Carrier failure clears the cached proxy runtime. Viewer reconnect uses a fresh
native session and attachment; the existing input contract still requires a newly
painted frame. Commands are never replayed. Explicit Disconnect stops local input
and media, completes the native disconnect request and disposes the carrier.
Page unload closes streams immediately; the backend releases capture and input
and expires its bounded reconnect lease. Neither operation terminates host apps.

Flowersec encryption does not change the browser's secure-context classification.
WebCodecs, clipboard and audio behavior follow actual browser capabilities. HTTPS
or a trustworthy local origin is still required where the browser restricts those
APIs; product code does not mark an insecure network origin as trustworthy.

# Evidence

- `internal/codeapp/ui_src/src/windowTransport.ts` and `windowTransport.test.ts`: published transport composition, route and spend validation, iframe ownership and disposal.
- `internal/localui/window_transport.go`, `window_transport_test.go` and `window_transport_e2e_test.go`: resource acquisition and actual direct session authority.
- `internal/agent/window_transport.go` and `internal/accessproxy/session_ready_test.go`: scoped handler registration and activation/cancellation ordering.
- `internal/codeapp/appserver/window_transport.go` and `window_transport_test.go`: raw-data rejection and static bootstrap boundaries.
- `internal/runtimeproxy/window_tunnel_browser_test.go` and `internal/codeapp/ui_src/scripts/checkWindowTunnel.mjs`: actual encrypted tunnel, separate duplex streams, large-frame integrity and bounded frames.
- `internal/hostapps/application_proxy.go` and `client_assets_test.go`: published required-host-transport Xpra preparation.
- `internal/hostapps/desktop_transport_linux_test.go`: bounded application reply delivery and shutdown without lost acknowledgements.
- `desktop/src/main/desktopSessionTransport.ts` and `desktopSessionTransport.test.ts`: exact numeric bridge origin and resource-scoped native authorization.
