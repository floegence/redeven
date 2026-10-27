---
type: Architecture Contract
title: Flowersec transport for graphical windows
description: Bind every remote desktop and host application data channel to one resource-scoped native Flowersec session in direct and tunnel modes.
tags: [applications, desktop, transport, security]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flowersec owns encryption, carrier/multiplexing/framing/backpressure; Redeven owns resources, authorization and routing. All graphical state, tickets, input, clipboard, audio, pixels and disconnect use native session proxy. Static bootstrap/acquisition stays authenticated browser traffic. Missing authority fails closed; raw graphical HTTP/WS bypass is forbidden.

# Contract

Env App resource-management requests, including the forward touch immediately before opening a graphical window, use its active Flowersec session HTTP carrier. Window creation must not reintroduce a raw HTTP step between session admission and the resource-scoped viewer connection. Missing session transport fails closed.

## One session boundary for every backend
The viewer's `WindowTransport` maps product paths into the published `flowersec-proxy/http1` and `flowersec-proxy/ws` stream APIs.

The product's native application attachment keeps a bounded event queue.

Generic Code App injection must not install a second transport on these marked graphical documents.

# Boundaries

## Resource authority
Acquisition requires read, write and execute permissions and an active resource owned by the authenticated user. Its exact spend target identifies the window kind, environment, port-forward application and forward ID; launcher, Runtime and application origins must all match.

A view-only session keeps the full access requirement.

## Recovery and browser capability
Carrier failure clears the cached proxy runtime.

HTTPS or a trustworthy local origin is still required where the browser restricts those APIs; product code does not mark an insecure network origin as trustworthy.

# Evidence

- `internal/codeapp/ui_src/src/windowTransport.ts` and `windowTransport.test.ts`: published transport composition, route and spend validation, iframe ownership and disposal.

- `internal/localui/window_transport.go`, `window_transport_test.go` and `window_transport_e2e_test.go`: resource acquisition and actual direct session authority.

- `internal/agent/window_transport.go` and `internal/accessproxy/session_ready_test.go`: scoped handler registration and activation/cancellation ordering.
