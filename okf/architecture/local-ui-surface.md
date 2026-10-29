---
type: Runtime Contract
title: Local UI surface
tags: [architecture, local-ui, runtime, security]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime Local UI supports concurrent independent Desktop/browser sessions. Public HTTP/WS or HTTPS/WSS shares one port; private Desktop uses numeric loopback and flowersec-private-loopback/1. Versioned SQLite owns one-shot authorization/browser spend across transports. Network exposure owns protocol, scope, password, certificate and migration policy.

# Contract

## Mechanism
`localui.Server` is built with an agent, Code App app server, bind spec, runtime-control socket path, Local Environment identity, diagnostics store, and optional access gate.

Local UI bind parsing accepts `localhost`, canonical loopback IP literals, concrete non-loopback unicast IPv4 and IPv6 literals, and the `0.0.0.0` and `::` wildcards.

In-process maps retain only active-session cleanup projections and never authorize a request.

## Concurrent shutdown
Context cancellation and explicit shutdown enter the same serialized close path. Runtime-control and management status serialize start/close and protect endpoint reads, so overlapping shutdown cannot dereference cleared servers or advertise a retired control listener. This uses bounded in-process locks and does not introduce durable lifecycle state.

## Session event observation
All built-in Env App event subscriptions use the current authenticated Flowersec session's HTTP proxy. Short bootstrap requests and native file/media requests stay independent of session acquisition.

# Boundaries

Public Env App shell GET/HEAD requests may pass before unlock so the login page can load.

The private listener accepts only its canonical numeric-loopback Host or a validated per-forward `.localhost` virtual Host.

Saved next-start settings never replace the running URL list.

# Evidence

- `redeven:internal/localui/localui.go:50` - Local UI options require bind, agent, app server, state, runtime-control, version, diagnostics, and access gate inputs.

- `redeven:internal/localui/http_security.go:24` - Listener and interface addresses produce the exact public network authority allowlist and real display URLs.
