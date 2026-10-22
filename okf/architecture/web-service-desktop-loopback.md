---
type: Runtime Contract
title: Desktop loopback Web Service access
description: Give one HTTP Web Service an isolated numeric-loopback browser Origin without bypassing its protected Runtime route.
tags: [architecture, desktop, port-forward, proxy, security]
timestamp: 2026-09-22T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

`desktop_loopback` is the Desktop-only compatibility mode for a Web Service that requires a local-browser Origin. Desktop assigns the exact Environment session and forward one random `http://127.0.0.1:<port>` Origin, while every request still traverses the authorized Runtime forward. The mode never connects directly to the target, changes a network interface, allocates another loopback address, modifies the application, or falls back to `unified_proxy`. Closing the owning window or Environment removes the gateway and its authority.

# Contract

## Mode and presentation
`port_forwards.access_mode` is the sole decision owner.

A system browser cannot receive the Electron-partition credential, and Desktop must not substitute a private `pf-*` URL, mint a unified-proxy session, or silently change the persisted mode.

## Protected gateway route
The gateway binds exclusively to `127.0.0.1:0`. Native and placement private bridges use their canonical numeric-loopback listener with the exact `/pf/<forward_id>/` route; remote routes retain their authorized `pf-*` authority.

Streaming and oversized responses remain streaming rather than being buffered for optional text rewriting.

## Authorization and cleanup
Each gateway generates an independent random session credential.

[Managed opening](managed-web-service-opening.md) owns explicit reprepare; authentication failure cannot switch to unified proxy or a direct target.

# Boundaries

The loopback Origin improves application compatibility; it is not direct network access, Remote Browser Isolation, a public listener, a Local UI login, or a substitute for application authentication. The random credential prevents ambient browser requests from using a live gateway but does not turn loopback networking into a cross-user security boundary.

# Evidence

- `redeven:internal/portforward/registry/schema.go` - The fresh Registry baseline persists one constrained access mode and route-safe forward identity.

- `redeven:internal/portforward/service.go:1` - Runtime validates mode values and rejects local compatibility for non-HTTP targets.

- `redeven:desktop/src/main/navigation.ts:256` - Navigation maps only the exact HTTP target scope and supported loopback aliases into the assigned gateway Origin.
