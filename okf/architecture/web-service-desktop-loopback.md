---
type: Runtime Contract
title: Desktop loopback Web Service access
description: Give one HTTP Web Service an isolated numeric-loopback browser Origin without bypassing its protected Runtime route.
tags: [architecture, desktop, port-forward, proxy, security]
timestamp: 2026-08-30T00:00:00Z
---
# Summary

`desktop_loopback` is the Desktop-only compatibility mode for a Web Service that requires a local-browser Origin. Desktop assigns the exact Environment session and forward one random `http://127.0.0.1:<port>` Origin, while every request still traverses the authorized Runtime forward. The mode never connects directly to the target, changes a network interface, allocates another loopback address, modifies the application, or falls back to `unified_proxy`. Closing the owning window or Environment removes the gateway and its authority.

# Contract

## Mode and presentation

`port_forwards.access_mode` is the sole decision owner. Runtime accepts `desktop_loopback` only for an HTTP target. Env App exposes the choice when a service is saved, edited, or deployed; a browser-only Env App explains that the service requires Redeven Desktop instead of trying another route. An external Managed Service template may declare this mode, while ordinary and custom services default to `unified_proxy`.

When a trusted Desktop Shell opens the service, Electron creates or reuses one gateway keyed by Environment session and forward. Its browser-visible Origin is the gateway's numeric-loopback address; the trusted toolbar continues to show the original target origin and current application path. The target `WebContentsView` keeps its dedicated non-persistent partition and receives no preload, Node access, bridge token, forward identity, or gateway credential in renderer-visible state.

The system-browser action is disabled with an explicit explanation. A system browser cannot receive the Electron-partition credential, and Desktop must not substitute a private `pf-*` URL, mint a unified-proxy session, or silently change the persisted mode.

## Protected gateway route

The gateway binds exclusively to `127.0.0.1:0`. It forwards HTTP and WebSocket traffic to the exact protected Web Service route already selected for the Environment session. Native and placement private bridges use their canonical numeric-loopback listener with the exact `/pf/<forward_id>/` route; remote routes retain their authorized `pf-*` authority. The gateway is an adapter over that route, not another Runtime listener or permission path.

Root-relative resources, application-owned `/pf/*` paths, refreshes, query parameters, fragments, WebSockets, and same-protocol same-port navigation between supported loopback aliases stay on the assigned Origin. Absolute target URLs in redirects, policy headers, and rewritable text responses are mapped back to that Origin. Cross-port and protocol-changing requests, credentials, unsupported schemes, and external origins are not mapped. Streaming and oversized responses remain streaming rather than being buffered for optional text rewriting.

## Authorization and cleanup

Each gateway generates an independent random session credential. Electron main injects it only for the exact partition and gateway authority; the listener rejects missing or incorrect credentials. The gateway removes that header before the protected request and adds only the transport authorization required for the existing Runtime route. Runtime removes its bridge or browser credential before the target service. Application cookies remain isolated in the service partition, while an upstream cookie Domain and HTTP-incompatible Secure attribute are removed when necessary to bind the cookie to the assigned local Origin.

Another forward uses another port, partition, and credential. The base Local UI, another Environment, another Desktop process, and an ordinary system-browser request gain no authority from the gateway. Window replacement closes the prior listener before changing target or mode. Window close, Environment close, Runtime replacement, and Desktop exit destroy active HTTP and WebSocket connections, close the listener, unregister request hooks, and clear partition storage and cache.

# Boundaries

The loopback Origin improves application compatibility; it is not direct network access, Remote Browser Isolation, a public listener, a Local UI login, or a substitute for application authentication. A process already executing as the same local user remains inside the ordinary Desktop threat model. The random credential prevents ambient browser requests from using a live gateway but does not turn loopback networking into a cross-user security boundary.

# Evidence

- `redeven:internal/portforward/registry/schema.go` - The fresh Registry baseline persists one constrained access mode and route-safe forward identity.
- `redeven:internal/portforward/service.go:1` - Runtime validates mode values and rejects local compatibility for non-HTTP targets.
- `redeven:desktop/src/main/navigation.ts:256` - Navigation maps only the exact HTTP target scope and supported loopback aliases into the assigned gateway Origin.
- `redeven:desktop/src/main/webServiceLoopbackGateway.ts:1` - The gateway owns numeric-loopback binding, credential admission, protected HTTP and WebSocket forwarding, response mapping, and connection cleanup.
- `redeven:desktop/src/main/main.ts:8301` - Desktop binds gateway, partition, trusted display URL, routing decision, and lifecycle to the owning Environment and forward.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx:1130` - Env App presents and persists the access mode and explains Desktop-only availability.
