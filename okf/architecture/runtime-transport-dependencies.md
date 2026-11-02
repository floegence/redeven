---
type: Runtime Contract
title: Runtime transport dependencies
tags: [architecture, dependencies, terminal]
quality_exception: Published Flowersec transport and Floeterm boundary covering session ownership, protocol profiles, and shared admission.
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Runtime composes Transport v3 and published Flowersec connection/session/RPC/stream primitives; Floeterm owns terminal lifecycle. Each Env App shares one current protocol session across RPC and live streams. Desktop SSH placement HTTP/2 is separate and does not redefine Flowersec wire or public SDK behavior.

# Contract

## AI Flower RPC registration
The local direct and remote agent production session profiles register the complete AI inventory before Flowersec freezes a session. A declared method therefore cannot fail at the router with a missing-handler 404. Stop remains one RPC lifecycle command without a fallback transport.

## Independent Gateway composition

The upstream-first review uses published Flowersec 5.11.1 WebSocketHTTPServerOptions.ApplicationHandler to compose client HTTP with Runtime transport on one TLS endpoint, and its egress.HTTPSProxy for explicit Runtime Cloud routing. No upstream mechanism change, local dependency overlay or copied implementation is required.

## Mechanism
The released runtime dependency set includes Floeterm terminal-go v0.19.2 and Flowersec Go v5.11.1.

Env App and Desktop consume Flowersec TypeScript v5.11.1.

Switching a Flower thread, Activity or Workbench mode, terminal view, or file consumer cannot reconnect Flowersec.

Terminal ownership, live framing, history, attachment arbitration, and warmup are specified in [Runtime terminal lifecycle](runtime-terminal-lifecycle.md); this concept only defines the Flowersec/Floeterm dependency boundary and shared transport admission.

# Boundaries

[Web Center](web-environment-center.md) composes the published Flowersec controller with pinned Runtime TLS through an in-process Connector. This adds no new wire protocol and does not replay business requests.

Compatibility depends on these published transport and terminal interfaces staying aligned. Replacing or bypassing them can break placement multiplexing, liveness teardown, bounded RPC, TLS admission, terminal ownership, Presentation ordering, history generation, controller arbitration, or session lifecycle. History and session diagnostics are observability only; neither Redeven nor Floeterm uses session count to reject creation, close a PTY, or pause a running session.

# Evidence

- `redeven:go.mod:10` - Redeven pins floeterm terminal-go in the runtime module.

- `redeven:internal/agent/agent.go:20` - Published Flowersec v5 controller, sessions, RPC and byte streams.
